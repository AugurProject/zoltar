import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfiguration } from '#config/configuration'
import { parseOperatorSettings, saveOperatorSettings } from '#config/settings-store'
import { loadPositionJournal } from '#state/position-store'
import { savePositionJournal } from '../support/position-journal.ts'
import example from '../../config/operator.example.json'
import { describe, expect, test } from 'bun:test'
import { encodeEventTopics, mainnet } from '@zoltar/core-shared/evm/ethereum'
import { createPublicClient, createWalletClient, privateKeyToAccount, zeroAddress, decodeFunctionData, encodeAbiParameters, getAddress, type EIP1193Provider, type Hex } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { openOracleAbi, openOracleArbitrageExecutorAbi } from '#contracts/abi'
import { lifecycleBalancesWithQuorum } from '#execution/recovery-support'
import { positionCollateralToken } from '#state/position-collateral'
import {
	createExecutionLockManager,
	discoverPublicReplacementWithQuorum,
	executionRecordForConfirmedPosition,
	expireEntryWithQuorum,
	finalizeEntryAfterFinalityWithQuorum,
	finalizeLifecycleAfterFinalityWithQuorum,
	immediateReplacementAmounts,
	lifecycleExecutionFromLogs,
	reconcileExpiredAttemptsWithQuorum,
	recoverPendingEntryWithQuorum,
	recoverPendingLifecycleWithQuorum,
	replacementCreditExecutionFromLogs,
	persistSignerSettingsWithProvisionalLock,
	processPositionLifecycle,
} from '#cli/run'
import { manuallyReconcilePosition, type PositionRecord } from '#state/position-store'
import { executionIntentFixture, openPositionFixture } from '../support/position-record.ts'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'

const transactionHash = `0x${'11'.repeat(32)}` as Hex
const lifecycleTransactionHash = `0x${'22'.repeat(32)}` as Hex
const token = getAddress('0x0000000000000000000000000000000000000001')
const executor = getAddress('0x0000000000000000000000000000000000000004')
const weth = getAddress('0x0000000000000000000000000000000000000005')
const recoveryConfiguration = {
	connectivity: { publicRpcUrls: ['https://primary.example'], readRpcUrl: 'https://primary.example' },
	executor,
	network: { weth },
	openOracle: getAddress('0x0000000000000000000000000000000000000006'),
	quorumRpcUrls: ['https://secondary.example'],
	rpcQuorum: 1 as const,
	submission: { mode: 'private' as const },
}

const resilientRecoveryConfiguration = {
	...recoveryConfiguration,
	quorumRpcUrls: ['https://secondary.example', 'https://offline.example'],
	rpcQuorum: 1 as const,
}

describe('execution lock lifecycle', () => {
	test('keeps the historical lifecycle API available through the CLI facade', () => {
		expect(typeof discoverPublicReplacementWithQuorum).toBe('function')
		expect(typeof processPositionLifecycle).toBe('function')
	})

	test('reuses a signer lock whose first cleanup attempt fails', async () => {
		const account = getAddress('0x0000000000000000000000000000000000000002')
		let acquisitions = 0
		let releases = 0
		const lock = {
			path: 'signer.lock',
			release: async () => {
				releases += 1
				if (releases === 1) throw new Error('transient signer cleanup failure')
			},
		}
		const manager = createExecutionLockManager(async () => {
			acquisitions += 1
			return lock
		})
		const provisional = await manager.acquireSigner(account)
		let persisted = false
		await expect(
			persistSignerSettingsWithProvisionalLock(
				async () => {
					throw new Error('settings write failed')
				},
				provisional,
				manager,
			),
		).rejects.toThrow('provisional lock could not be released')
		expect(persisted).toBe(false)
		const retained = await manager.acquireSigner(account)
		expect(retained).toBe(provisional)
		expect(acquisitions).toBe(1)
		await persistSignerSettingsWithProvisionalLock(
			async () => {
				persisted = true
			},
			retained,
			manager,
		)
		expect(persisted).toBe(true)
		await manager.releaseAll()
		expect(releases).toBe(2)
	})
})

function rpcBlock(number: string, hash: string, gasUsed: string) {
	return {
		baseFeePerGas: '0x1',
		difficulty: '0x0',
		extraData: '0x',
		gasLimit: '0x1c9c380',
		gasUsed,
		hash,
		logsBloom: `0x${'00'.repeat(256)}`,
		miner: getAddress('0x0000000000000000000000000000000000000000'),
		mixHash: `0x${'00'.repeat(32)}`,
		nonce: '0x0000000000000000',
		number,
		parentHash: `0x${'bb'.repeat(32)}`,
		receiptsRoot: `0x${'00'.repeat(32)}`,
		sha3Uncles: `0x${'00'.repeat(32)}`,
		size: '0x1',
		stateRoot: `0x${'00'.repeat(32)}`,
		timestamp: '0x66a1a000',
		totalDifficulty: '0x0',
		transactions: [],
		transactionsRoot: `0x${'00'.repeat(32)}`,
		uncles: [],
	}
}

function rpcReceipt(fields: { blockHash: string; blockNumber: string; from: string; logs: readonly Record<string, unknown>[]; status: string; transactionHash: Hex }) {
	return {
		...fields,
		contractAddress: null,
		cumulativeGasUsed: '0x5208',
		effectiveGasPrice: '0x3b9aca00',
		gasUsed: '0x5208',
		logsBloom: `0x${'00'.repeat(256)}`,
		to: executor,
		transactionIndex: '0x0',
		type: '0x2',
	}
}

/** Clients whose receipt carries one successful executor event emitted by the lifecycle transaction. */
function executorEventReceiptClients(topics: readonly unknown[], data: Hex, blockNumber: bigint, headBlockNumbers?: readonly bigint[] | undefined, offlineFinalityIndexes: readonly number[] = []) {
	const log = {
		address: executor,
		blockHash: `0x${'aa'.repeat(32)}`,
		blockNumber: `0x${blockNumber.toString(16)}`,
		data,
		logIndex: '0x0',
		removed: false,
		topics,
		transactionHash: lifecycleTransactionHash,
		transactionIndex: '0x0',
	}
	return receiptClients(blockNumber, 'success', [log], lifecycleTransactionHash, headBlockNumbers, offlineFinalityIndexes)
}

function missingReceiptClients(confirmedNonce?: bigint | undefined, headBlockNumbers: readonly bigint[] = [112n, 112n], finalityBlockHashes: readonly Hex[] = [`0x${'cc'.repeat(32)}`, `0x${'cc'.repeat(32)}`]) {
	return ['primary', 'secondary'].map((_, index) => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') return Promise.resolve(null)
				if (parameters.method === 'eth_getTransactionCount' && confirmedNonce !== undefined) return Promise.resolve(`0x${confirmedNonce.toString(16)}`)
				if (parameters.method === 'eth_getBlockByNumber') {
					if (!Array.isArray(parameters.params)) throw new Error('Missing receipt test expected block request parameters')
					const requested = parameters.params[0]
					if (typeof requested !== 'string' || !/^0x[0-9a-f]+$/i.test(requested)) throw new Error('Missing receipt test expected a numeric block tag')
					const requestedBlockNumber = BigInt(requested)
					const headBlockNumber = headBlockNumbers[index]
					if (headBlockNumber === undefined || requestedBlockNumber > headBlockNumber) return Promise.resolve(null)
					const hash = finalityBlockHashes[index]
					if (hash === undefined) throw new Error('Missing receipt test finality hash is unavailable')
					return Promise.resolve(rpcBlock(requested, hash, '0x0'))
				}
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function offlineReadClient() {
	return createPublicClient({
		chain: mainnet,
		transport: custom({ request: () => Promise.reject(new TypeError('fetch failed')) }),
	})
}

function receiptClients(blockNumber = 100n, status: 'reverted' | 'success' = 'reverted', logs: readonly Record<string, unknown>[] = [], receiptTransactionHash = transactionHash, headBlockNumbers: readonly bigint[] = [blockNumber + 12n, blockNumber + 12n], offlineFinalityIndexes: readonly number[] = []) {
	const receiptBlockHash = `0x${'aa'.repeat(32)}`
	const finalityBlockHash = `0x${'cc'.repeat(32)}`
	const blockNumberHex = `0x${blockNumber.toString(16)}`
	return ['primary', 'secondary'].map((_, index) => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') {
					return Promise.resolve(rpcReceipt({ blockHash: receiptBlockHash, blockNumber: blockNumberHex, from: getAddress('0x0000000000000000000000000000000000000002'), logs, status: status === 'success' ? '0x1' : '0x0', transactionHash: receiptTransactionHash }))
				}
				if (parameters.method === 'eth_getBlockByNumber') {
					if (!Array.isArray(parameters.params)) throw new Error('Receipt test expected block request parameters')
					const requested = parameters.params[0]
					if (typeof requested !== 'string' || !/^0x[0-9a-f]+$/i.test(requested)) throw new Error('Receipt test expected a numeric block tag')
					const requestedBlockNumber = BigInt(requested)
					if (requestedBlockNumber > blockNumber && offlineFinalityIndexes.includes(index)) throw new TypeError('fetch failed')
					const headBlockNumber = headBlockNumbers[index]
					if (headBlockNumber === undefined || requestedBlockNumber > headBlockNumber) return Promise.resolve(null)
					return Promise.resolve(rpcBlock(requested, requestedBlockNumber === blockNumber ? receiptBlockHash : finalityBlockHash, '0x5208'))
				}
				if (parameters.method === 'eth_getTransactionCount') return Promise.resolve('0x9')
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function lifecycleReceiptClients(
	blockNumber = 100n,
	headBlockNumbers?: readonly bigint[] | undefined,
	settlerRewardAttoEth = 0n,
	offlineFinalityIndexes: readonly number[] = [],
	account = getAddress('0x0000000000000000000000000000000000000002'),
	token1: { address: Hex; amount: bigint } = { address: weth, amount: 10n ** 18n },
) {
	const topics = encodeEventTopics({
		abi: openOracleArbitrageExecutorAbi,
		eventName: 'LifecycleExecuted',
		args: { account, reportId: 7n, token1: token1.address },
	})
	if (topics.some(topic => topic === null)) throw new Error('Lifecycle event topics are incomplete')
	const data = encodeAbiParameters(
		[
			{ name: 'amount1', type: 'uint256' },
			{ name: 'token2', type: 'address' },
			{ name: 'amount2', type: 'uint256' },
			{ name: 'settlerRewardAttoEth', type: 'uint256' },
		],
		[token1.amount, token, 2n * 10n ** 18n, settlerRewardAttoEth],
	)
	return executorEventReceiptClients(topics, data, blockNumber, headBlockNumbers, offlineFinalityIndexes)
}

/** Clients whose successful private entry receipt carries the executor's report-7 hedge event. */
function entryReceiptClients(blockNumber = 100n, headBlockNumbers?: readonly bigint[] | undefined, hedgeAmountToken1 = 10n ** 18n) {
	const topics = encodeEventTopics({
		abi: openOracleArbitrageExecutorAbi,
		eventName: 'HedgeAndDisputeExecuted',
		args: { account: getAddress('0x0000000000000000000000000000000000000002'), reportId: 7n },
	})
	if (topics.some(topic => topic === null)) throw new Error('Entry event topics are incomplete')
	const data = encodeAbiParameters(
		[
			{ name: 'boughtToken2', type: 'bool' },
			{ name: 'hedgeAmountToken2', type: 'uint256' },
			{ name: 'hedgeAmountAttoWeth', type: 'uint256' },
			{ name: 'contribution1', type: 'uint256' },
			{ name: 'contribution2', type: 'uint256' },
		],
		[false, 2n * 10n ** 18n, hedgeAmountToken1, 0n, 0n],
	)
	const log = {
		address: executor,
		blockHash: `0x${'aa'.repeat(32)}`,
		blockNumber: `0x${blockNumber.toString(16)}`,
		data,
		logIndex: '0x0',
		removed: false,
		topics,
		transactionHash,
		transactionIndex: '0x0',
	}
	return receiptClients(blockNumber, 'success', [log], transactionHash, headBlockNumbers ?? [blockNumber + 12n, blockNumber + 12n])
}

function replacementCreditReceiptClients(blockNumber = 100n, headBlockNumbers?: readonly bigint[] | undefined, credit: { amount: bigint; token: Hex } = { amount: 2n * 10n ** 18n, token: weth }) {
	const account = getAddress('0x0000000000000000000000000000000000000002')
	const topics = encodeEventTopics({
		abi: openOracleArbitrageExecutorAbi,
		eventName: 'ReplacementCreditWithdrawn',
		args: { account, reportId: 7n, token: credit.token },
	})
	if (topics.some(topic => topic === null)) throw new Error('Replacement-credit event topics are incomplete')
	const data = encodeAbiParameters([{ name: 'amount', type: 'uint256' }], [credit.amount])
	return executorEventReceiptClients(topics, data, blockNumber, headBlockNumbers)
}

function successfulMismatchedIntentClients(receiptTransactionHash = transactionHash) {
	const blockHash = `0x${'aa'.repeat(32)}`
	const account = getAddress('0x0000000000000000000000000000000000000002')
	return ['primary', 'secondary'].map(() => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') {
					return Promise.resolve(rpcReceipt({ blockHash, blockNumber: '0x64', from: account, logs: [], status: '0x1', transactionHash: receiptTransactionHash }))
				}
				if (parameters.method === 'eth_getTransactionByHash') {
					return Promise.resolve({
						blockHash,
						blockNumber: '0x64',
						from: account,
						gas: '0x5208',
						hash: receiptTransactionHash,
						input: '0xabcd',
						maxFeePerGas: '0x3b9aca00',
						maxPriorityFeePerGas: '0x1',
						nonce: '0x8',
						to: executor,
						transactionIndex: '0x0',
						type: '0x2',
						value: '0x0',
					})
				}
				if (parameters.method === 'eth_getBlockByNumber') {
					return Promise.resolve(rpcBlock('0x64', blockHash, '0x5208'))
				}
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function confirmedPosition(): PositionRecord {
	return openPositionFixture({
		entrySubmissionBlockNumber: '99',
		entrySubmissionMode: 'public',
		entryTransactionNonce: '8',
		executionIntent: executionIntentFixture(),
		gasExpenditures: [{ costEth: '0.001', includedAt: '2026-07-24T00:00:00.000Z', transactionHash }],
		openedAt: '2026-07-24T00:00:00.000Z',
	})
}

/** A journaled entry whose receipt has not been observed yet. */
function pendingEntryPosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
	return { ...confirmedPosition(), actualEntryGasCostEth: '0', entrySubmissionMode: 'private', gasExpenditures: [], status: 'pending-entry', ...overrides }
}

/** An absent entry that released its risk slot while its signed attempt may still be included. */
function expiredEntryPosition(): PositionRecord {
	return {
		...confirmedPosition(),
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: '0',
		expiredTransactionAttempts: [{ kind: 'entry', nonce: '8', targetBlockNumber: '100', transactionHash }],
		gasExpenditures: [],
		realizedNetProfitEth: '0',
		status: 'expired-not-included',
	}
}

/** A signed lifecycle transaction targeting block 100 whose receipt has not been observed yet. */
function withdrawingPosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
	return {
		...confirmedPosition(),
		lifecycleSubmissionBlockNumber: '99',
		lifecycleSubmissionMode: 'private',
		lifecycleTargetBlockNumber: '100',
		lifecycleTokenDecimals: '18',
		lifecycleTransactionNonce: '9',
		lifecycleTransactionHashes: [lifecycleTransactionHash],
		status: 'withdrawing',
		...overrides,
	}
}

describe('entry crash recovery', () => {
	test('reconstructs the complete idempotent history outbox from the pre-journaled execution intent', () => {
		const record = executionRecordForConfirmedPosition(confirmedPosition(), 100n, transactionHash)
		expect(record).toEqual({
			actualGasCostEth: '0.001',
			blockNumber: '100',
			direction: 'sell-rep',
			estimatedNetProfitWeth: '0.05',
			estimatedProfitBeforeGasEth: '0.051',
			executedAt: '2026-07-24T00:00:00.000Z',
			pool: getAddress('0x0000000000000000000000000000000000000003'),
			poolFee: 10_000,
			reportId: '7',
			requiredToken: '1',
			requiredWeth: '2',
			token,
			tokenSymbol: 'REP',
			trackedNetProfitEth: '0.099',
			transactionHash,
		})
	})

	test.each(['private', 'public'] as const)('releases the risk slot after an absent %s entry has twelve canonical descendants', async entrySubmissionMode => {
		const position = pendingEntryPosition({ entrySubmissionMode })
		const recovered = await expireEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')
		expect(recovered.status).toBe('expired-not-included')
		expect(recovered.capitalAtRiskWeth).toBe('0')
		expect(recovered.lockedWeth).toBe('0')
		expect(recovered.realizedNetProfitEth).toBe('0')
	})

	test('expires an absent entry when two readers agree and a third is offline', async () => {
		const position = pendingEntryPosition()
		const recovered = await expireEntryWithQuorum([...missingReceiptClients(), offlineReadClient()], resilientRecoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')
		expect(recovered.status).toBe('expired-not-included')
	})

	test('retains an absent entry until two RPCs serve the same finality descendant', async () => {
		const position = pendingEntryPosition()
		await expect(expireEntryWithQuorum(missingReceiptClients(undefined, [112n, 100n]), { ...recoveryConfiguration, rpcQuorum: 2 as const }, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('requires at least')
		await expect(expireEntryWithQuorum(missingReceiptClients(undefined, [112n, 112n], [`0x${'cc'.repeat(32)}`, `0x${'dd'.repeat(32)}`]), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('RPC disagreement')
	})

	test('continues accounting late revert gas after an absent private entry releases its risk slot', async () => {
		const position = expiredEntryPosition()
		const recovered = await reconcileExpiredAttemptsWithQuorum(receiptClients(113n), recoveryConfiguration, position, 125n)
		expect(recovered.expiredTransactionAttempts).toEqual([])
		expect(recovered.actualEntryGasCostEth).toBe('0.000021')
		expect(recovered.realizedNetProfitEth).toBe('-0.000021')
		expect(recovered.gasExpenditures).toHaveLength(1)
	})

	test('keeps manual reconciliation terminal after a late successful expired attempt', async () => {
		const position = expiredEntryPosition()
		const needsManualRecovery = await reconcileExpiredAttemptsWithQuorum(receiptClients(113n, 'success'), recoveryConfiguration, position, 125n)
		expect(needsManualRecovery.status).toBe('recovery-required')
		const closed = manuallyReconcilePosition(needsManualRecovery, {
			confirmedReportId: '7',
			evidence: 'Late successful archived entry was reconciled against canonical receipts and final balances.',
			externalCostEth: '0',
			finalWalletToken: '2',
			finalWalletWeth: '1',
			note: 'Residual assets were reconciled and the position was closed.',
			pnlUnavailable: false,
			realizedNetProfitEth: '-0.000021',
			recordedAt: '2026-07-24T00:03:00.000Z',
			recordedBy: needsManualRecovery.account,
		})
		const monitored = await reconcileExpiredAttemptsWithQuorum(receiptClients(113n, 'success'), recoveryConfiguration, closed, 126n)
		expect(monitored).toBe(closed)
		expect(monitored.status).toBe('closed')
		expect(monitored.expiredTransactionAttempts).toEqual(position.expiredTransactionAttempts)
	})

	test('stops monitoring an absent hash after quorum proves its nonce was consumed', async () => {
		const position = expiredEntryPosition()
		const recovered = await reconcileExpiredAttemptsWithQuorum(missingReceiptClients(9n), recoveryConfiguration, position, 125n)
		expect(recovered.expiredTransactionAttempts).toEqual([])
		expect(recovered.actualEntryGasCostEth).toBe('0')
		expect(recovered.gasExpenditures).toEqual([])
	})

	test('does not auto-expire a legacy multi-transaction entry with independently live signatures', async () => {
		const position = pendingEntryPosition({ entryTransactionHashes: [`0x${'22'.repeat(32)}` as Hex, transactionHash] })
		await expect(expireEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('Only an atomic entry')
	})

	test('releases a reverted atomic private entry after accounting for its gas', async () => {
		const position = pendingEntryPosition()
		const recovered = await recoverPendingEntryWithQuorum(receiptClients(), recoveryConfiguration, position, 18)
		expect(recovered.position.status).toBe('closed')
		expect(recovered.position.capitalAtRiskWeth).toBe('0')
		expect(recovered.position.lockedWeth).toBe('0')
		expect(recovered.position.realizedNetProfitEth).toBe('-0.000021')
	})

	test('requires manual recovery for quorum-confirmed private entry receipts without executor evidence', async () => {
		const position = pendingEntryPosition()
		const recovered = await recoverPendingEntryWithQuorum(successfulMismatchedIntentClients(), recoveryConfiguration, position, 18)
		expect(recovered.position.status).toBe('recovery-required')
		expect(recovered.position.actualEntryGasCostEth).toBe('0.000021')
	})

	test('keeps a quorum-confirmed entry pending finality without releasing its history record', async () => {
		const provisional = (await recoverPendingEntryWithQuorum(entryReceiptClients(), recoveryConfiguration, pendingEntryPosition(), 18)).position
		expect(provisional.status).toBe('open-pending-finality')
		expect(provisional.entryReceiptBlockHash).toBe(`0x${'aa'.repeat(32)}`)
		expect(provisional.entryReceiptBlockNumber).toBe('100')
		expect(provisional.actualEntryGasCostEth).toBe('0.000021')
		expect(provisional.historyOutbox).toBeUndefined()
		const beforeFinality = await finalizeEntryAfterFinalityWithQuorum(missingReceiptClients(), recoveryConfiguration, provisional, 111n)
		expect(beforeFinality).toBe(provisional)
	})

	test('rolls a reorged-out entry back to pending and expires it without recording history', async () => {
		const provisional = (await recoverPendingEntryWithQuorum(entryReceiptClients(), recoveryConfiguration, pendingEntryPosition(), 18)).position
		const rolledBack = await finalizeEntryAfterFinalityWithQuorum(missingReceiptClients(), recoveryConfiguration, provisional, 112n)
		expect(rolledBack.status).toBe('pending-entry')
		expect(rolledBack.actualEntryGasCostEth).toBe('0')
		expect(rolledBack.gasExpenditures).toEqual([])
		expect(rolledBack.historyOutbox).toBeUndefined()
		expect(rolledBack.entryReceiptBlockHash).toBeUndefined()
		expect(rolledBack.entryReceiptBlockNumber).toBeUndefined()
		const expired = await expireEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, rolledBack, 112n, '2026-07-24T00:02:00.000Z')
		expect(expired.status).toBe('expired-not-included')
		expect(expired.capitalAtRiskWeth).toBe('0')
		expect(expired.historyOutbox).toBeUndefined()
		expect(expired.expiredTransactionAttempts).toEqual([{ kind: 'entry', nonce: '8', targetBlockNumber: '100', transactionHash }])
	})

	test('keeps a pending entry when its readers have not served the finality descendant', async () => {
		const provisional = (await recoverPendingEntryWithQuorum(entryReceiptClients(), recoveryConfiguration, pendingEntryPosition(), 18)).position
		await expect(finalizeEntryAfterFinalityWithQuorum(missingReceiptClients(undefined, [112n, 100n]), { ...recoveryConfiguration, rpcQuorum: 2 as const }, provisional, 112n)).rejects.toThrow('requires at least')
	})

	test('re-derives an entry whose receipt moved to another block instead of finalizing stale evidence', async () => {
		const provisional = (await recoverPendingEntryWithQuorum(entryReceiptClients(), recoveryConfiguration, pendingEntryPosition(), 18)).position
		const rolledBack = await finalizeEntryAfterFinalityWithQuorum(entryReceiptClients(101n), recoveryConfiguration, provisional, 113n)
		expect(rolledBack.status).toBe('pending-entry')
		expect(rolledBack.actualEntryGasCostEth).toBe('0')
		expect(rolledBack.historyOutbox).toBeUndefined()
	})

	test('opens an entry and releases its history record once after twelve canonical descendants', async () => {
		const clients = entryReceiptClients()
		const provisional = (await recoverPendingEntryWithQuorum(clients, recoveryConfiguration, pendingEntryPosition(), 18)).position
		const finalized = await finalizeEntryAfterFinalityWithQuorum(clients, recoveryConfiguration, provisional, 112n)
		expect(finalized.status).toBe('open')
		expect(finalized.entryReceiptBlockHash).toBeUndefined()
		expect(finalized.entryReceiptBlockNumber).toBeUndefined()
		expect(finalized.historyOutbox).toEqual(executionRecordForConfirmedPosition(provisional, 100n, transactionHash))
		const repeated = await finalizeEntryAfterFinalityWithQuorum(clients, recoveryConfiguration, { ...finalized, historyOutbox: undefined }, 113n)
		expect(repeated.historyOutbox).toBeUndefined()
		expect(repeated.status).toBe('open')
	})

	test('keeps a successful public replacement with different calldata in recovery after accounting gas', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			entryTransactionIntent: { data: '0x1234' as Hex, to: executor, value: '0' },
			gasExpenditures: [],
			status: 'recovery-required' as const,
		}
		const recovered = await recoverPendingEntryWithQuorum(successfulMismatchedIntentClients(), recoveryConfiguration, position, 18)
		expect(recovered.position.status).toBe('recovery-required')
		expect(recovered.position.capitalAtRiskWeth).toBe('2')
		expect(recovered.position.actualEntryGasCostEth).toBe('0.000021')
		expect(recovered.position.historyOutbox).toBeUndefined()
	})
})

describe('atomic lifecycle crash recovery', () => {
	test('uses the immediate successor to the bot entry rather than a later report for replacement credit', () => {
		const position = confirmedPosition()
		expect(
			immediateReplacementAmounts(position, {
				steps: [
					{ amount1: '1200', amount2: '900', blockNumber: '99', event: 'disputed', reporter: position.account, transactionHash: position.entryTransactionHash },
					{ amount1: '1300', amount2: '800', blockNumber: '100', event: 'disputed', reporter: executor, transactionHash: `0x${'55'.repeat(32)}` },
					{ amount1: '1400', amount2: '1500', blockNumber: '101', event: 'disputed', reporter: position.account, transactionHash: `0x${'66'.repeat(32)}` },
				],
			}),
		).toEqual({ amount1: 1300n, amount2: 800n })
	})

	test('derives exact position withdrawals from executor evidence instead of whole-wallet deltas', () => {
		const account = getAddress('0x0000000000000000000000000000000000000002')
		const token1 = weth
		const token2 = getAddress('0x0000000000000000000000000000000000000006')
		const topics = encodeEventTopics({
			abi: openOracleArbitrageExecutorAbi,
			eventName: 'LifecycleExecuted',
			args: { account, reportId: 7n, token1 },
		})
		if (topics.some(topic => topic === null)) throw new Error('Lifecycle event topics are incomplete')
		const encodedTopics = topics.filter((topic): topic is Hex => topic !== null)
		const data = encodeAbiParameters(
			[
				{ name: 'amount1', type: 'uint256' },
				{ name: 'token2', type: 'address' },
				{ name: 'amount2', type: 'uint256' },
				{ name: 'settlerRewardAttoEth', type: 'uint256' },
			],
			[11n, token2, 22n, 3n],
		)
		expect(lifecycleExecutionFromLogs([{ address: executor, data, topics: encodedTopics }], executor)).toEqual({
			account,
			amount1: 11n,
			amount2: 22n,
			reportId: 7n,
			settlerRewardAttoEth: 3n,
			token1,
			token2,
		})
	})

	test('derives exact replacement-credit withdrawals from executor evidence', () => {
		const account = getAddress('0x0000000000000000000000000000000000000002')
		const topics = encodeEventTopics({
			abi: openOracleArbitrageExecutorAbi,
			eventName: 'ReplacementCreditWithdrawn',
			args: { account, reportId: 7n, token: weth },
		})
		if (topics.some(topic => topic === null)) throw new Error('Replacement-credit event topics are incomplete')
		const encodedTopics = topics.filter((topic): topic is Hex => topic !== null)
		const data = encodeAbiParameters([{ name: 'amount', type: 'uint256' }], [22n])
		expect(replacementCreditExecutionFromLogs([{ address: executor, data, topics: encodedTopics }], executor)).toEqual({
			account,
			amount: 22n,
			reportId: 7n,
			token: weth,
		})
	})

	test.each(['private', 'public'] as const)('clears an atomically guarded %s lifecycle attempt that was not included', async lifecycleSubmissionMode => {
		const position = withdrawingPosition({ lifecycleSubmissionMode })
		const recovered = await recoverPendingLifecycleWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n)
		expect(recovered.status).toBe('open')
		expect(recovered.lifecycleTransactionHashes).toEqual([])
		expect(recovered.lifecycleSubmissionBlockNumber).toBeUndefined()
		expect(recovered.lifecycleTargetBlockNumber).toBeUndefined()
		expect(recovered.expiredTransactionAttempts).toEqual([{ kind: 'lifecycle', nonce: '9', targetBlockNumber: '100', transactionHash: lifecycleTransactionHash }])
	})

	test('retains an absent lifecycle attempt until two RPCs serve the same finality descendant', async () => {
		const position = withdrawingPosition()
		await expect(recoverPendingLifecycleWithQuorum(missingReceiptClients(undefined, [112n, 100n]), { ...recoveryConfiguration, rpcQuorum: 2 as const }, position, 112n)).rejects.toThrow('requires at least')
		await expect(recoverPendingLifecycleWithQuorum(missingReceiptClients(undefined, [112n, 112n], [`0x${'cc'.repeat(32)}`, `0x${'dd'.repeat(32)}`]), recoveryConfiguration, position, 112n)).rejects.toThrow('RPC disagreement')
	})

	test('keeps a successful lifecycle provisional until twelve canonical descendants', async () => {
		const position = withdrawingPosition({
			lifecycleReceiptBlockHash: `0x${'aa'.repeat(32)}`,
			lifecycleReceiptBlockNumber: '100',
			lifecycleReceiptRecovered: true,
			lifecycleSubmissionMode: 'public',
			lifecycleUpdatedAt: '2026-07-24T00:01:00.000Z',
			status: 'closed-pending-finality',
			withdrawnToken: '2',
			withdrawnWeth: '1',
		})
		const provisional = await finalizeLifecycleAfterFinalityWithQuorum(receiptClients(100n), recoveryConfiguration, position, 111n)
		expect(provisional.status).toBe('closed-pending-finality')
		expect(provisional.realizedNetProfitEth).toBeUndefined()
		expect(provisional.lifecycleTransactionHashes).toEqual([lifecycleTransactionHash])
	})

	test('finalizes exact lifecycle accounting after twelve canonical descendants', async () => {
		const position = withdrawingPosition()
		const clients = lifecycleReceiptClients(100n, undefined, 10n ** 16n)
		const provisional = await recoverPendingLifecycleWithQuorum(clients, recoveryConfiguration, position, 100n)
		expect(provisional.status).toBe('closed-pending-finality')
		expect(provisional.realizedNetProfitEth).toBeUndefined()
		expect(provisional.lifecycleSettlerRewardEth).toBe('0.01')
		expect(provisional.lifecycleReceiptBlockNumber).toBe('100')
		const finalized = await finalizeLifecycleAfterFinalityWithQuorum(clients, recoveryConfiguration, provisional, 112n)
		expect(finalized.status).toBe('closed')
		expect(finalized.realizedNetProfitEth).toBe('0.108979')
		expect(finalized.lifecycleSettlerRewardEth).toBe('0.01')
		expect(finalized.lifecycleTransactionHashes).toEqual([])
		expect(finalized.lifecycleReceiptBlockNumber).toBeUndefined()
	})

	test('claims an exact replacement credit and retains the position risk for inventory reconciliation', async () => {
		const position = withdrawingPosition({ lifecycleKind: 'replacement-credit', replacementCreditAmount: (2n * 10n ** 18n).toString(), replacementCreditToken: weth })
		const clients = replacementCreditReceiptClients()
		const provisional = await recoverPendingLifecycleWithQuorum(clients, recoveryConfiguration, position, 100n)
		expect(provisional.status).toBe('closed-pending-finality')
		expect(provisional.withdrawnWeth).toBe('2')
		expect(provisional.withdrawnToken).toBe('0')
		const finalized = await finalizeLifecycleAfterFinalityWithQuorum(clients, recoveryConfiguration, provisional, 112n)
		expect(finalized.status).toBe('replaced')
		expect(finalized.realizedNetProfitEth).toBeUndefined()
		expect(finalized.replacementCreditAmount).toBe((2n * 10n ** 18n).toString())
		expect(finalized.lifecycleTransactionHashes).toEqual([])
	})

	test('classifies fewer than two available finality descendants as degraded connectivity', async () => {
		const position = withdrawingPosition()
		const quorumTwoConfiguration = { ...recoveryConfiguration, rpcQuorum: 2 as const }
		const provisional = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(), quorumTwoConfiguration, position, 100n)
		await expect(finalizeLifecycleAfterFinalityWithQuorum(lifecycleReceiptClients(100n, undefined, 0n, [1]), quorumTwoConfiguration, provisional, 112n)).rejects.toBeInstanceOf(ConnectivityDegradedError)
	})

	test('finalizes successful lifecycle evidence when two readers agree and a third is offline', async () => {
		const position = withdrawingPosition()
		const clients = [...lifecycleReceiptClients(), offlineReadClient()]
		const provisional = await recoverPendingLifecycleWithQuorum(clients, resilientRecoveryConfiguration, position, 100n)
		const finalized = await finalizeLifecycleAfterFinalityWithQuorum(clients, resilientRecoveryConfiguration, provisional, 112n)
		expect(finalized.status).toBe('closed')
	})

	test('reopens a lifecycle and removes provisional gas when its successful receipt is reorged out', async () => {
		const position = withdrawingPosition()
		const provisional = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(100n, undefined, 10n ** 16n), recoveryConfiguration, position, 100n)
		const reopened = await finalizeLifecycleAfterFinalityWithQuorum(missingReceiptClients(), recoveryConfiguration, provisional, 112n)
		expect(reopened.status).toBe('open')
		expect(reopened.lifecycleGasCostEth).toBe('0')
		expect(reopened.lifecycleSettlerRewardEth).toBeUndefined()
		expect(reopened.gasExpenditures).toEqual(confirmedPosition().gasExpenditures)
		expect(reopened.withdrawnWeth).toBe('0')
		expect(reopened.expiredTransactionAttempts).toEqual([{ kind: 'lifecycle', nonce: '9', targetBlockNumber: '100', transactionHash: lifecycleTransactionHash }])
	})

	test('keeps a successful lifecycle receipt without executor evidence in recovery', async () => {
		const position = withdrawingPosition()
		const recovered = await recoverPendingLifecycleWithQuorum(successfulMismatchedIntentClients(lifecycleTransactionHash), recoveryConfiguration, position, 100n)
		expect(recovered.status).toBe('recovery-required')
		expect(recovered.lifecycleReceiptRecovered).toBe(true)
		expect(recovered.lifecycleTransactionHashes).toEqual([lifecycleTransactionHash])
	})

	test('requires manual recovery for a quorum-confirmed lifecycle event that contradicts the journal', async () => {
		const position = withdrawingPosition()
		const wrongAccount = getAddress('0x0000000000000000000000000000000000000003')
		const recovered = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(100n, undefined, 0n, [], wrongAccount), recoveryConfiguration, position, 100n)
		expect(recovered.status).toBe('recovery-required')
		expect(recovered.lifecycleReceiptRecovered).toBe(true)
	})
})

describe('#1274: positions collateralized in an allowlisted non-WETH token', () => {
	const usdc = getAddress('0x00000000000000000000000000000000000000c0')
	// Six-decimal USDC valued at 1e12 / 3000 atto-WETH per base unit (3000 USDC per WETH).
	const collateral = { decimals: 6, symbol: 'USDC', token: usdc, valuationAttoWeth: '1000000000000', valuationUnits: '3000' }

	test('accepts settlement evidence in the collateral token and its decimals and rejects a WETH token1', async () => {
		const position = withdrawingPosition({ collateral, lockedWeth: '1' })
		const accepted = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(100n, undefined, 0n, [], undefined, { address: usdc, amount: 10n ** 6n }), recoveryConfiguration, position, 100n)
		expect(accepted.status).toBe('closed-pending-finality')
		expect(accepted.withdrawnWeth).toBe('1')
		const wethEvidence = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(100n, undefined, 0n, [], undefined, { address: weth, amount: 10n ** 6n }), recoveryConfiguration, position, 100n)
		expect(wethEvidence.status).toBe('recovery-required')
		const eighteenDecimalAmount = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(100n, undefined, 0n, [], undefined, { address: usdc, amount: 10n ** 18n }), recoveryConfiguration, position, 100n)
		expect(eighteenDecimalAmount.status).toBe('recovery-required')
	})

	test('accounts a replacement credit paid in the collateral token in its decimals', async () => {
		const position = withdrawingPosition({ collateral, lifecycleKind: 'replacement-credit', replacementCreditAmount: (2n * 10n ** 6n).toString(), replacementCreditToken: usdc })
		const provisional = await recoverPendingLifecycleWithQuorum(replacementCreditReceiptClients(100n, undefined, { amount: 2n * 10n ** 6n, token: usdc }), recoveryConfiguration, position, 100n)
		expect(provisional.status).toBe('closed-pending-finality')
		expect(provisional.withdrawnWeth).toBe('2')
		expect(provisional.withdrawnToken).toBe('0')
	})

	test('values a recovered entry hedge improvement with the entry collateral valuation', async () => {
		// The sell hedge was quoted at 3000 USDC and executed at 3030 USDC: 30 USDC more is 0.01 WETH more profit.
		const position = pendingEntryPosition({ collateral, hedgeWeth: '3000', hedgedProfitBeforeGasEth: '0.1' })
		const recovered = (await recoverPendingEntryWithQuorum(entryReceiptClients(100n, undefined, 3_030n * 10n ** 6n), recoveryConfiguration, position, 18)).position
		expect(recovered.status).toBe('open-pending-finality')
		expect(recovered.hedgeWeth).toBe('3030')
		expect(recovered.hedgedProfitBeforeGasEth).toBe('0.11')
	})

	test('reads OpenOracle holdings and executor allowances for the position collateral, not WETH', async () => {
		const reads: { functionName: string; token: string }[] = []
		const blockHash = `0x${'aa'.repeat(32)}`
		const provider: EIP1193Provider = {
			request: async ({ method, params }) => {
				if (method === 'eth_chainId') return '0x1'
				if (method === 'eth_getBlockByNumber') return rpcBlock('0x64', blockHash, '0x0')
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC ${method}`)
				const call = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string') throw new Error('Unexpected call')
				if (call.data.startsWith('0x313ce567')) return encodeAbiParameters([{ type: 'uint8' }], [18])
				const decoded = decodeFunctionData({ abi: openOracleAbi, data: call.data as Hex })
				if (decoded.functionName === 'tokenHolder' || decoded.functionName === 'internalAllowance') reads.push({ functionName: decoded.functionName, token: String(decoded.args?.at(-1)).toLowerCase() })
				return encodeAbiParameters([{ type: 'uint256' }], [5n])
			},
		}
		const client = createPublicClient({ chain: mainnet, transport: custom(provider) })
		const account = getAddress('0x0000000000000000000000000000000000000002')
		const balances = await lifecycleBalancesWithQuorum([client], { ...recoveryConfiguration, quorumRpcUrls: [] }, account, positionCollateralToken({ collateral }, weth), token, 100n)
		expect(balances).toMatchObject({ holderToken1: 5n, internalAllowanceToken1: 5n })
		expect(
			reads
				.filter(read => read.token === usdc.toLowerCase())
				.map(read => read.functionName)
				.sort(),
		).toEqual(['internalAllowance', 'tokenHolder'])
		expect(reads.some(read => read.token === weth.toLowerCase())).toBeFalse()
	})
})

test('keeps a durable position through read disagreement and records agreed entry finality exactly once', async () => {
	const receiptHash = `0x${'aa'.repeat(32)}` as Hex
	const descendantHash = `0x${'bb'.repeat(32)}` as Hex
	const newDescendantHash = `0x${'cc'.repeat(32)}` as Hex
	const localAccount = privateKeyToAccount(`0x${'11'.repeat(32)}`)
	const storedGame = openOracleAbi.find(item => item.type === 'function' && item.name === 'storedGame')
	const storedHelper = openOracleAbi.find(item => item.type === 'function' && item.name === 'storedHelper')
	if (storedGame === undefined || storedHelper === undefined) throw new Error('Missing report ABI')
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-lifecycle-audit-'))
	try {
		const settingsFile = join(directory, 'operator.json')
		const journal = join(directory, 'positions.json')
		await saveOperatorSettings(
			settingsFile,
			parseOperatorSettings({
				...example,
				network: 'mainnet',
				networkConfigured: true,
				connectivity: { publicRpcUrls: ['https://public.example/'], readRpcUrl: 'https://one.example/', quorumRpcUrls: ['https://two.example/'], rpcQuorum: 2 },
				runtime: { ...example.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: journal, priceHistoryFile: join(directory, 'prices.jsonl') },
			}),
		)
		const config = { ...(await loadConfiguration(settingsFile)), executor }
		const position = openPositionFixture({ account: localAccount.address, entryReceiptBlockHash: receiptHash, entryReceiptBlockNumber: '100', status: 'open-pending-finality', executionIntent: executionIntentFixture() })
		await savePositionJournal(journal, [position], 1)
		let mode: 'disagree' | 'agree' = 'disagree'
		let reads = 0
		const buildReader = (index: number) =>
			createPublicClient({
				chain: mainnet,
				transport: custom({
					request: async ({ method, params }) => {
						reads += 1
						if (!Array.isArray(params)) throw new Error(`Missing arguments: ${method}`)
						if (method === 'eth_getBlockByNumber') {
							const block = String(params[0])
							const descendant = mode === 'disagree' && index === 1 ? newDescendantHash : descendantHash
							const hash = block === '0x64' ? receiptHash : descendant
							return rpcBlock(block, hash, '0x0')
						}
						if (method === 'eth_getTransactionReceipt') return mode === 'disagree' ? null : rpcReceipt({ blockHash: receiptHash, blockNumber: '0x64', from: localAccount.address, logs: [], status: '0x1', transactionHash })
						if (method !== 'eth_call') throw new Error(`Unexpected read method: ${method}`)
						const data = params[0]?.data
						if (typeof data !== 'string' || !data.startsWith('0x')) throw new Error('Missing encoded read')
						if (data.startsWith('0x313ce567')) return encodeAbiParameters([{ type: 'uint8' }], [18])
						const decoded = decodeFunctionData({ abi: openOracleAbi, data: data as Hex })
						if (decoded.functionName === 'storedGame') return encodeAbiParameters(storedGame.outputs, [1n, 2n, localAccount.address, 110, 0, config.network.weth, 0, 1_000, 0n, zeroAddress, 0n, token, 1, 0, 0, 100, zeroAddress, 0, 0, 0])
						if (decoded.functionName === 'storedHelper') return encodeAbiParameters(storedHelper.outputs, [localAccount.address, 0n, 100])
						if (decoded.functionName === 'tokenHolder' || decoded.functionName === 'internalAllowance') return encodeAbiParameters([{ type: 'uint256' }], [0n])
						throw new Error(`Unexpected ABI call: ${decoded.functionName}`)
					},
				}),
			})
		const primary = buildReader(0)
		const clients = [primary, buildReader(1)]
		let unexpectedSideEffects = 0
		const wallet = createWalletClient({
			account: {
				...localAccount,
				signTransaction: async () => {
					unexpectedSideEffects++
					throw new Error('Unexpected signing')
				},
				signMessage: async () => {
					unexpectedSideEffects++
					throw new Error('Unexpected relay signing')
				},
			},
			chain: mainnet,
			transport: custom({
				request: async () => {
					unexpectedSideEffects++
					throw new Error('Unexpected wallet request')
				},
			}),
		})
		const writes: PositionRecord[] = []
		const runAt = async (head: bigint) => {
			const [current] = await loadPositionJournal(journal, 1)
			if (current === undefined) throw new Error('Position disappeared')
			return processPositionLifecycle(
				primary,
				clients,
				wallet,
				config,
				current,
				head,
				async updated => {
					writes.push(updated)
					await savePositionJournal(journal, [updated], 1)
				},
				() => {
					unexpectedSideEffects++
				},
			)
		}
		expect(await runAt(111n)).toBe('waiting')
		expect(reads).toBe(0)
		await expect(runAt(112n)).rejects.toThrow('RPC disagreement')
		expect(writes).toHaveLength(0)
		const [interrupted] = await loadPositionJournal(journal, 1)
		expect(interrupted).toMatchObject({ status: 'open-pending-finality', entryReceiptBlockHash: receiptHash, actualEntryGasCostEth: '0.001', executionIntent: position.executionIntent })
		mode = 'agree'
		expect(await runAt(112n)).toBe('waiting')
		const [confirmed] = await loadPositionJournal(journal, 1)
		expect(confirmed?.entryReceiptBlockHash).toBeUndefined()
		expect(confirmed).toMatchObject({ status: 'open', historyOutbox: { reportId: '7', blockNumber: '100', actualGasCostEth: '0.001', trackedNetProfitEth: '0.099', transactionHash } })
		expect(await runAt(113n)).toBe('waiting')
		expect(writes).toHaveLength(1)
		expect(unexpectedSideEffects).toBe(0)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
