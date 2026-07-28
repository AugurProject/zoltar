import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, encodeEventTopics, getAddress, mainnet, type EIP1193Provider, type Hex } from '@zoltar/shared/ethereum'
import { openOracleArbitrageExecutorAbi } from './abi.js'
import { executionRecordForConfirmedPosition, expirePrivateEntryWithQuorum, lifecycleExecutionFromLogs, reconcileExpiredAttemptsWithQuorum, recoverPendingEntryWithQuorum, recoverPendingLifecycleWithQuorum } from './index.js'
import type { PositionRecord } from './position-store.js'

const transactionHash = `0x${'11'.repeat(32)}` as Hex
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

function missingReceiptClients(confirmedNonce?: bigint | undefined) {
	return ['primary', 'secondary'].map(() => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') return Promise.resolve(null)
				if (parameters.method === 'eth_getTransactionCount' && confirmedNonce !== undefined) return Promise.resolve(`0x${confirmedNonce.toString(16)}`)
				throw new Error(`Unexpected RPC method ${parameters.method}`)
			},
		}
		return createPublicClient({ chain: mainnet, transport: custom(provider) })
	})
}

function revertedReceiptClients(blockNumber = 100n) {
	const blockHash = `0x${'aa'.repeat(32)}`
	const blockNumberHex = `0x${blockNumber.toString(16)}`
	return ['primary', 'secondary'].map(() => {
		const provider: EIP1193Provider = {
			request: parameters => {
				if (parameters.method === 'eth_getTransactionReceipt') {
					return Promise.resolve({
						blockHash,
						blockNumber: blockNumberHex,
						contractAddress: null,
						cumulativeGasUsed: '0x5208',
						effectiveGasPrice: '0x3b9aca00',
						from: getAddress('0x0000000000000000000000000000000000000002'),
						gasUsed: '0x5208',
						logs: [],
						logsBloom: `0x${'00'.repeat(256)}`,
						status: '0x0',
						to: executor,
						transactionHash,
						transactionIndex: '0x0',
						type: '0x2',
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
						number: blockNumberHex,
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

function successfulMismatchedIntentClients() {
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
						transactionHash,
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
						hash: transactionHash,
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

	test('releases the risk slot after a private entry is canonically absent for twelve blocks', async () => {
		const position = {
			...confirmedPosition(),
			actualEntryGasCostEth: '0',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'private' as const,
			gasExpenditures: [],
			status: 'pending-entry' as const,
		}
		const recovered = await expirePrivateEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')
		expect(recovered.status).toBe('expired-not-included')
		expect(recovered.capitalAtRiskWeth).toBe('0')
		expect(recovered.lockedWeth).toBe('0')
		expect(recovered.realizedNetProfitEth).toBe('0')
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
		const recovered = await reconcileExpiredAttemptsWithQuorum(revertedReceiptClients(113n), recoveryConfiguration, position, 113n)
		expect(recovered.expiredTransactionAttempts).toEqual([])
		expect(recovered.actualEntryGasCostEth).toBe('0.000021')
		expect(recovered.realizedNetProfitEth).toBe('-0.000021')
		expect(recovered.gasExpenditures).toHaveLength(1)
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
		const recovered = await reconcileExpiredAttemptsWithQuorum(missingReceiptClients(9n), recoveryConfiguration, position, 113n)
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
		await expect(expirePrivateEntryWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n, '2026-07-24T00:02:00.000Z')).rejects.toThrow('Only an atomic private entry')
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
		const recovered = await recoverPendingEntryWithQuorum(revertedReceiptClients(), recoveryConfiguration, position, 18)
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

	test('clears an atomically guarded private lifecycle attempt that was not included', async () => {
		const position = {
			...confirmedPosition(),
			lifecycleSubmissionBlockNumber: '99',
			lifecycleSubmissionMode: 'private' as const,
			lifecycleTargetBlockNumber: '100',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [transactionHash],
			status: 'withdrawing' as const,
		}
		const recovered = await recoverPendingLifecycleWithQuorum(missingReceiptClients(), recoveryConfiguration, position, 112n)
		expect(recovered.status).toBe('open')
		expect(recovered.lifecycleTransactionHashes).toEqual([])
		expect(recovered.lifecycleSubmissionBlockNumber).toBeUndefined()
		expect(recovered.lifecycleTargetBlockNumber).toBeUndefined()
		expect(recovered.expiredTransactionAttempts).toEqual([{ kind: 'lifecycle', nonce: '9', targetBlockNumber: '100', transactionHash }])
	})
})
