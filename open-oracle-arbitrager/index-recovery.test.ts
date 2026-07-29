import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, encodeEventTopics, getAddress, mainnet, type EIP1193Provider, type Hex } from '@zoltar/shared/ethereum'
import { openOracleArbitrageExecutorAbi } from './abi.js'
import { executionRecordForConfirmedPosition, expireEntryWithQuorum, finalizeLifecycleAfterFinalityWithQuorum, lifecycleExecutionFromLogs, reconcileExpiredAttemptsWithQuorum, recoverPendingEntryWithQuorum, recoverPendingLifecycleWithQuorum } from './index.js'
import { manuallyReconcilePosition, type PositionRecord } from './position-store.js'

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
	submission: { mode: 'private' as const },
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
					return Promise.resolve({
						baseFeePerGas: '0x1',
						difficulty: '0x0',
						extraData: '0x',
						gasLimit: '0x1c9c380',
						gasUsed: '0x0',
						hash,
						logsBloom: `0x${'00'.repeat(256)}`,
						miner: getAddress('0x0000000000000000000000000000000000000000'),
						mixHash: `0x${'00'.repeat(32)}`,
						nonce: '0x0000000000000000',
						number: requested,
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
					})
				}
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function receiptClients(blockNumber = 100n, status: 'reverted' | 'success' = 'reverted', logs: readonly Record<string, unknown>[] = [], receiptTransactionHash = transactionHash, headBlockNumbers: readonly bigint[] = [blockNumber + 12n, blockNumber + 12n]) {
	const receiptBlockHash = `0x${'aa'.repeat(32)}`
	const finalityBlockHash = `0x${'cc'.repeat(32)}`
	const blockNumberHex = `0x${blockNumber.toString(16)}`
	return ['primary', 'secondary'].map((_, index) => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') {
					return Promise.resolve({
						blockHash: receiptBlockHash,
						blockNumber: blockNumberHex,
						contractAddress: null,
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x3b9aca00',
						from: getAddress('0x0000000000000000000000000000000000000002'),
						gasUsed: '0x5208',
						logs,
						logsBloom: `0x${'00'.repeat(256)}`,
						status: status === 'success' ? '0x1' : '0x0',
						to: executor,
						transactionHash: receiptTransactionHash,
						transactionIndex: '0x0',
						type: '0x2',
					})
				}
				if (parameters.method === 'eth_getBlockByNumber') {
					if (!Array.isArray(parameters.params)) throw new Error('Receipt test expected block request parameters')
					const requested = parameters.params[0]
					if (typeof requested !== 'string' || !/^0x[0-9a-f]+$/i.test(requested)) throw new Error('Receipt test expected a numeric block tag')
					const requestedBlockNumber = BigInt(requested)
					const headBlockNumber = headBlockNumbers[index]
					if (headBlockNumber === undefined || requestedBlockNumber > headBlockNumber) return Promise.resolve(null)
					return Promise.resolve({
						baseFeePerGas: '0x1',
						difficulty: '0x0',
						extraData: '0x',
						gasLimit: '0x1c9c380',
						gasUsed: '0x5208',
						hash: requestedBlockNumber === blockNumber ? receiptBlockHash : finalityBlockHash,
						logsBloom: `0x${'00'.repeat(256)}`,
						miner: getAddress('0x0000000000000000000000000000000000000000'),
						mixHash: `0x${'00'.repeat(32)}`,
						nonce: '0x0000000000000000',
						number: requested,
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
					})
				}
				if (parameters.method === 'eth_getTransactionCount') return Promise.resolve('0x9')
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function lifecycleReceiptClients(blockNumber = 100n, headBlockNumbers?: readonly bigint[] | undefined, settlerReward = 0n) {
	const account = getAddress('0x0000000000000000000000000000000000000002')
	const topics = encodeEventTopics({
		abi: openOracleArbitrageExecutorAbi,
		eventName: 'LifecycleExecuted',
		args: { account, reportId: 7n, token1: weth },
	})
	if (topics.some(topic => topic === null)) throw new Error('Lifecycle event topics are incomplete')
	const data = encodeAbiParameters(
		[
			{ name: 'amount1', type: 'uint256' },
			{ name: 'token2', type: 'address' },
			{ name: 'amount2', type: 'uint256' },
			{ name: 'settlerReward', type: 'uint256' },
		],
		[10n ** 18n, token, 2n * 10n ** 18n, settlerReward],
	)
	return receiptClients(
		blockNumber,
		'success',
		[
			{
				address: executor,
				blockHash: `0x${'aa'.repeat(32)}`,
				blockNumber: `0x${blockNumber.toString(16)}`,
				data,
				logIndex: '0x0',
				removed: false,
				topics,
				transactionHash: lifecycleTransactionHash,
				transactionIndex: '0x0',
			},
		],
		lifecycleTransactionHash,
		headBlockNumbers,
	)
}

function successfulMismatchedIntentClients(receiptTransactionHash = transactionHash) {
	const blockHash = `0x${'aa'.repeat(32)}`
	const account = getAddress('0x0000000000000000000000000000000000000002')
	return ['primary', 'secondary'].map(() => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') {
					return Promise.resolve({
						blockHash,
						blockNumber: '0x64',
						contractAddress: null,
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x3b9aca00',
						from: account,
						gasUsed: '0x5208',
						logs: [],
						logsBloom: `0x${'00'.repeat(256)}`,
						status: '0x1',
						to: executor,
						transactionHash: receiptTransactionHash,
						transactionIndex: '0x0',
						type: '0x2',
					})
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
					return Promise.resolve({
						baseFeePerGas: '0x1',
						difficulty: '0x0',
						extraData: '0x',
						gasLimit: '0x1c9c380',
						gasUsed: '0x5208',
						hash: blockHash,
						logsBloom: `0x${'00'.repeat(256)}`,
						miner: getAddress('0x0000000000000000000000000000000000000000'),
						mixHash: `0x${'00'.repeat(32)}`,
						nonce: '0x0000000000000000',
						number: '0x64',
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
					})
				}
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function confirmedPosition(): PositionRecord {
	return {
		account: getAddress('0x0000000000000000000000000000000000000002'),
		actualEntryGasCostEth: '0.001',
		capitalAtRiskWeth: '2',
		closedAt: undefined,
		direction: 'sell-rep',
		entrySubmissionBlockNumber: '99',
		entrySubmissionMode: 'public',
		entryTransactionHash: transactionHash,
		entryTransactionHashes: [transactionHash],
		entryTransactionNonce: '8',
		executionIntent: {
			direction: 'sell-rep',
			estimatedNetProfitWeth: '0.05',
			estimatedProfitBeforeGasEth: '0.051',
			pool: getAddress('0x0000000000000000000000000000000000000003'),
			poolFee: 10_000,
			reportId: '7',
			requiredToken: '1',
			requiredWeth: '2',
			token,
			tokenSymbol: 'REP',
		},
		gasExpenditures: [{ costEth: '0.001', minedAt: '2026-07-24T00:00:00.000Z', transactionHash }],
		hedgeAmountToken: '2',
		hedgeWeth: '1',
		hedgedProfitBeforeGasEth: '0.1',
		historyOutbox: undefined,
		lifecycleGasCostEth: '0',
		lifecycleReceiptRecovered: false,
		lifecycleTargetBlockNumber: undefined,
		lifecycleTokenDecimals: undefined,
		lifecycleTransactionHashes: [],
		lifecycleUpdatedAt: undefined,
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
		lockedToken: '2',
		lockedWeth: '1',
		manualReconciliation: undefined,
		openedAt: '2026-07-24T00:00:00.000Z',
		realizedNetProfitEth: undefined,
		reportId: '7',
		status: 'open',
		token,
		tokenSymbol: 'REP',
		withdrawnToken: '0',
		withdrawnWeth: '0',
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
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode,
			gasExpenditures: [],
			status: 'pending-entry' as const,
		}
		const recovered = await expireEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')
		expect(recovered.status).toBe('expired-not-included')
		expect(recovered.capitalAtRiskWeth).toBe('0')
		expect(recovered.lockedWeth).toBe('0')
		expect(recovered.realizedNetProfitEth).toBe('0')
	})

	test('retains an absent entry until every RPC serves the same finality descendant', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'private' as const,
			gasExpenditures: [],
			status: 'pending-entry' as const,
		}
		await expect(expireEntryWithQuorum(missingReceiptClients(undefined, [112n, 100n]), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('every read RPC')
		await expect(expireEntryWithQuorum(missingReceiptClients(undefined, [112n, 112n], [`0x${'cc'.repeat(32)}`, `0x${'dd'.repeat(32)}`]), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('RPC disagreement')
	})

	test('continues accounting late revert gas after an absent private entry releases its risk slot', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			capitalAtRiskWeth: '0',
			expiredTransactionAttempts: [{ kind: 'entry' as const, nonce: '8', targetBlockNumber: '100', transactionHash }],
			gasExpenditures: [],
			realizedNetProfitEth: '0',
			status: 'expired-not-included' as const,
		}
		const recovered = await reconcileExpiredAttemptsWithQuorum(receiptClients(113n), recoveryConfiguration, position, 125n)
		expect(recovered.expiredTransactionAttempts).toEqual([])
		expect(recovered.actualEntryGasCostEth).toBe('0.000021')
		expect(recovered.realizedNetProfitEth).toBe('-0.000021')
		expect(recovered.gasExpenditures).toHaveLength(1)
	})

	test('keeps manual reconciliation terminal after a late successful expired attempt', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			capitalAtRiskWeth: '0',
			expiredTransactionAttempts: [{ kind: 'entry' as const, nonce: '8', targetBlockNumber: '100', transactionHash }],
			gasExpenditures: [],
			realizedNetProfitEth: '0',
			status: 'expired-not-included' as const,
		}
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
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			capitalAtRiskWeth: '0',
			expiredTransactionAttempts: [{ kind: 'entry' as const, nonce: '8', targetBlockNumber: '100', transactionHash }],
			gasExpenditures: [],
			realizedNetProfitEth: '0',
			status: 'expired-not-included' as const,
		}
		const recovered = await reconcileExpiredAttemptsWithQuorum(missingReceiptClients(9n), recoveryConfiguration, position, 125n)
		expect(recovered.expiredTransactionAttempts).toEqual([])
		expect(recovered.actualEntryGasCostEth).toBe('0')
		expect(recovered.gasExpenditures).toEqual([])
	})

	test('does not auto-expire a legacy multi-transaction entry with independently live signatures', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'private' as const,
			entryTransactionHashes: [`0x${'22'.repeat(32)}` as Hex, transactionHash],
			gasExpenditures: [],
			status: 'pending-entry' as const,
		}
		await expect(expireEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('Only an atomic entry')
	})

	test('releases a reverted atomic private entry after accounting for its gas', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'private' as const,
			gasExpenditures: [],
			status: 'pending-entry' as const,
		}
		const recovered = await recoverPendingEntryWithQuorum(receiptClients(), recoveryConfiguration, position, 18)
		expect(recovered.position.status).toBe('closed')
		expect(recovered.position.capitalAtRiskWeth).toBe('0')
		expect(recovered.position.lockedWeth).toBe('0')
		expect(recovered.position.realizedNetProfitEth).toBe('-0.000021')
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
				{ name: 'settlerReward', type: 'uint256' },
			],
			[11n, token2, 22n, 3n],
		)
		expect(lifecycleExecutionFromLogs([{ address: executor, data, topics: encodedTopics }], executor)).toEqual({
			account,
			amount1: 11n,
			amount2: 22n,
			reportId: 7n,
			settlerReward: 3n,
			token1,
			token2,
		})
	})

	test.each(['private', 'public'] as const)('clears an atomically guarded %s lifecycle attempt that was not included', async lifecycleSubmissionMode => {
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			status: 'withdrawing' as const,
		}
		const recovered = await recoverPendingLifecycleWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n)
		expect(recovered.status).toBe('open')
		expect(recovered.lifecycleTransactionHashes).toEqual([])
		expect(recovered.lifecycleSubmissionBlockNumber).toBeUndefined()
		expect(recovered.lifecycleTargetBlockNumber).toBeUndefined()
		expect(recovered.expiredTransactionAttempts).toEqual([{ kind: 'lifecycle', nonce: '9', targetBlockNumber: '100', transactionHash: lifecycleTransactionHash }])
	})

	test('retains an absent lifecycle attempt until every RPC serves the same finality descendant', async () => {
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'private' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			status: 'withdrawing' as const,
		}
		await expect(recoverPendingLifecycleWithQuorum(missingReceiptClients(undefined, [112n, 100n]), recoveryConfiguration, position, 112n)).rejects.toThrow('every read RPC')
		await expect(recoverPendingLifecycleWithQuorum(missingReceiptClients(undefined, [112n, 112n], [`0x${'cc'.repeat(32)}`, `0x${'dd'.repeat(32)}`]), recoveryConfiguration, position, 112n)).rejects.toThrow('RPC disagreement')
	})

	test('keeps a successful lifecycle provisional until twelve canonical descendants', async () => {
		const position = {
			...confirmedPosition(),
			lifecycleReceiptBlockHash: `0x${'aa'.repeat(32)}` as Hex,
			lifecycleReceiptBlockNumber: '100',
			lifecycleReceiptRecovered: true,
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'public' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			lifecycleUpdatedAt: '2026-07-24T00:01:00.000Z',
			status: 'closed-pending-finality' as const,
			withdrawnToken: '2',
			withdrawnWeth: '1',
		}
		const provisional = await finalizeLifecycleAfterFinalityWithQuorum(receiptClients(100n), recoveryConfiguration, position, 111n)
		expect(provisional.status).toBe('closed-pending-finality')
		expect(provisional.realizedNetProfitEth).toBeUndefined()
		expect(provisional.lifecycleTransactionHashes).toEqual([lifecycleTransactionHash])
	})

	test('finalizes exact lifecycle accounting after twelve canonical descendants', async () => {
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'private' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			status: 'withdrawing' as const,
		}
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

	test('retains successful lifecycle evidence until every RPC serves the same finality descendant', async () => {
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'private' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			status: 'withdrawing' as const,
		}
		const provisional = await recoverPendingLifecycleWithQuorum(lifecycleReceiptClients(), recoveryConfiguration, position, 100n)
		const retained = await finalizeLifecycleAfterFinalityWithQuorum(lifecycleReceiptClients(100n, [112n, 100n]), recoveryConfiguration, provisional, 112n)
		expect(retained.status).toBe('closed-pending-finality')
		expect(retained.lifecycleReceiptBlockHash).toBe(provisional.lifecycleReceiptBlockHash)
		expect(retained.lifecycleReceiptBlockNumber).toBe('100')
		expect(retained.lifecycleTransactionHashes).toEqual([lifecycleTransactionHash])
		expect(retained.realizedNetProfitEth).toBeUndefined()
	})

	test('reopens a lifecycle and removes provisional gas when its successful receipt is reorged out', async () => {
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'private' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			status: 'withdrawing' as const,
		}
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
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'private' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [lifecycleTransactionHash],
			status: 'withdrawing' as const,
		}
		const recovered = await recoverPendingLifecycleWithQuorum(successfulMismatchedIntentClients(lifecycleTransactionHash), recoveryConfiguration, position, 100n)
		expect(recovered.status).toBe('recovery-required')
		expect(recovered.lifecycleReceiptRecovered).toBe(true)
		expect(recovered.lifecycleTransactionHashes).toEqual([lifecycleTransactionHash])
	})
})
