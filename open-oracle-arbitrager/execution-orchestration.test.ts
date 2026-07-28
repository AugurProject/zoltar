import { describe, expect, test } from 'bun:test'
import type { Address, Hex, TransactionReceipt, TransactionReplacement } from '@zoltar/shared/ethereum'
import {
	assertCanonicalExecutionSnapshot,
	assertReceiptSnapshotBlockHash,
	attemptConfirmationRecovery,
	canonicalBlockHashWithQuorum,
	executionFailureDecision,
	executionTokenAllowed,
	finalizeSubmittedLifecycleAttempt,
	fundingTransactionPlan,
	flushExecutionHistory,
	guardedTransactionSubmission,
	guardedRiskSubmission,
	journaledSubmission,
	lifecycleLastValidBlockNumber,
	lifecycleReceiptSnapshotBlock,
	lifecycleAttemptNeedsRecovery,
	openOracleDisputeTiming,
	opportunityDecision,
	privateBundleReceiptStatus,
	recordConfirmedExecution,
	retryPrivateSubmissionWithinWindow,
	runFundedExecution,
	selectBestExecution,
	signAndSubmitOpenOracleDispute,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	transactionReceiptsWithQuorum,
	waitForResolvedTransaction,
} from './execution-orchestration.js'
import type { ExecutionRecord } from './operator-state.js'
import { savePositionJournal, type PositionJournalFilesystem, type PositionRecord } from './position-store.js'
import { assertSubmissionWindowOpen } from './transaction-submission.js'

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
	requiredToken: '1',
	requiredWeth: '2',
	token: address,
	tokenSymbol: 'REP',
	trackedNetProfitEth: '0.05',
	transactionHash: `0x${'12'.repeat(32)}` as Hex,
}

function lifecyclePosition(): PositionRecord {
	return {
		account: address,
		actualEntryGasCostEth: '0.001',
		capitalAtRiskWeth: '2',
		closedAt: undefined,
		direction: 'sell-rep',
		entryTransactionHash: originalHash,
		entryTransactionHashes: [originalHash],
		hedgeAmountToken: '1',
		hedgeWeth: '2',
		hedgedProfitBeforeGasEth: '0.1',
		lifecycleGasCostEth: '0',
		lifecycleReceiptRecovered: false,
		lifecycleTargetBlockNumber: '101',
		lifecycleTokenDecimals: '18',
		lifecycleTransactionHashes: [replacementHash],
		lifecycleUpdatedAt: '2026-07-24T00:01:00.000Z',
		lifecycleWalletTokenBefore: '10',
		lifecycleWalletWethBefore: '20',
		lockedToken: '1',
		lockedWeth: '2',
		manualReconciliation: undefined,
		openedAt: '2026-07-24T00:00:00.000Z',
		realizedNetProfitEth: undefined,
		reportId: '7',
		status: 'withdrawing',
		token: reporter,
		tokenSymbol: 'REP',
		withdrawnToken: '0',
		withdrawnWeth: '0',
	}
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
	test('does not promote permissionlessly observed report tokens into the execution allowlist', () => {
		const configured = ['0x0000000000000000000000000000000000000010' as Address]
		const observed = '0x0000000000000000000000000000000000000020' as Address
		expect(executionTokenAllowed(configured, configured[0] as Address)).toBe(true)
		expect(executionTokenAllowed(configured, observed)).toBe(false)
	})

	test('accepts sequential public lifecycle receipts but keeps private lifecycle bundles atomic', () => {
		const first = transactionReceipt()
		const second = { ...transactionReceipt(), blockHash: `0x${'79'.repeat(32)}` as Hex, blockNumber: 102n }
		expect(lifecycleLastValidBlockNumber('public', 101n)).toBeUndefined()
		expect(lifecycleLastValidBlockNumber('private', 101n)).toBe(101n)
		expect(lifecycleReceiptSnapshotBlock([first, second], 0n)).toEqual({ blockHash: second.blockHash, blockNumber: 102n })
		expect(() => lifecycleReceiptSnapshotBlock([first, second], 101n)).toThrow('split across blocks')
		expect(lifecycleReceiptSnapshotBlock([first, transactionReceipt()], 101n)).toEqual({ blockHash: first.blockHash, blockNumber: 101n })
	})

	test('requires a private bundle when either exact executor allowance is missing', () => {
		expect(fundingTransactionPlan('private', { token1: 0n, token2: 4n }, { token1: 3n, token2: 4n })).toEqual(['approval-token1', 'execution'])
		expect(fundingTransactionPlan('private', { token1: 1n, token2: 4n }, { token1: 3n, token2: 4n })).toEqual(['reset-token1', 'approval-token1', 'execution'])
		expect(fundingTransactionPlan('private', { token1: 3n, token2: 4n }, { token1: 3n, token2: 4n })).toEqual(['execution'])
		expect(() => fundingTransactionPlan('public', { token1: 0n, token2: 4n }, { token1: 3n, token2: 4n })).toThrow('private bundle')
	})

	test('keeps next-block quote age independent from the minimum settlement window', () => {
		expect(openOracleDisputeTiming(100n, 1_000n)).toEqual([100n, 1n, 1_000n, 300n])
	})

	test('classifies every private bundle receipt before aborting anomalous inclusion', () => {
		expect(privateBundleReceiptStatus(undefined, 101n)).toBe('confirmation-unknown')
		expect(privateBundleReceiptStatus(transactionReceipt('reverted'), 101n)).toBe('reverted')
		expect(privateBundleReceiptStatus({ ...transactionReceipt(), blockNumber: 102n }, 101n)).toBe('confirmation-unknown')
		expect(privateBundleReceiptStatus(transactionReceipt(), 101n)).toBe('confirmed')
	})

	test('records every signed bundle step before simulation and terminally fails every step on rejection', async () => {
		const transactions = ['approval', 'dispute']
		const transitions: string[] = []
		await expect(
			simulateTrackedPrivateBundle(
				transactions,
				() => Promise.reject(new Error('relay simulation rejected')),
				(transaction, status) => transitions.push(`${transaction}:${status}`),
			),
		).rejects.toThrow('relay simulation rejected')
		expect(transitions).toEqual(['approval:submitting', 'dispute:submitting', 'approval:submission-failed', 'dispute:submission-failed'])
	})

	test('terminally records every anomalous private receipt before returning incomplete', () => {
		const transactions = ['approval', 'dispute', 'cleanup']
		const receipts = [undefined, transactionReceipt('reverted'), { ...transactionReceipt(), blockNumber: 102n }]
		const transitions: string[] = []
		const complete = trackPrivateBundleReceiptStatuses(transactions, receipts, 101n, (transaction, status) => transitions.push(`${transaction}:${status}`))
		expect(complete).toBe(false)
		expect(transitions).toEqual(['approval:confirmation-unknown', 'dispute:reverted', 'cleanup:confirmation-unknown'])
	})

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

	test('rechecks pause after asynchronous pre-submission work and does not call the sender', async () => {
		let paused = false
		let releasePreparation: (() => void) | undefined
		let submitted = false
		const preparation = new Promise<void>(resolve => {
			releasePreparation = resolve
		})
		const submission = guardedTransactionSubmission(
			() => paused,
			() => preparation,
			async () => {
				submitted = true
				return 'submitted'
			},
		)
		paused = true
		if (releasePreparation === undefined) throw new Error('Preparation release was not initialized')
		releasePreparation()
		let failure: unknown
		try {
			await submission
		} catch (error) {
			failure = error
		}
		expect(executionFailureDecision(failure)).toBe('paused')
		expect(submitted).toBe(false)
	})

	test('writes the pending-position journal immediately before submission', async () => {
		const calls: string[] = []
		const result = await journaledSubmission(
			async () => {
				calls.push('persist')
			},
			async () => {
				calls.push('submit')
				return 'submitted'
			},
		)
		expect(result).toBe('submitted')
		expect(calls).toEqual(['persist', 'submit'])
	})

	test('does not submit until journal contents and directory entry are synced', async () => {
		const calls: string[] = []
		let opened = 0
		const handle = (name: 'directory' | 'file') => ({
			chmod: async () => {
				calls.push(`${name}:chmod`)
			},
			close: async () => {
				calls.push(`${name}:close`)
			},
			sync: async () => {
				calls.push(`${name}:sync`)
			},
			writeFile: async () => {
				calls.push(`${name}:write`)
			},
		})
		const filesystem: PositionJournalFilesystem = {
			mkdir: async () => {
				calls.push('mkdir')
			},
			open: async (_path, flags) => {
				calls.push(`open:${flags}`)
				opened += 1
				return handle(opened === 1 ? 'file' : 'directory')
			},
			readFile: async () => {
				throw new Error('read is unexpected')
			},
			rename: async () => {
				calls.push('rename')
			},
			rm: async () => {
				calls.push('rm')
			},
		}
		await journaledSubmission(
			() => savePositionJournal('/positions.json', [], filesystem),
			async () => {
				calls.push('submit')
			},
		)
		expect(calls).toEqual(['mkdir', 'open:wx', 'file:write', 'file:chmod', 'file:sync', 'file:close', 'rename', 'open:r', 'directory:sync', 'directory:close', 'submit'])
	})

	test('does not write the pending-position journal when the pre-submission guard fails', async () => {
		let persisted = false
		await expect(
			guardedTransactionSubmission(
				() => false,
				() => Promise.reject(new Error('quote expired')),
				() =>
					journaledSubmission(
						async () => {
							persisted = true
						},
						() => Promise.resolve('submitted'),
					),
			),
		).rejects.toThrow('quote expired')
		expect(persisted).toBe(false)
	})

	test('preserves the durable lifecycle attempt when canonical post-state recovery fails', async () => {
		const submitted = lifecyclePosition()
		let persisted: PositionRecord | undefined
		await expect(
			finalizeSubmittedLifecycleAttempt(
				submitted,
				() => Promise.reject(new Error('Recovered lifecycle reduced a tracked wallet balance')),
				position => {
					persisted = position
					return Promise.resolve()
				},
			),
		).rejects.toThrow('reduced a tracked wallet balance')
		expect(persisted?.status).toBe('recovery-required')
		expect(persisted?.lifecycleTransactionHashes).toEqual([replacementHash])
		expect(persisted?.lifecycleTargetBlockNumber).toBe('101')
		expect(persisted?.lifecycleWalletTokenBefore).toBe('10')
		expect(persisted?.lifecycleWalletWethBefore).toBe('20')
		expect(persisted === undefined ? false : lifecycleAttemptNeedsRecovery(persisted)).toBe(true)
	})

	test('requires exact independent receipt agreement before entry accounting', async () => {
		const primary = transactionReceipt()
		const secondary = { ...transactionReceipt(), gasUsed: primary.gasUsed + 1n }
		const readers = [{ getTransactionReceipt: () => Promise.resolve(primary) }, { getTransactionReceipt: () => Promise.resolve(secondary) }]
		await expect(transactionReceiptsWithQuorum(readers, ['https://primary.example', 'https://secondary.example'], 'pending entry 7', [replacementHash])).rejects.toThrow('RPC disagreement')
		secondary.gasUsed = primary.gasUsed
		if (primary.effectiveGasPrice === undefined) throw new Error('test receipt gas price missing')
		expect(await transactionReceiptsWithQuorum(readers, ['https://primary.example', 'https://secondary.example'], 'pending entry 7', [replacementHash])).toEqual([
			{
				blockHash: primary.blockHash,
				blockNumber: primary.blockNumber,
				effectiveGasPrice: primary.effectiveGasPrice,
				gasUsed: primary.gasUsed,
				logs: primary.logs,
				status: primary.status,
				transactionHash: primary.transactionHash,
			},
		])
	})

	test('keeps a partially included public lifecycle in recovery when a later receipt is absent', async () => {
		const missingHash = `0x${'90'.repeat(32)}` as Hex
		const readers = [
			{
				getTransactionReceipt: ({ hash }: { hash: Hex }) => (hash === replacementHash ? Promise.resolve(transactionReceipt()) : Promise.reject(new Error('receipt not found'))),
			},
			{
				getTransactionReceipt: ({ hash }: { hash: Hex }) => (hash === replacementHash ? Promise.resolve(transactionReceipt()) : Promise.reject(new Error('receipt not found'))),
			},
		]
		await expect(transactionReceiptsWithQuorum(readers, ['https://primary.example', 'https://secondary.example'], 'pending public lifecycle 7', [replacementHash, missingHash])).rejects.toThrow('receipt not found')
	})

	test('rejects a same-height execution snapshot from a different parent hash or report state', () => {
		expect(() =>
			assertCanonicalExecutionSnapshot({
				expectedReportStateHash: `0x${'33'.repeat(32)}`,
				localBlockHash: `0x${'11'.repeat(32)}`,
				quorumBlockHash: `0x${'22'.repeat(32)}`,
				quorumReportStateHash: `0x${'33'.repeat(32)}`,
			}),
		).toThrow('different canonical blocks')
		expect(() =>
			assertCanonicalExecutionSnapshot({
				expectedReportStateHash: `0x${'33'.repeat(32)}`,
				localBlockHash: `0x${'11'.repeat(32)}`,
				quorumBlockHash: `0x${'11'.repeat(32)}`,
				quorumReportStateHash: `0x${'44'.repeat(32)}`,
			}),
		).toThrow('report changed')
	})

	test('rejects an agreeing entry receipt whose block is no longer canonical', async () => {
		const receipt = transactionReceipt()
		const readers = [{ getBlock: () => Promise.resolve({ hash: `0x${'90'.repeat(32)}` as Hex }) }, { getBlock: () => Promise.resolve({ hash: `0x${'90'.repeat(32)}` as Hex }) }]
		const canonicalHash = await canonicalBlockHashWithQuorum(readers, ['https://primary.example', 'https://secondary.example'], 'pending entry 7', receipt.blockNumber)
		expect(() => assertReceiptSnapshotBlockHash(receipt.blockHash, canonicalHash, 'Entry')).toThrow('different canonical blocks')
	})

	test('rejects receipt recovery when mined gas price is missing', async () => {
		const receipt = { ...transactionReceipt(), effectiveGasPrice: undefined }
		const readers = [{ getTransactionReceipt: () => Promise.resolve(receipt) }, { getTransactionReceipt: () => Promise.resolve(receipt) }]
		await expect(transactionReceiptsWithQuorum(readers, ['https://primary.example', 'https://secondary.example'], 'pending entry 7', [replacementHash])).rejects.toThrow('effective gas price')
	})

	test('rejects lifecycle accounting from a different canonical block than its receipts', () => {
		expect(() => assertReceiptSnapshotBlockHash(`0x${'11'.repeat(32)}`, `0x${'22'.repeat(32)}`, 'Lifecycle')).toThrow('different canonical blocks')
		expect(() => assertReceiptSnapshotBlockHash(`0x${'11'.repeat(32)}`, `0x${'11'.repeat(32)}`, 'Lifecycle')).not.toThrow()
	})

	test('does not submit when the final refreshed risk check fails', async () => {
		let submitted = false
		await expect(
			guardedRiskSubmission('Maximum UTC-day gas spend budget exceeded', async () => {
				submitted = true
			}),
		).rejects.toThrow('Maximum UTC-day gas spend budget exceeded')
		expect(submitted).toBe(false)
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

	test('continues receipt polling when private confirmation recovery itself fails', async () => {
		let receiptAttempts = 0
		const recoveryFailures: string[] = []
		const receipt = await waitForResolvedTransaction(
			originalHash,
			() => {
				receiptAttempts += 1
				if (receiptAttempts === 1) throw new Error('receipt unavailable')
				return Promise.resolve(transactionReceipt())
			},
			() => Promise.resolve(),
			() =>
				attemptConfirmationRecovery(
					() => Promise.reject(new Error('block number unavailable')),
					error => {
						recoveryFailures.push(error instanceof Error ? error.message : String(error))
					},
				),
		)
		expect(receiptAttempts).toBe(2)
		expect(recoveryFailures).toEqual(['block number unavailable'])
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

	test('wires the OpenOracle quote block through signing and refuses submission after expiry', async () => {
		const signed = await signAndSubmitOpenOracleDispute(
			100n,
			lastValidBlockNumber => Promise.resolve({ lastValidBlockNumber }),
			transaction => {
				assertSubmissionWindowOpen(transaction.lastValidBlockNumber, 100n)
				return Promise.resolve(transaction)
			},
		)
		expect(signed.lastValidBlockNumber).toBe(101n)

		await expect(
			signAndSubmitOpenOracleDispute(
				100n,
				lastValidBlockNumber => Promise.resolve({ lastValidBlockNumber }),
				transaction => {
					assertSubmissionWindowOpen(transaction.lastValidBlockNumber, 101n)
					return Promise.resolve(transaction)
				},
			),
		).rejects.toThrow('validity window expired')
	})

	test('caps private retries at the dispute window and performs no retry at expiry', async () => {
		const attemptedMaxBlocks: bigint[] = []
		const inWindow = await retryPrivateSubmissionWithinWindow({
			currentBlockNumber: 100n,
			lastValidBlockNumber: 101n,
			submit: maxBlockNumber => {
				attemptedMaxBlocks.push(maxBlockNumber)
				return Promise.resolve('accepted')
			},
		})
		expect(inWindow).toEqual({ attempted: true, maxBlockNumber: 101n, result: 'accepted' })

		const expired = await retryPrivateSubmissionWithinWindow({
			currentBlockNumber: 101n,
			lastValidBlockNumber: 101n,
			submit: maxBlockNumber => {
				attemptedMaxBlocks.push(maxBlockNumber)
				return Promise.resolve('must not submit')
			},
		})
		expect(expired).toEqual({ attempted: false })
		expect(attemptedMaxBlocks).toEqual([101n])
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

	test('does not label locked execute mode as economically eligible', () => {
		expect(
			opportunityDecision({
				account: undefined,
				currentReporter: reporter,
				execute: true,
				executionReady: true,
				hasRequiredInventory: undefined,
				profitable: true,
			}),
		).toBe('signer-unavailable')
		expect(
			opportunityDecision({
				account: address,
				currentReporter: reporter,
				execute: true,
				executionReady: true,
				hasRequiredInventory: undefined,
				profitable: true,
			}),
		).toBe('insufficient-inventory')
	})
})
