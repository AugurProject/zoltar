import { describe, expect, test } from 'bun:test'
import type { Address, Hex, TransactionReceipt, TransactionReplacement } from '@zoltar/shared/ethereum'
import { executionFailureDecision, flushExecutionHistory, opportunityDecision, recordConfirmedExecution, runFundedExecution, selectBestExecution, waitForResolvedTransaction } from './execution-orchestration.js'
import type { ExecutionRecord } from './operator-state.js'

const address = '0x0000000000000000000000000000000000000001' as Address
const reporter = '0x0000000000000000000000000000000000000002' as Address
const originalHash = `0x${'34'.repeat(32)}` as Hex
const replacementHash = `0x${'56'.repeat(32)}` as Hex
const record: ExecutionRecord = {
	actualGasCostEth: '0.002',
	blockNumber: '100',
	direction: 'sell-rep',
	estimatedNetProfitWeth: '0.05',
	estimatedProfitBeforeGasEth: '0.052',
	executedAt: '2026-07-24T00:00:00.000Z',
	pool: address,
	poolFee: 10_000,
	reportId: '7',
	requiredRep: '1',
	requiredWeth: '2',
	trackedNetProfitEth: '0.05',
	transactionHash: `0x${'12'.repeat(32)}` as Hex,
}

function transactionReceipt(status: TransactionReceipt['status'] = 'success'): TransactionReceipt {
	return {
		blockHash: `0x${'78'.repeat(32)}`,
		blockNumber: 101n,
		cumulativeGasUsed: 21_000n,
		effectiveGasPrice: 10n,
		from: address,
		gasUsed: 21_000n,
		logs: [],
		status,
		to: reporter,
		transactionHash: replacementHash,
		transactionIndex: 0n,
	}
}

function replacement(reason: TransactionReplacement['reason']): TransactionReplacement {
	return {
		reason,
		replacedTransaction: { hash: originalHash },
		transaction: { hash: replacementHash },
		transactionReceipt: transactionReceipt(),
	}
}

describe('funded execution orchestration', () => {
	test('guards every production transaction boundary against pause', async () => {
		const expectedCalls = [[], ['approve-1'], ['approve-1', 'approve-2', 'prepare'], ['approve-1', 'approve-2', 'prepare', 'simulate']]
		for (let pauseBoundary = 1; pauseBoundary <= expectedCalls.length; pauseBoundary += 1) {
			let check = 0
			const calls: string[] = []
			await expect(
				runFundedExecution(
					() => {
						check += 1
						return check === pauseBoundary
					},
					{
						approveToken1: async () => {
							calls.push('approve-1')
							return 1n
						},
						approveToken2: async () => {
							calls.push('approve-2')
							return 2n
						},
						prepare: async () => {
							calls.push('prepare')
							return 'prepared'
						},
						simulate: async () => {
							calls.push('simulate')
						},
						submit: async () => {
							calls.push('submit')
							return 'hash'
						},
						confirm: async () => {
							calls.push('confirm')
							return 'record'
						},
					},
				),
			).rejects.toThrow('paused')
			const expected = expectedCalls[pauseBoundary - 1]
			if (expected === undefined) throw new Error('Missing expected pause-boundary call sequence')
			expect(calls).toEqual(expected)
		}
	})

	test('preserves an in-flight transaction failure even if pause arrives while it runs', async () => {
		let paused = false
		const execution = runFundedExecution(() => paused, {
			approveToken1: () => Promise.resolve(1n),
			approveToken2: () => Promise.resolve(2n),
			prepare: () => Promise.resolve('prepared'),
			simulate: () => Promise.resolve(),
			submit: async () => {
				paused = true
				throw new Error('replacement transaction failed')
			},
			confirm: () => Promise.resolve('record'),
		})
		await expect(execution).rejects.toThrow('replacement transaction failed')
		try {
			await execution
		} catch (error) {
			expect(executionFailureDecision(error)).toBe('execution-failed')
		}
	})

	test('classifies a reverted already-broadcast transaction as failed while paused', async () => {
		let paused = false
		const execution = runFundedExecution(() => paused, {
			approveToken1: () => Promise.resolve(1n),
			approveToken2: () => Promise.resolve(2n),
			prepare: () => Promise.resolve('prepared'),
			simulate: () => Promise.resolve(),
			submit: async () => {
				paused = true
				return 'broadcast-hash'
			},
			confirm: async () => {
				throw new Error('dispute transaction reverted')
			},
		})
		await expect(execution).rejects.toThrow('dispute transaction reverted')
		try {
			await execution
		} catch (error) {
			expect(executionFailureDecision(error)).toBe('execution-failed')
		}
	})

	test('keeps a confirmed record visible and queued when persistence fails', async () => {
		const visible: ExecutionRecord[] = []
		const pending: ExecutionRecord[] = []
		recordConfirmedExecution(visible, pending, record)
		await expect(flushExecutionHistory(pending, () => Promise.reject(new Error('disk unavailable')))).rejects.toThrow('disk unavailable')
		expect(visible).toEqual([record])
		expect(pending).toEqual([record])
		const persisted: ExecutionRecord[] = []
		await flushExecutionHistory(pending, async queued => {
			persisted.push(queued)
		})
		expect(persisted).toEqual([record])
		expect(pending).toEqual([])
	})

	test('blocks on transient confirmation failures and records a repriced replacement', async () => {
		let attempts = 0
		const retries: unknown[] = []
		let retryCompleted = false
		const receipt = await waitForResolvedTransaction(
			originalHash,
			async ({ onReplaced }) => {
				attempts += 1
				if (attempts === 1) throw new Error('receipt RPC timed out')
				expect(retryCompleted).toBe(true)
				onReplaced(replacement('repriced'))
				return transactionReceipt()
			},
			() => Promise.resolve(),
			async error => {
				await Promise.resolve()
				retries.push(error)
				retryCompleted = true
			},
		)
		expect(attempts).toBe(2)
		expect(retries).toHaveLength(1)
		expect(receipt.transactionHash).toBe(replacementHash)
	})

	test('rejects cancellations and unrelated replacements definitively', async () => {
		for (const reason of ['cancelled', 'replaced'] as const) {
			await expect(
				waitForResolvedTransaction(
					originalHash,
					async ({ onReplaced }) => {
						onReplaced(replacement(reason))
						return transactionReceipt()
					},
					() => Promise.resolve(),
				),
			).rejects.toThrow(`was ${reason}`)
		}
	})

	test('returns a definitive reverted receipt without retrying', async () => {
		let attempts = 0
		const receipt = await waitForResolvedTransaction(
			originalHash,
			() => {
				attempts += 1
				return Promise.resolve(transactionReceipt('reverted'))
			},
			() => Promise.resolve(),
		)
		expect(attempts).toBe(1)
		expect(receipt.status).toBe('reverted')
	})

	test('selects one best execution without discarding other evaluated opportunities', () => {
		const candidates = [
			{ id: 'first', profit: 5n },
			{ id: 'best', profit: 9n },
			{ id: 'last', profit: 3n },
		]
		expect(selectBestExecution(candidates, candidate => candidate.profit)).toEqual({ id: 'best', profit: 9n })
		expect(candidates).toHaveLength(3)
	})

	test('labels the execution wallet current report as a non-executable self-report', () => {
		expect(
			opportunityDecision({
				account: address,
				currentReporter: address,
				execute: true,
				executionReady: true,
				hasRequiredInventory: true,
				profitable: true,
			}),
		).toBe('self-report')
		expect(
			opportunityDecision({
				account: address,
				currentReporter: address,
				execute: false,
				executionReady: true,
				hasRequiredInventory: true,
				profitable: true,
			}),
		).toBe('self-report')
	})

	test('labels executable opportunities as eligible until one is selected', () => {
		expect(
			opportunityDecision({
				account: address,
				currentReporter: reporter,
				execute: true,
				executionReady: true,
				hasRequiredInventory: true,
				profitable: true,
			}),
		).toBe('eligible')
	})
})
