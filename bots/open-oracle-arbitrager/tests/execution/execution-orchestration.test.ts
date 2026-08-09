import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeFunctionData, mainnet, type Address, type EIP1193Provider, type Hex, type TransactionReceipt, type TransactionReplacement } from '#ethereum'
import { openOracleArbitrageExecutorAbi } from '#contracts/abi'
import {
	assertCanonicalExecutionSnapshot,
	assertReceiptSnapshotBlockHash,
	attemptConfirmationRecovery,
	buildHedgeExecutionPayload,
	canonicalBlockHashWithQuorum,
	executionFailureDecision,
	executionSnapshotWithQuorum,
	executionTokenAllowed,
	finalizeSubmittedLifecycleAttempt,
	fundingTransactionPlan,
	guardedTransactionSubmission,
	guardedRiskSubmission,
	journaledSubmission,
	lifecycleLastValidBlockNumber,
	lifecycleAttemptNeedsRecovery,
	lifecycleWithdrawalMismatch,
	openOracleDisputeTiming,
	opportunityDecision,
	privateBundleReceiptStatus,
	attemptHasFinality,
	privateEntryRecoveryIsConfirmed,
	recoveredTransactionIntentMismatch,
	receiptGasExpendituresWithQuorum,
	retryPrivateSubmissionWithinWindow,
	runFundedExecution,
	selectBestExecution,
	signAndSubmitOpenOracleDispute,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	transactionHashBySenderNonceWithQuorum,
	transactionIntentWithQuorum,
	transactionReceiptsWithQuorum,
	waitForResolvedTransaction,
} from '#execution/execution-orchestration'
import { loadPositionJournal, savePositionJournal, type PositionJournalFilesystem, type PositionRecord } from '#state/position-store'
import { assertSubmissionWindowOpen } from '#execution/transaction-submission'
import { v4QuotePlan } from '#core/uniswap-v4'

const address = '0x0000000000000000000000000000000000000001' as Address
const reporter = '0x0000000000000000000000000000000000000002' as Address
const originalHash = `0x${'34'.repeat(32)}` as Hex
const replacementHash = `0x${'56'.repeat(32)}` as Hex

function lifecyclePosition(): PositionRecord {
	return {
		account: address,
		actualEntryGasCostEth: '0.001',
		capitalAtRiskWeth: '2',
		closedAt: undefined,
		direction: 'sell-rep',
		entryTransactionHash: originalHash,
		entryTransactionHashes: [originalHash],
		gasExpenditures: [{ costEth: '0.001', minedAt: '2026-07-24T00:00:00.000Z', transactionHash: originalHash }],
		historyOutbox: undefined,
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
	test('propagates the selected V4 fee through encoded calldata and a reloaded durable execution intent', async () => {
		const v3AnchorFee = 3_000
		const selectedV4Fee = 500
		const plan = v4QuotePlan(reporter, selectedV4Fee, 11n, 13n)
		const payload = buildHedgeExecutionPayload({
			expectedParentBlockHash: originalHash,
			executionIntent: {
				direction: 'sell-rep',
				estimatedNetProfitWeth: '0.02',
				estimatedProfitBeforeGasEth: '0.03',
				reportId: '7',
				requiredToken: '11',
				requiredWeth: '13',
				token: reporter,
				tokenSymbol: 'REP',
			},
			hedgePool: address,
			hedgeWethLimitAttoEth: 13n,
			newAmount1: 17n,
			newAmount2: 19n,
			openOracle: reporter,
			router: address,
			selectedFee: selectedV4Fee,
			swapDeadline: 23n,
			venue: 'uniswap-v4',
		})
		const encoded = encodeFunctionData({
			abi: openOracleArbitrageExecutorAbi,
			functionName: 'hedgeAndDispute',
			args: [
				payload.hedgeRequest,
				{
					callbackContract: address,
					callbackGasLimit: 0,
					currentAmount1: 1n,
					currentAmount2: 2n,
					currentReporter: address,
					disputeDelay: 0,
					escalationHalt: 0n,
					feePercentage: 0,
					flags: 0,
					lastReportOppoTime: 0,
					multiplier: 100,
					numReports: 0,
					protocolFee: 0,
					protocolFeeRecipient: address,
					reportTimestamp: 0,
					settlementTime: 0,
					settlementTimestamp: 0,
					settlerRewardAttoEth: 0n,
					token1: address,
					token2: reporter,
				},
				{ blockNumber: 0n, blockTimestamp: 0n, creator: address, reportId: 7n },
				{ blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 0n, blockTimestampBound: 0n },
			],
		})
		const decoded = decodeFunctionData({ abi: openOracleArbitrageExecutorAbi, data: encoded })
		if (decoded.functionName !== 'hedgeAndDispute') throw new Error('Expected encoded hedgeAndDispute request')
		const decodedRequest = decoded.args[0]
		expect(plan.sell.poolKey.fee).toBe(selectedV4Fee)
		expect(plan.buy.poolKey.fee).toBe(selectedV4Fee)
		expect(decodedRequest.poolFee).toBe(BigInt(selectedV4Fee))
		expect(decodedRequest.venue).toBe(2n)
		expect(payload.executionIntent.poolFee).not.toBe(v3AnchorFee)

		const directory = await mkdtemp(join(tmpdir(), 'zoltar-v4-intent-'))
		const path = join(directory, 'positions.json')
		try {
			await savePositionJournal(path, [{ ...lifecyclePosition(), executionIntent: payload.executionIntent }])
			const reloaded = await loadPositionJournal(path)
			expect(reloaded[0]?.executionIntent).toEqual(payload.executionIntent)
			expect(reloaded[0]?.executionIntent?.poolFee).toBe(selectedV4Fee)
		} finally {
			await rm(directory, { force: true, recursive: true })
		}
	})

	test('rejects a per-reader V4 selected-fee quote disagreement', () => {
		const shared = {
			blockHash: `0x${'12'.repeat(32)}` as Hex,
			buyHedgeQuote: 13n,
			sellHedgeQuote: 11n,
		}
		expect(
			executionSnapshotWithQuorum(100n, [
				{ endpoint: 'rpc-a', value: shared },
				{ endpoint: 'rpc-b', value: shared },
			]),
		).toEqual(shared)
		expect(() =>
			executionSnapshotWithQuorum(100n, [
				{ endpoint: 'rpc-a', value: shared },
				{ endpoint: 'rpc-b', value: { ...shared, buyHedgeQuote: 14n } },
			]),
		).toThrow('RPC disagreement')
	})

	test('does not promote permissionlessly observed report tokens into the execution allowlist', () => {
		const configured = ['0x0000000000000000000000000000000000000010' as Address]
		const observed = '0x0000000000000000000000000000000000000020' as Address
		expect(executionTokenAllowed(configured, configured[0] as Address)).toBe(true)
		expect(executionTokenAllowed(configured, observed)).toBe(false)
	})

	test('stops waiting after the parent-bound target in both delivery modes', () => {
		expect(lifecycleLastValidBlockNumber(101n)).toBe(101n)
	})

	test('never attributes aggregate holder balances to a position after another reporter replaces it', () => {
		expect(
			lifecycleWithdrawalMismatch({
				currentReporter: false,
				expectedToken: 10n,
				expectedAttoWeth: 20n,
				holderToken: 10_000n,
				holderAttoWeth: 20_000n,
				willSettle: false,
			}),
		).toBe('Position was replaced; exact returned assets require manual reconciliation')
	})

	test('derives gas dates from quorum-confirmed canonical receipt blocks', async () => {
		const firstReceipt = transactionReceipt()
		const secondReceipt = {
			...transactionReceipt(),
			blockHash: `0x${'79'.repeat(32)}` as Hex,
			blockNumber: 102n,
			effectiveGasPrice: 20n,
			transactionHash: originalHash,
		}
		const blocks = new Map([
			[101n, { hash: firstReceipt.blockHash, timestamp: 1_774_051_199n }],
			[102n, { hash: secondReceipt.blockHash, timestamp: 1_774_051_201n }],
		])
		const readers = ['primary', 'secondary'].map(() => ({
			getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
				const block = blocks.get(blockNumber)
				if (block === undefined) throw new Error('missing test block')
				return block
			},
		}))
		expect(await receiptGasExpendituresWithQuorum(readers, ['https://primary.example', 'https://secondary.example'], 'lifecycle 7', [firstReceipt, secondReceipt])).toEqual([
			{ costAttoEth: 210_000n, minedAt: '2026-03-20T23:59:59.000Z', transactionHash: replacementHash },
			{ costAttoEth: 420_000n, minedAt: '2026-03-21T00:00:01.000Z', transactionHash: originalHash },
		])
	})

	test('requires pre-existing executor allowances so every entry is one parent-bound transaction', () => {
		expect(() => fundingTransactionPlan({ token1: 0n, token2: 4n }, { token1: 3n, token2: 4n })).toThrow('approved before entry')
		expect(() => fundingTransactionPlan({ token1: 1n, token2: 4n }, { token1: 3n, token2: 4n })).toThrow('approved before entry')
		expect(fundingTransactionPlan({ token1: 3n, token2: 4n }, { token1: 3n, token2: 4n })).toEqual(['execution'])
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

	test('releases a private attempt only after its target block has twelve canonical descendants', () => {
		expect(attemptHasFinality(112n, 101n)).toBe(false)
		expect(attemptHasFinality(113n, 101n)).toBe(true)
	})

	test('does not promote a gas-only private revert into confirmed execution history', () => {
		expect(privateEntryRecoveryIsConfirmed({ status: 'closed' })).toBe(false)
		expect(privateEntryRecoveryIsConfirmed({ status: 'open' })).toBe(true)
	})

	test('quorum-authenticates the calldata and destination of a public replacement', async () => {
		const expected = {
			data: '0x1234' as Hex,
			from: address,
			nonce: 8n,
			to: reporter,
			value: 0n,
		}
		const readers = [expected, expected].map(transaction => ({
			getTransaction: async () => ({ ...transaction, gas: 1n, hash: originalHash, input: transaction.data }),
		}))
		expect(await transactionIntentWithQuorum(readers, ['https://rpc-a.example', 'https://rpc-b.example'], 'public replacement', originalHash)).toEqual(expected)
		const alteredReader = {
			getTransaction: async () => ({ ...expected, gas: 1n, hash: originalHash, input: '0xabcd' as Hex }),
		}
		const firstReader = readers[0]
		if (firstReader === undefined) throw new Error('Test transaction reader is missing')
		await expect(transactionIntentWithQuorum([firstReader, alteredReader], ['https://rpc-a.example', 'https://rpc-b.example'], 'public replacement', originalHash)).rejects.toThrow('RPC disagreement')
		expect(recoveredTransactionIntentMismatch({ data: expected.data, to: expected.to, value: '0' }, expected, address, '8')).toBeUndefined()
		expect(recoveredTransactionIntentMismatch({ data: expected.data, to: expected.to, value: '0' }, { ...expected, data: '0xabcd' }, address, '8')).toContain('does not match')
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

	test('runs the final market guard before journaling and cannot leave a recoverable intent when blocked', async () => {
		const calls: string[] = []
		await expect(
			journaledSubmission(
				async () => {
					calls.push('persist')
				},
				async () => {
					calls.push('submit')
				},
				async () => {
					await Promise.resolve()
					calls.push('guard')
					throw new Error('market expired')
				},
			),
		).rejects.toThrow('market expired')
		expect(calls).toEqual(['guard'])
	})

	test('rechecks the final market guard after the durable journal is synced', async () => {
		const calls: string[] = []
		let checks = 0
		await expect(
			journaledSubmission(
				async () => {
					calls.push('persist')
				},
				async () => {
					calls.push('submit')
				},
				() => {
					checks += 1
					calls.push(`guard-${checks.toString()}`)
					if (checks === 2) throw new Error('market changed during persistence')
				},
			),
		).rejects.toThrow('market changed during persistence')
		expect(calls).toEqual(['guard-1', 'persist', 'guard-2'])
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

	test('durably records every public replacement reason before returning its receipt', async () => {
		for (const reason of ['repriced', 'cancelled', 'replaced'] as const) {
			const persisted: string[] = []
			let releasePersistence: (() => void) | undefined
			const persistence = new Promise<void>(resolve => {
				releasePersistence = resolve
			})
			let settled = false
			const waiting = waitForResolvedTransaction(
				originalHash,
				async ({ onReplaced }) => {
					onReplaced(replacement(reason))
					return transactionReceipt()
				},
				() => Promise.resolve(),
				() => {},
				value => {
					persisted.push(`${value.reason}:${value.transaction.hash}`)
					return persistence
				},
				() => true,
			).then(receipt => {
				settled = true
				return receipt
			})
			await Promise.resolve()
			expect(settled).toBe(false)
			expect(persisted).toEqual([`${reason}:${replacementHash}`])
			if (releasePersistence === undefined) throw new Error('Replacement persistence release is unavailable')
			releasePersistence()
			expect((await waiting).transactionHash).toBe(replacementHash)
		}
	})

	test('serializes multiple replacement journal writes in observation order', async () => {
		const firstHash = `0x${'55'.repeat(32)}` as Hex
		const persisted: Hex[] = []
		let releaseFirst: (() => void) | undefined
		const firstPersistence = new Promise<void>(resolve => {
			releaseFirst = resolve
		})
		const waiting = waitForResolvedTransaction(
			originalHash,
			async ({ onReplaced }) => {
				onReplaced({ ...replacement('repriced'), transaction: { hash: firstHash } })
				onReplaced(replacement('repriced'))
				return transactionReceipt()
			},
			() => Promise.resolve(),
			() => {},
			async value => {
				if (value.transaction.hash === firstHash) await firstPersistence
				persisted.push(value.transaction.hash)
			},
			() => true,
		)
		await Promise.resolve()
		expect(persisted).toEqual([])
		if (releaseFirst === undefined) throw new Error('First replacement persistence release is unavailable')
		releaseFirst()
		expect((await waiting).transactionHash).toBe(replacementHash)
		expect(persisted).toEqual([firstHash, replacementHash])
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
			const persisted: string[] = []
			await expect(
				waitForResolvedTransaction(
					originalHash,
					async ({ onReplaced }) => {
						onReplaced(replacement(reason))
						return transactionReceipt()
					},
					() => Promise.resolve(),
					() => {},
					value => {
						persisted.push(value.transaction.hash)
					},
				),
			).rejects.toThrow(`was ${reason}`)
			expect(persisted).toEqual([replacementHash])
		}
	})

	test('discovers a canonical replacement by durable sender and nonce across RPCs', async () => {
		const requestedNonceTags: string[][] = []
		const reader = () => {
			const nonceTags: string[] = []
			requestedNonceTags.push(nonceTags)
			const provider = {
				request: async ({ method, params }) => {
					if (!Array.isArray(params)) throw new Error(`${method} params are invalid`)
					if (method === 'eth_getTransactionCount') {
						const blockTag = params[1]
						if (typeof blockTag !== 'string') throw new Error('Transaction count block tag is invalid')
						nonceTags.push(blockTag)
						return BigInt(blockTag) >= 102n ? '0xa' : '0x9'
					}
					if (method === 'eth_getBlockByNumber') {
						const blockTag = params[0]
						if (typeof blockTag !== 'string') throw new Error('Block tag is invalid')
						return {
							hash: `0x${'78'.repeat(32)}`,
							number: blockTag,
							parentHash: `0x${'79'.repeat(32)}`,
							timestamp: '0x5',
							transactions:
								BigInt(blockTag) === 102n
									? [
											{
												from: address,
												gas: '0x5208',
												hash: replacementHash,
												input: '0x',
												nonce: '0x9',
												to: reporter,
												transactionIndex: '0x0',
												type: '0x2',
												value: '0x0',
											},
										]
									: [],
						}
					}
					throw new Error(`Unexpected RPC method: ${method}`)
				},
			} satisfies EIP1193Provider
			return createPublicClient({ chain: mainnet, transport: custom(provider) })
		}
		const hash = await transactionHashBySenderNonceWithQuorum([reader(), reader()], ['https://rpc-a.example', 'https://rpc-b.example'], 'public lifecycle', {
			account: address,
			fromBlockNumber: 100n,
			nonce: 9n,
			toBlockNumber: 103n,
		})
		expect(hash).toBe(replacementHash)
		expect(requestedNonceTags).toEqual([
			['0x67', '0x65', '0x66'],
			['0x67', '0x65', '0x66'],
		])
	})

	test('fails closed when RPCs disagree on a sender-and-nonce replacement', async () => {
		const reader = (hash: Hex) => ({
			getBlock: () => Promise.resolve({ transactions: [{ from: address, hash, nonce: 9n }] }),
			getTransactionCount: () => Promise.resolve(10n),
		})
		await expect(
			transactionHashBySenderNonceWithQuorum([reader(originalHash), reader(replacementHash)], ['https://rpc-a.example', 'https://rpc-b.example'], 'public entry', {
				account: address,
				fromBlockNumber: 100n,
				nonce: 9n,
				toBlockNumber: 100n,
			}),
		).rejects.toThrow('RPC disagreement')
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
