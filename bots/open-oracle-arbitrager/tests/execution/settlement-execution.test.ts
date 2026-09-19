import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, encodeDeployData, http, keccak256, privateKeyToAccount, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { decodeOpenOracleStatePreimage, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { parseDecimalWeth } from '#state/operator-state'
import { networkConfiguration } from '#config/network'
import { openOracleAbi } from '#contracts/abi'
import type { ReadClient, WriteClient } from '#core/operator-types'
import { executeRewardWithdrawal, executeSettlement, reconcilePendingSettlements, unclaimedSettlementReward, type SettlementExecutionContext } from '#execution/settlement-execution'
import { ATTEMPT_FINALITY_BLOCKS } from '#execution/execution-orchestration'
import { validateSubmissionSettings } from '#execution/transaction-submission'
import type { CoordinatorGamePolicy } from '#core/game-policy'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import type { OperationEntry, TransactionActivity } from '#state/operator-state'
import { settlementMaxFeePerGas } from '#core/settlement-strategy'
import { emptySettlementSnapshot, loadSettlementJournal, settlementAttemptHoldsFlow, settlementAttemptIsUnresolved, settlementGasSpentAttoEthOnUtcDay, settlementJournalPath, type MutableSettlement, type SettlementRecord } from '#state/settlement-store'
import { createSettlementJournal, recoverPendingSettlements, runSettlementStage, type SettlementStageConfiguration } from '../../src/runtime/settlement-stage.ts'
import { createAnvilNodeForConnectionMode, getAnvilConnectionMode, type AnvilNode } from '../../../../solidity/ts/testSupport/simulator/anvilNode.ts'
import { statoblast_openOracle_OpenOracle_OpenOracle as openOracleArtifact } from '../../../../solidity/ts/types/contractArtifact'
import { tokenArtifact } from '../contracts/harness-artifacts.generated.ts'

const SIGNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const
const REPORTER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const REWARD = 17_043_310_270_400_101n
const SETTLEMENT_SECONDS = 100n
const GWEI = 10n ** 9n
const network = networkConfiguration('mainnet')
const settlement: MutableSettlement = { enabled: true, maxGasPriceAttoEthPerGas: 50n * GWEI, minimumProfitAttoWeth: 10n ** 15n, rewardWithdrawThresholdAttoEth: 10n ** 16n }

describe('third-party settlement execution against OpenOracle', () => {
	let node: AnvilNode
	let client: ReadClient
	let wallet: WriteClient
	let reporter: WriteClient
	let openOracle: Address
	let token1: Address
	let token2: Address
	const account = privateKeyToAccount(SIGNER_KEY)

	const deploy = async (artifact: typeof openOracleArtifact | typeof tokenArtifact, args: readonly unknown[] = []) => {
		const hash = await wallet.sendTransaction({ data: encodeDeployData({ abi: artifact.abi, args, bytecode: `0x${artifact.evm.bytecode.object}` }) })
		const receipt = await wallet.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	const write = async (request: Parameters<WriteClient['writeContract']>[0], signer: WriteClient = wallet) => {
		const hash = await signer.writeContract(request)
		const receipt = await signer.waitForTransactionReceipt({ hash })
		if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`)
		return receipt
	}

	beforeAll(async () => {
		node = await createAnvilNodeForConnectionMode(getAnvilConnectionMode(), { context: 'settlement execution', startTimestamp: 1n })
		const transport = http(node.rpcUrl)
		client = createPublicClient({ chain: network.chain, transport })
		wallet = createWalletClient({ account, chain: network.chain, transport })
		await node.anvilWindowEthereum.setBalance(account.address, 100n * 10n ** 18n)
		openOracle = await deploy(openOracleArtifact)
		token1 = await deploy(tokenArtifact, ['Token 1', 'TK1'])
		token2 = await deploy(tokenArtifact, ['Token 2', 'TK2'])
		reporter = createWalletClient({ account: privateKeyToAccount(REPORTER_KEY), chain: network.chain, transport })
		await node.anvilWindowEthereum.setBalance(reporter.account.address, 100n * 10n ** 18n)
		for (const token of [token1, token2]) {
			for (const signer of [wallet, reporter]) {
				await write({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [signer.account.address, 10n ** 21n] }, signer)
				await write({ abi: tokenArtifact.abi, address: token, functionName: 'approve', args: [openOracle, 10n ** 21n] }, signer)
			}
		}
	})

	afterAll(async () => {
		await node?.dispose()
	})

	async function submitReport(reporter: WriteClient = wallet, callbackContract: Address = zeroAddress): Promise<OpenOracleStatePreimage> {
		const receipt = await write(
			{
				abi: openOracleAbi,
				address: openOracle,
				functionName: 'report',
				args: [
					{
						callbackContract,
						callbackGasLimit: 0,
						currentAmount1: 10n ** 18n,
						currentAmount2: 10n ** 18n,
						currentReporter: reporter.account.address,
						disputeDelay: 0,
						escalationHalt: 10n ** 19n,
						feePercentage: 0,
						flags: 7,
						lastReportOppoTime: 0,
						multiplier: 115,
						numReports: 0,
						protocolFee: 0,
						protocolFeeRecipient: zeroAddress,
						reportTimestamp: 0,
						settlementTime: Number(SETTLEMENT_SECONDS),
						settlementTimestamp: 0,
						settlerReward: REWARD,
						token1,
						token2,
					},
					false,
					false,
					{ blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 0n, blockTimestampBound: 0n },
				],
				value: REWARD,
			},
			reporter,
		)
		const submitted = receipt.logs.find(log => log.address.toLowerCase() === openOracle.toLowerCase() && log.topics.length === 2 && log.data.length > 2)
		if (submitted?.topics[1] === undefined) throw new Error('ReportSubmitted log missing')
		return decodeOpenOracleStatePreimage(submitted.data, BigInt(submitted.topics[1]))
	}

	async function pastSettlementWindow() {
		await node.anvilWindowEthereum.request({ method: 'evm_increaseTime', params: [Number(SETTLEMENT_SECONDS) + 1] })
		await node.anvilWindowEthereum.request({ method: 'evm_mine', params: [] })
	}

	async function context(records: SettlementRecord[], activity: TransactionActivity[]): Promise<SettlementExecutionContext> {
		const block = await client.getBlock()
		if (block.number === null || block.number === undefined) throw new Error('head block number missing')
		return {
			baseFeePerGas: block.baseFeePerGas ?? 0n,
			blockNumber: block.number,
			client,
			maxFeePerGas: settlementMaxFeePerGas(block.baseFeePerGas ?? 0n, settlement),
			config: { connectivity: { publicRpcUrls: [node.rpcUrl], readRpcUrl: node.rpcUrl }, network, openOracle, pollMilliseconds: 1_000, quorumRpcUrls: [], settlement, submission: validateSubmissionSettings({ mode: 'public', relayUrls: [] }) },
			isPaused: () => false,
			persist: async record => {
				records.push(record)
			},
			readClients: [client],
			track: entry => {
				activity.push(entry)
			},
			wallet,
		}
	}

	test('settles a third-party report, accrues the reward inside OpenOracle, and withdraws it in one batch', async () => {
		const report = await submitReport()
		expect(report.game.settlerRewardAttoEth).toBe(REWARD)
		await pastSettlementWindow()
		const records: SettlementRecord[] = []
		const activity: TransactionActivity[] = []
		const settlementContext = await context(records, activity)
		// The settling wallet is also the reporter here; the queue excludes that case, so the executor is exercised directly.
		const plan = { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 10n ** 15n, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' }
		const record = await executeSettlement(settlementContext, plan)
		expect(record).toMatchObject({ account: account.address, coordinator: report.helper.creator, kind: 'settlement', reportId: report.helper.reportId.toString(), rewardEth: '0.017043310270400101', status: 'confirmed' })
		expect(record.actualGasCostEth).toBeDefined()
		// The durable nonce and intent are what recovery needs to tell a late inclusion from a replacement after a restart.
		const mined = await client.getTransaction({ hash: record.transactionHash })
		expect(record.nonce).toBe(mined.nonce.toString())
		expect(record.transactionIntent).toEqual({ data: mined.input, to: openOracle, value: '0' })
		expect(record.submissionMode).toBe('public')
		expect(BigInt(record.lastValidBlockNumber)).toBe(BigInt(record.submissionBlockNumber) + 25n)
		expect(Number.isFinite(Date.parse(record.minedAt ?? ''))).toBeTrue()
		expect(records.map(entry => entry.status)).toEqual(['pending', 'confirmed'])
		expect(activity.map(entry => `${entry.kind}:${entry.status}`)).toEqual(['settle:submitting', 'settle:pending', 'settle:confirmed'])
		expect(await client.readContract({ abi: openOracleAbi, address: openOracle, functionName: 'storedGame', args: [report.helper.reportId] }).then(game => game[4])).not.toBe(0n)
		expect(await unclaimedSettlementReward([client], { connectivity: { publicRpcUrls: [node.rpcUrl], readRpcUrl: node.rpcUrl }, openOracle, quorumRpcUrls: [] }, account.address, await client.getBlockNumber())).toBe(REWARD)

		await expect(executeSettlement(await context(records, activity), plan)).rejects.toThrow()
		expect(records).toHaveLength(2)

		const balanceBefore = await client.getBalance({ address: account.address })
		const withdrawal = await executeRewardWithdrawal(await context(records, activity), REWARD)
		expect(withdrawal).toMatchObject({ coordinator: undefined, kind: 'reward-withdrawal', reportId: undefined, rewardEth: '0.017043310270400101', status: 'confirmed' })
		expect(activity.at(-1)?.kind).toBe('withdraw-reward')
		const gasPaid = parseDecimalWeth(withdrawal.actualGasCostEth ?? '0')
		expect((await client.getBalance({ address: account.address })) - balanceBefore).toBe(REWARD - gasPaid)
		expect(await unclaimedSettlementReward([client], { connectivity: { publicRpcUrls: [node.rpcUrl], readRpcUrl: node.rpcUrl }, openOracle, quorumRpcUrls: [] }, account.address, await client.getBlockNumber())).toBe(0n)
	})

	test('bounds the receipt wait by the signed horizon and leaves the attempt pending for reconciliation', async () => {
		const report = await submitReport()
		await pastSettlementWindow()
		const records: SettlementRecord[] = []
		const base = await context(records, [])
		let blockReads = 0
		// The submission window check sees the real head once; every later read is past the signed horizon.
		const impatientClient = { ...client, getBlockNumber: async () => (blockReads++ === 0 ? base.blockNumber : base.blockNumber + 100n) }
		const deafWallet = {
			...wallet,
			waitForTransactionReceipt: async () => {
				throw new Error('receipt wait timed out')
			},
		}
		const plan = { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 10n ** 15n, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' }
		await expect(executeSettlement({ ...base, client: impatientClient, wallet: deafWallet }, plan)).rejects.toThrow('was not confirmed in its parent-bound target block')
		expect(records.map(record => record.status)).toEqual(['pending'])
		// Anvil mined the attempt anyway, so the next scan's reconciliation resolves it from the receipt.
		const [pending] = records
		if (pending === undefined) throw new Error('pending record missing')
		const resolved = await reconcilePendingSettlements([client], base.config, [pending], await client.getBlockNumber())
		expect(resolved.map(record => record.status)).toEqual(['confirmed'])
	})

	test('does not credit a settlement whose nonce was taken by an unrelated transaction', async () => {
		const report = await submitReport()
		await pastSettlementWindow()
		// A public RPC that acknowledges raw transactions without forwarding them leaves the signed settle unmined so its nonce can be taken.
		const swallowingRpc = Bun.serve({
			port: 0,
			async fetch(request) {
				const body: unknown = await request.json()
				if (typeof body === 'object' && body !== null && Reflect.get(body, 'method') === 'eth_sendRawTransaction') {
					const [raw] = Reflect.get(body, 'params') as [Hex]
					return Response.json({ id: Reflect.get(body, 'id'), jsonrpc: '2.0', result: keccak256(raw) })
				}
				return fetch(node.rpcUrl, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' })
			},
		})
		try {
			const records: SettlementRecord[] = []
			const base = await context(records, [])
			const config = { ...base.config, connectivity: { ...base.config.connectivity, publicRpcUrls: [swallowingRpc.url.href] }, pollMilliseconds: 5_000 }
			const nonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
			const plan = { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 10n ** 15n, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' }
			const attempt = executeSettlement({ ...base, config }, plan)
			for (let waited = 0; records.length === 0 && waited < 200; waited++) await Bun.sleep(10)
			// Take the settle's nonce with a plain self-transfer; the receipt wait then resolves through the replacement instead.
			const unrelatedHash = await wallet.sendTransaction({ nonce, to: account.address, value: 1n })
			await wallet.waitForTransactionReceipt({ hash: unrelatedHash })
			await expect(attempt).rejects.toThrow('was replaced by')
			expect(records.map(record => `${record.status}:${record.transactionHash === unrelatedHash}`)).toEqual(['pending:false', 'expired:false'])
			expect(await client.readContract({ abi: openOracleAbi, address: openOracle, functionName: 'storedGame', args: [report.helper.reportId] }).then(game => game[4])).toBe(0n)
		} finally {
			swallowingRpc.stop(true)
		}
	})

	test('drops a journaled public attempt that no node accepted so it neither holds the report nor charges the budget', async () => {
		const report = await submitReport(reporter, reporter.account.address)
		await pastSettlementWindow()
		const plan = { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 10n ** 15n, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' }
		// Every public RPC rejects the raw transaction, so the signed settle never reaches a mempool.
		const rejectingRpc = Bun.serve({
			port: 0,
			async fetch(request) {
				const body: unknown = await request.json()
				if (typeof body === 'object' && body !== null && Reflect.get(body, 'method') === 'eth_sendRawTransaction') return Response.json({ id: Reflect.get(body, 'id'), jsonrpc: '2.0', error: { code: -32000, message: 'rejected' } })
				return fetch(node.rpcUrl, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' })
			},
		})
		try {
			const rejected: SettlementRecord[] = []
			const base = await context(rejected, [])
			await expect(executeSettlement({ ...base, config: { ...base.config, connectivity: { ...base.config.connectivity, publicRpcUrls: [rejectingRpc.url.href] } } }, plan)).rejects.toThrow('Every public RPC rejected the transaction')
			expect(rejected.map(record => record.status)).toEqual(['pending', 'dropped'])
			// A pause that fires between the journal write and the send leaves nothing in flight either.
			const paused: SettlementRecord[] = []
			let pauseChecks = 0
			const pausing = await context(paused, [])
			await expect(executeSettlement({ ...pausing, isPaused: () => pauseChecks++ >= 2 }, plan)).rejects.toThrow()
			expect(paused.map(record => record.status)).toEqual(['pending', 'dropped'])
			expect(
				settlementGasSpentAttoEthOnUtcDay(
					[...rejected, ...paused].filter(record => record.status === 'dropped'),
					new Date(),
				),
			).toBe(0n)
			expect(await client.readContract({ abi: openOracleAbi, address: openOracle, functionName: 'storedGame', args: [report.helper.reportId] }).then(game => game[4])).toBe(0n)
			// The dropped attempts hold the report until their horizon finalizes (no re-sign on every scan), then release it and, as
			// public attempts that no node accepted, leave the recheck set for good.
			const dropped = [...rejected, ...paused].filter(record => record.status === 'dropped')
			const [first] = dropped
			if (first === undefined) throw new Error('dropped record missing')
			const horizonFinalized = BigInt(first.lastValidBlockNumber) + ATTEMPT_FINALITY_BLOCKS
			expect(dropped.map(record => settlementAttemptHoldsFlow(record, horizonFinalized - 1n))).toEqual([true, true])
			expect(dropped.map(record => settlementAttemptHoldsFlow(record, horizonFinalized))).toEqual([false, false])
			expect(dropped.map(record => settlementAttemptIsUnresolved(record, horizonFinalized))).toEqual([false, false])
			// Through the stage, a refusal that repeats leaves the report in flight instead of re-signing on the next scan.
			const journalDirectory = await mkdtemp(join(tmpdir(), 'zoltar-settlement-refusal-'))
			try {
				const block = await client.getBlock()
				if (block.number === null || block.number === undefined) throw new Error('head block number missing')
				const stageConfig: SettlementStageConfiguration & { positionFile: string } = {
					connectivity: { publicRpcUrls: [rejectingRpc.url.href], readRpcUrl: node.rpcUrl },
					execute: true,
					network,
					openOracle,
					pollMilliseconds: 1_000,
					positionFile: join(journalDirectory, 'positions.json'),
					quorumRpcUrls: [],
					riskLimits: { lifecycleGasReserveAttoWeth: 0n, maxConcurrentPositions: 1, maxDailyGasSpendAttoWeth: 10n ** 18n, maxPositionNotionalAttoWeth: 10n ** 18n, maxTotalLockedAttoWeth: 10n ** 18n },
					settlement: { ...settlement, rewardWithdrawThresholdAttoEth: 100n * 10n ** 18n },
					submission: validateSubmissionSettings({ mode: 'public', relayUrls: [] }),
				}
				const state = { blockTimestamp: block.timestamp.toString(), operationLog: [] as OperationEntry[], paused: false, settlements: emptySettlementSnapshot() }
				const journal = await createSettlementJournal(stageConfig, state)
				const policy: CoordinatorGamePolicy = { ...report.game, coordinator: reporter.account.address, openOracle }
				const stage = () =>
					runSettlementStage({
						block: { baseFeePerGas: block.baseFeePerGas ?? 0n, number: block.number ?? 0n, timestamp: block.timestamp },
						client,
						config: stageConfig,
						coordinatorPolicies: [policy],
						dailyPositionGasSpentAttoWeth: 0n,
						gasPrice: 2n * GWEI,
						isPaused: () => false,
						journal,
						readClients: [client],
						reports: [{ latest: report, settled: false, steps: [] }],
						state,
						tokenSymbol: () => 'TK2',
						track: () => {},
						transactionSlotFree: true,
						wallet,
					})
				await stage()
				expect(state.settlements.queue[0]?.decision).toBe('execution-failed')
				expect(journal.records.map(record => record.status)).toEqual(['dropped'])
				await stage()
				expect(state.settlements.queue[0]?.decision).toBe('in-flight')
				expect(journal.records.map(record => record.status)).toEqual(['dropped'])
			} finally {
				await rm(journalDirectory, { force: true, recursive: true })
			}
			// Until then they are still rechecked; their nonces were never consumed, so nothing changes.
			expect(
				await reconcilePendingSettlements(
					[client],
					base.config,
					[...rejected, ...paused].filter(record => record.status === 'dropped'),
					await client.getBlockNumber(),
				),
			).toEqual([])
		} finally {
			rejectingRpc.stop(true)
		}
	})

	test('keeps a public attempt pending when the RPC failed after it may have ingested the transaction', async () => {
		const report = await submitReport()
		await pastSettlementWindow()
		// The node ingests and mines the raw transaction, but the operator only sees an HTTP failure for the send.
		const lossyRpc = Bun.serve({
			port: 0,
			async fetch(request) {
				const body: unknown = await request.json()
				const forwarded = await fetch(node.rpcUrl, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' })
				if (typeof body === 'object' && body !== null && Reflect.get(body, 'method') === 'eth_sendRawTransaction') return new Response('unavailable', { status: 503 })
				return forwarded
			},
		})
		try {
			const records: SettlementRecord[] = []
			const base = await context(records, [])
			const plan = { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 10n ** 15n, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' }
			await expect(executeSettlement({ ...base, config: { ...base.config, connectivity: { ...base.config.connectivity, publicRpcUrls: [lossyRpc.url.href] } } }, plan)).rejects.toThrow('Every public RPC rejected the transaction')
			// Not a refusal everywhere, so the attempt stays live: it still holds the report and charges its exposure.
			expect(records.map(record => record.status)).toEqual(['pending'])
			expect(settlementGasSpentAttoEthOnUtcDay(records, new Date())).toBe(10n ** 15n)
			const [attempt] = records
			if (attempt === undefined) throw new Error('pending record missing')
			expect((await reconcilePendingSettlements([client], base.config, [attempt], await client.getBlockNumber())).map(record => record.status)).toEqual(['confirmed'])
			expect(await client.readContract({ abi: openOracleAbi, address: openOracle, functionName: 'storedGame', args: [report.helper.reportId] }).then(game => game[4])).not.toBe(0n)
		} finally {
			lossyRpc.stop(true)
		}
	})

	test('recovers interrupted attempts from receipts, adopts an intent-matching rebroadcast, and retires only nonces taken by other transactions', async () => {
		const report = await submitReport()
		await pastSettlementWindow()
		const records: SettlementRecord[] = []
		const confirmed = await executeSettlement(await context(records, []), { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 10n ** 15n, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' })
		const pending = (transactionHash: Hex, overrides: Partial<SettlementRecord> = {}): SettlementRecord => ({ ...confirmed, actualGasCostEth: undefined, minedAt: undefined, status: 'pending', transactionHash, ...overrides })
		// The settle consumed its nonce more than a reorg window ago, so nonce-based recovery may judge it.
		await node.anvilWindowEthereum.request({ method: 'anvil_mine', params: ['0x28'] })
		const head = await client.getBlockNumber()
		const config = { connectivity: { publicRpcUrls: [node.rpcUrl], readRpcUrl: node.rpcUrl }, quorumRpcUrls: [] }
		const unrelatedIntent = { data: '0x' as Hex, to: account.address, value: '1' }
		const futureNonce = (await client.getTransactionCount({ address: account.address, blockTag: 'pending' })).toString()
		const resolved = await reconcilePendingSettlements([client], config, [confirmed, pending(confirmed.transactionHash), pending(`0x${'ab'.repeat(32)}`, { submissionBlockNumber: '0', transactionIntent: unrelatedIntent }), pending(`0x${'ef'.repeat(32)}`, { nonce: futureNonce, submissionBlockNumber: '0' })], head)
		expect(resolved.map(entry => `${entry.transactionHash.slice(0, 6)}:${entry.status}`)).toEqual([`${confirmed.transactionHash.slice(0, 6)}:confirmed`, '0xabab:expired'])
		expect(resolved[0]?.actualGasCostEth).toBe(confirmed.actualGasCostEth)
		expect(resolved[0]?.minedAt).toBe(confirmed.minedAt)
		// A rebroadcast under a hash the journal does not know keeps the original's identity but carries the mined hash and gas.
		const adopted = await reconcilePendingSettlements([client], config, [pending(`0x${'cd'.repeat(32)}`)], head)
		expect(adopted.map(entry => `${entry.transactionHash.slice(0, 6)}:${entry.status}`)).toEqual(['0xcdcd:expired', `${confirmed.transactionHash.slice(0, 6)}:confirmed`])
		expect(adopted[1]).toMatchObject({ actualGasCostEth: confirmed.actualGasCostEth, minedAt: confirmed.minedAt, nonce: confirmed.nonce, reportId: confirmed.reportId })
		// When the consumer is the bot's own re-send the journal already holds its record, so only the old hash is retired.
		expect((await reconcilePendingSettlements([client], config, [confirmed, pending(`0x${'cd'.repeat(32)}`)], head)).map(entry => `${entry.transactionHash.slice(0, 6)}:${entry.status}`)).toEqual(['0xcdcd:expired'])
		expect(await reconcilePendingSettlements([client], config, [confirmed], head)).toEqual([])
		// A public transaction never expires by block count: an unconsumed nonce stays pending however far the head moves.
		await node.anvilWindowEthereum.request({ method: 'anvil_mine', params: ['0x12c'] })
		expect(await reconcilePendingSettlements([client], config, [pending(`0x${'ef'.repeat(32)}`, { nonce: futureNonce, submissionBlockNumber: '0' })], await client.getBlockNumber())).toEqual([])
		// A retired attempt is final: its nonce is gone, so nothing rechecks it.
		expect(await reconcilePendingSettlements([client], config, [{ ...pending(confirmed.transactionHash), status: 'expired' }], head)).toEqual([])
		// A private relay stops at the signed horizon: once that horizon has finalized without a receipt the attempt is dropped,
		// which frees the report and the budget, but a late receipt or a consumed nonce still resolves it afterwards.
		const latestHead = await client.getBlockNumber()
		const privateAttempt = pending(`0x${'ef'.repeat(32)}`, { lastValidBlockNumber: (latestHead - 12n).toString(), nonce: futureNonce, submissionBlockNumber: '0', submissionMode: 'private' })
		expect((await reconcilePendingSettlements([client], config, [privateAttempt], latestHead)).map(entry => entry.status)).toEqual(['dropped'])
		expect(await reconcilePendingSettlements([client], config, [{ ...privateAttempt, lastValidBlockNumber: (latestHead - 11n).toString() }], latestHead)).toEqual([])
		expect((await reconcilePendingSettlements([client], config, [{ ...privateAttempt, status: 'dropped', transactionHash: confirmed.transactionHash }], latestHead)).map(entry => entry.status)).toEqual(['confirmed'])
		expect((await reconcilePendingSettlements([client], config, [{ ...privateAttempt, nonce: confirmed.nonce, status: 'dropped', transactionIntent: unrelatedIntent }], latestHead)).map(entry => entry.status)).toEqual(['expired'])
	})

	test('signs settlements and withdrawals at the gas price cap so a rising base fee can delay inclusion but never price it above the cap', async () => {
		const report = await submitReport()
		await pastSettlementWindow()
		const mine = async (baseFeeGwei: bigint, blocks = 1) => {
			for (let block = 0; block < blocks; block++) {
				await node.anvilWindowEthereum.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${(baseFeeGwei * GWEI).toString(16)}`] })
				await node.anvilWindowEthereum.request({ method: 'evm_mine', params: [] })
			}
		}
		const records: SettlementRecord[] = []
		const submitted = async (execution: Promise<SettlementRecord>, recordCount: number) => {
			for (let waited = 0; records.length === recordCount && waited < 500; waited++) await Bun.sleep(10)
			const record = records[recordCount]
			if (record === undefined) throw new Error('attempt was not journaled as pending')
			expect(record.status).toBe('pending')
			// 20 gwei compounds past 380 gwei over the signed horizon; the cap holds the signature at 50 gwei.
			expect((await client.getTransaction({ hash: record.transactionHash })).maxFeePerGas).toBe(50n * GWEI)
			return { execution, record }
		}
		await node.anvilWindowEthereum.request({ method: 'evm_setAutomine', params: [false] })
		try {
			await mine(20n)
			const base = await context(records, [])
			expect(base.baseFeePerGas).toBe(20n * GWEI)
			expect(base.maxFeePerGas).toBe(50n * GWEI)
			// Inclusion two blocks later at a doubled base fee pays the base fee plus the tip, well under the cap.
			const settle = await submitted(executeSettlement(base, { coordinator: report.helper.creator, gas: 250_000n, projectedGasCostAttoEth: 310_000n * 50n * GWEI, report, rewardAttoEth: REWARD, token: token2, tokenSymbol: 'TK2' }), 0)
			await mine(40n)
			expect((await settle.execution).status).toBe('confirmed')
			const receipt = await client.getTransactionReceipt({ hash: settle.record.transactionHash })
			expect(receipt.effectiveGasPrice).toBe(42n * GWEI)
			expect(parseDecimalWeth(records[1]?.actualGasCostEth ?? '0')).toBe(receipt.gasUsed * 42n * GWEI)
			// A base fee above the cap for the whole signed horizon never includes the withdrawal: the attempt stays pending
			// with its nonce unconsumed and no gas paid, instead of landing at a price the queue never approved.
			await mine(20n)
			const withdrawal = await submitted(executeRewardWithdrawal(await context(records, []), REWARD), 2)
			await mine(60n, 26)
			await expect(withdrawal.execution).rejects.toThrow('was not confirmed in its parent-bound target block')
			await expect(client.getTransactionReceipt({ hash: withdrawal.record.transactionHash })).rejects.toThrow()
			expect(records.map(record => `${record.kind}:${record.status}`)).toEqual(['settlement:pending', 'settlement:confirmed', 'reward-withdrawal:pending'])
			expect(await reconcilePendingSettlements([client], base.config, [withdrawal.record], await client.getBlockNumber())).toEqual([])
		} finally {
			await node.anvilWindowEthereum.request({ method: 'evm_setAutomine', params: [true] })
			await node.anvilWindowEthereum.setNextBlockBaseFeePerGasToZero()
		}
	})

	test('runs the settlement stage end to end: recovers, publishes, settles the best plan once, then withdraws when due', async () => {
		const journalDirectory = await mkdtemp(join(tmpdir(), 'zoltar-settlement-stage-'))
		try {
			const report = await submitReport(reporter, reporter.account.address)
			await pastSettlementWindow()
			const block = await client.getBlock()
			if (block.number === null || block.number === undefined) throw new Error('head block number missing')
			// Earlier tests may have left rewards unclaimed; the threshold is set so only this test's settlement makes a withdrawal due.
			const alreadyUnclaimed = await unclaimedSettlementReward([client], { connectivity: { publicRpcUrls: [node.rpcUrl], readRpcUrl: node.rpcUrl }, openOracle, quorumRpcUrls: [] }, account.address, block.number)
			const stageConfig: SettlementStageConfiguration & { positionFile: string } = {
				connectivity: { publicRpcUrls: [node.rpcUrl], readRpcUrl: node.rpcUrl },
				execute: true,
				network,
				openOracle,
				pollMilliseconds: 1_000,
				positionFile: join(journalDirectory, 'positions.json'),
				quorumRpcUrls: [],
				riskLimits: { lifecycleGasReserveAttoWeth: 0n, maxConcurrentPositions: 1, maxDailyGasSpendAttoWeth: 10n ** 18n, maxPositionNotionalAttoWeth: 10n ** 18n, maxTotalLockedAttoWeth: 10n ** 18n },
				settlement: { ...settlement, rewardWithdrawThresholdAttoEth: alreadyUnclaimed + REWARD },
				submission: validateSubmissionSettings({ mode: 'public', relayUrls: [] }),
			}
			const state = { blockTimestamp: block.timestamp.toString(), operationLog: [] as OperationEntry[], paused: false, settlements: emptySettlementSnapshot() }
			const journal = await createSettlementJournal(stageConfig, state)
			const policy: CoordinatorGamePolicy = { ...report.game, coordinator: reporter.account.address, openOracle }
			const reports = (): ActiveReport[] => [{ latest: report, settled: false, steps: [] }]
			const stage = (transactionSlotFree: boolean) =>
				runSettlementStage({
					block: { baseFeePerGas: block.baseFeePerGas ?? 0n, number: block.number ?? 0n, timestamp: block.timestamp },
					client,
					config: stageConfig,
					coordinatorPolicies: [policy],
					dailyPositionGasSpentAttoWeth: 0n,
					gasPrice: 2n * 10n ** 9n,
					isPaused: () => false,
					journal,
					readClients: [client],
					reports: reports(),
					state,
					tokenSymbol: () => 'TK2',
					track: () => {},
					transactionSlotFree,
					wallet,
				})
			// A dispute already used this scan's slot: the queue is published but nothing is signed.
			await stage(false)
			expect(state.settlements.queue.map(candidate => [candidate.reportId, candidate.decision])).toEqual([[report.helper.reportId.toString(), 'eligible']])
			expect(state.settlements.withdrawalDecision).toBe('below-threshold')
			expect(journal.records).toEqual([])
			// Free slot: the best plan settles; the withdrawal waits for the next scan even though the accrued reward now meets the threshold.
			await stage(true)
			expect(state.settlements.queue[0]?.decision).toBe('settled')
			expect(journal.records.map(record => `${record.kind}:${record.status}`)).toEqual(['settlement:confirmed'])
			expect(state.operationLog.map(entry => entry.message)).toEqual(['Third-party settlement confirmed'])
			expect(await loadSettlementJournal(settlementJournalPath(stageConfig.positionFile), network.chain.id)).toHaveLength(1)
			// The settled report leaves the queue and the accrued reward is withdrawn in its own scan.
			const settledHead = await client.getBlock()
			if (settledHead.number === null || settledHead.number === undefined) throw new Error('head block number missing')
			block.number = settledHead.number
			block.timestamp = settledHead.timestamp
			const settledReports = (): ActiveReport[] => [{ latest: { ...report, game: { ...report.game, settlementTimestamp: settledHead.timestamp } }, settled: true, steps: [] }]
			await runSettlementStage({
				block: { baseFeePerGas: 0n, number: settledHead.number, timestamp: settledHead.timestamp },
				client,
				config: stageConfig,
				coordinatorPolicies: [policy],
				dailyPositionGasSpentAttoWeth: 0n,
				gasPrice: 2n * 10n ** 9n,
				isPaused: () => false,
				journal,
				readClients: [client],
				reports: settledReports(),
				state,
				tokenSymbol: () => 'TK2',
				track: () => {},
				transactionSlotFree: true,
				wallet,
			})
			expect(state.settlements.queue).toEqual([])
			expect(journal.records.map(record => `${record.kind}:${record.status}`)).toEqual(['reward-withdrawal:confirmed', 'settlement:confirmed'])
			expect(state.settlements.withdrawalDecision).toBe('below-threshold')
			expect(state.settlements.unclaimedRewardEth).toBe('0')
			expect(Number(state.settlements.realizedIncomeEth)).toBeGreaterThan(0.016)
			expect(Number(state.settlements.realizedIncomeEth)).toBeLessThan(0.017044)
			// A restart mid-withdrawal: the mined attempt is still journaled as pending, so it charges its signed exposure to
			// the budget until the pre-evaluation recovery replaces that with the actual cost from its receipt.
			const [withdrawal, settled] = journal.records
			if (withdrawal === undefined || settled === undefined || withdrawal.actualGasCostEth === undefined || settled.actualGasCostEth === undefined) throw new Error('confirmed records missing')
			await journal.persist({ ...withdrawal, actualGasCostEth: undefined, minedAt: undefined, status: 'pending' })
			expect(journal.records.some(record => record.kind === 'reward-withdrawal' && record.status === 'pending')).toBeTrue()
			expect(parseDecimalWeth(state.settlements.utcDayGasSpentEth)).toBe(parseDecimalWeth(settled.actualGasCostEth) + parseDecimalWeth(withdrawal.projectedGasCostEth))
			const withdrawnHead = await client.getBlock()
			if (withdrawnHead.number === null || withdrawnHead.number === undefined) throw new Error('head block number missing')
			await recoverPendingSettlements({ blockNumber: withdrawnHead.number, config: stageConfig, journal, readClients: [client], state })
			expect(journal.records.map(record => `${record.kind}:${record.status}`)).toEqual(['reward-withdrawal:confirmed', 'settlement:confirmed'])
			expect(state.operationLog.map(entry => entry.message)).toContain('Settlement attempt recovered')
			const recoveredGasAttoEth = parseDecimalWeth(settled.actualGasCostEth) + parseDecimalWeth(withdrawal.actualGasCostEth)
			expect(parseDecimalWeth(state.settlements.utcDayGasSpentEth)).toBe(recoveredGasAttoEth)
			// The recovered gas exhausts a budget set just below it, so the next candidate is refused instead of signed.
			await runSettlementStage({
				block: { baseFeePerGas: 0n, number: withdrawnHead.number, timestamp: withdrawnHead.timestamp },
				client,
				config: { ...stageConfig, riskLimits: { ...stageConfig.riskLimits, maxDailyGasSpendAttoWeth: recoveredGasAttoEth - 1n } },
				coordinatorPolicies: [policy],
				dailyPositionGasSpentAttoWeth: 0n,
				gasPrice: 2n * 10n ** 9n,
				isPaused: () => false,
				journal,
				readClients: [client],
				reports: reports(),
				state,
				tokenSymbol: () => 'TK2',
				track: () => {},
				transactionSlotFree: true,
				wallet,
			})
			expect(state.settlements.queue.map(candidate => candidate.decision)).toEqual(['risk-limit'])
			expect(state.settlements.withdrawalDecision).toBe('below-threshold')
			expect(journal.records.map(record => `${record.kind}:${record.status}`)).toEqual(['reward-withdrawal:confirmed', 'settlement:confirmed'])
			// An attempt whose nonce was consumed by the journaled settle with the same intent is retired, and the retirement is
			// logged as the success it is rather than as a lost attempt.
			const rebroadcastHash = `0x${'cd'.repeat(32)}` as const
			await journal.persist({ ...settled, actualGasCostEth: undefined, minedAt: undefined, status: 'pending', transactionHash: rebroadcastHash })
			await node.anvilWindowEthereum.request({ method: 'anvil_mine', params: ['0xd'] })
			state.operationLog.length = 0
			await recoverPendingSettlements({ blockNumber: await client.getBlockNumber(), config: stageConfig, journal, readClients: [client], state })
			expect(journal.records.map(record => `${record.transactionHash === rebroadcastHash ? 'rebroadcast' : record.kind}:${record.status}`)).toEqual(['rebroadcast:expired', 'reward-withdrawal:confirmed', 'settlement:confirmed'])
			expect(state.operationLog.map(entry => [entry.level, entry.details])).toEqual([['info', `status=expired adoptedAs=${settled.transactionHash}`]])
		} finally {
			await rm(journalDirectory, { force: true, recursive: true })
		}
	})
})
