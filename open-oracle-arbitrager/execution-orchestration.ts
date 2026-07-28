import type { Address, Hex, TransactionReceipt, TransactionReplacement } from '@zoltar/shared/ethereum'
import { endpointLabel } from './connectivity.js'
import type { ExecutionRecord, OpportunitySnapshot } from './operator-state.js'
import type { PositionRecord } from './position-store.js'
import { quorumValue } from './read-quorum.js'
import { isSelfReport } from './strategy.js'
import type { SubmissionMode } from './transaction-submission.js'

export function executionTokenAllowed(allowedTokens: readonly Address[], token: Address) {
	return allowedTokens.some(allowed => allowed.toLowerCase() === token.toLowerCase())
}

export function fundingTransactionPlan(mode: SubmissionMode, allowances: { token1: bigint; token2: bigint }, contributions: { token1: bigint; token2: bigint }) {
	const transactions: ('approval-token1' | 'approval-token2' | 'execution' | 'reset-token1' | 'reset-token2')[] = []
	if (allowances.token1 < contributions.token1) {
		if (allowances.token1 !== 0n) transactions.push('reset-token1')
		transactions.push('approval-token1')
	}
	if (allowances.token2 < contributions.token2) {
		if (allowances.token2 !== 0n) transactions.push('reset-token2')
		transactions.push('approval-token2')
	}
	if (mode === 'public' && transactions.length !== 0) throw new Error('Missing executor allowances require private bundle submission')
	transactions.push('execution')
	return transactions
}

export function openOracleDisputeTiming(quoteBlockNumber: bigint, quoteBlockTimestamp: bigint) {
	return [quoteBlockNumber, 1n, quoteBlockTimestamp, 300n] as const
}

export function privateBundleReceiptStatus(receipt: Pick<TransactionReceipt, 'blockNumber' | 'status'> | undefined, targetBlockNumber: bigint) {
	if (receipt === undefined || receipt.blockNumber !== targetBlockNumber) return 'confirmation-unknown' as const
	return receipt.status === 'success' ? ('confirmed' as const) : ('reverted' as const)
}

export function lifecycleLastValidBlockNumber(mode: SubmissionMode, targetBlockNumber: bigint) {
	return mode === 'private' ? targetBlockNumber : undefined
}

export function lifecycleReceiptSnapshotBlock(receipts: readonly Pick<TransactionReceipt, 'blockHash' | 'blockNumber' | 'status'>[], targetBlockNumber: bigint) {
	const first = receipts[0]
	if (first === undefined || receipts.some(receipt => receipt.status !== 'success')) throw new Error('Lifecycle receipts are missing or reverted')
	if (targetBlockNumber !== 0n) {
		if (receipts.some(receipt => receipt.blockNumber !== targetBlockNumber || receipt.blockHash.toLowerCase() !== first.blockHash.toLowerCase())) {
			throw new Error('Lifecycle bundle receipts are outside the target block or split across blocks')
		}
		return { blockHash: first.blockHash, blockNumber: targetBlockNumber }
	}
	const latest = receipts.reduce((candidate, receipt) => (receipt.blockNumber > candidate.blockNumber ? receipt : candidate), first)
	return { blockHash: latest.blockHash, blockNumber: latest.blockNumber }
}

export async function simulateTrackedPrivateBundle<TTransaction, TResult>(transactions: readonly TTransaction[], simulate: () => Promise<TResult>, track: (transaction: TTransaction, status: 'submission-failed' | 'submitting', error: unknown | undefined) => void) {
	for (const transaction of transactions) track(transaction, 'submitting', undefined)
	try {
		return await simulate()
	} catch (error) {
		for (const transaction of transactions) track(transaction, 'submission-failed', error)
		throw error
	}
}

export function trackPrivateBundleReceiptStatuses<TTransaction, TReceipt extends Pick<TransactionReceipt, 'blockNumber' | 'status'>>(
	transactions: readonly TTransaction[],
	receipts: readonly (TReceipt | undefined)[],
	targetBlockNumber: bigint,
	track: (transaction: TTransaction, status: 'confirmation-unknown' | 'confirmed' | 'reverted', receipt: TReceipt | undefined) => void,
) {
	if (transactions.length !== receipts.length) throw new Error('Private bundle transaction and receipt counts differ')
	const statuses = receipts.map(receipt => privateBundleReceiptStatus(receipt, targetBlockNumber))
	const complete = statuses.every(status => status === 'confirmed')
	if (complete) return true
	for (const [index, transaction] of transactions.entries()) {
		const status = statuses[index]
		if (status === undefined) throw new Error('Bundle receipt status order is incomplete')
		track(transaction, status, receipts[index])
	}
	return false
}

export function executionPausedError() {
	const error = new Error('Bot paused before the next transaction was broadcast')
	error.name = 'ExecutionPausedError'
	return error
}

export function isExecutionPausedError(error: unknown) {
	return error instanceof Error && error.name === 'ExecutionPausedError'
}

export function executionFailureDecision(error: unknown): OpportunitySnapshot['decision'] {
	return isExecutionPausedError(error) ? 'paused' : 'execution-failed'
}

export function opportunityDecision(parameters: { account: Address | undefined; currentReporter: Address; execute: boolean; executionReady: boolean; hasRequiredInventory: boolean | undefined; paused?: boolean | undefined; profitable: boolean }): OpportunitySnapshot['decision'] {
	if (!parameters.profitable) return 'unprofitable'
	if (parameters.execute && parameters.account === undefined) return 'signer-unavailable'
	if (isSelfReport(parameters.account, parameters.currentReporter)) return 'self-report'
	if (parameters.execute && parameters.hasRequiredInventory !== true) return 'insufficient-inventory'
	if (parameters.execute && parameters.paused === true) return 'paused'
	if (parameters.execute && !parameters.executionReady) return 'history-unavailable'
	return parameters.execute ? 'eligible' : 'dry-run-opportunity'
}

function rejectedReplacementError(replacement: TransactionReplacement) {
	const error = new Error(`Transaction ${replacement.replacedTransaction.hash} was ${replacement.reason} by ${replacement.transaction.hash}`)
	error.name = 'RejectedTransactionReplacementError'
	return error
}

function isRejectedReplacementError(error: unknown) {
	return error instanceof Error && error.name === 'RejectedTransactionReplacementError'
}

export async function waitForResolvedTransaction(hash: Hex, wait: (parameters: { hash: Hex; onReplaced: (replacement: TransactionReplacement) => void }) => Promise<TransactionReceipt>, retryDelay: () => Promise<unknown> = () => Bun.sleep(1_000), onRetry: (error: unknown) => Promise<unknown> | unknown = () => {}) {
	while (true) {
		let replacement: TransactionReplacement | undefined
		try {
			const receipt = await wait({
				hash,
				onReplaced: value => {
					replacement = value
				},
			})
			if (replacement !== undefined && replacement.reason !== 'repriced') throw rejectedReplacementError(replacement)
			return receipt
		} catch (error) {
			if (isRejectedReplacementError(error)) throw error
			await onRetry(error)
			await retryDelay()
		}
	}
}

export async function guardedExecutionStep<T>(isPaused: () => boolean, action: () => Promise<T>) {
	if (isPaused()) throw executionPausedError()
	return action()
}

export async function guardedTransactionSubmission<T>(isPaused: () => boolean, prepare: () => Promise<unknown>, submit: () => Promise<T>) {
	await prepare()
	if (isPaused()) throw executionPausedError()
	return submit()
}

export async function journaledSubmission<T>(persistPending: () => Promise<unknown>, submit: () => Promise<T>) {
	await persistPending()
	return submit()
}

export async function guardedRiskSubmission<T>(riskMismatch: string | undefined, submit: () => Promise<T>) {
	if (riskMismatch !== undefined) throw new Error(`Final execution risk check failed: ${riskMismatch}`)
	return submit()
}

export function assertReceiptSnapshotBlockHash(receiptBlockHash: Hex, snapshotBlockHash: Hex, label: string) {
	if (receiptBlockHash.toLowerCase() !== snapshotBlockHash.toLowerCase()) throw new Error(`${label} receipt and balance snapshot use different canonical blocks`)
}

export function assertCanonicalExecutionSnapshot(parameters: { expectedReportStateHash: Hex; localBlockHash: Hex; quorumBlockHash: Hex; quorumReportStateHash: Hex }) {
	if (parameters.localBlockHash.toLowerCase() !== parameters.quorumBlockHash.toLowerCase()) throw new Error('Execution quote and quorum snapshot use different canonical blocks')
	if (parameters.expectedReportStateHash.toLowerCase() !== parameters.quorumReportStateHash.toLowerCase()) throw new Error('Execution report changed in the canonical quorum snapshot')
}

type BlockHashReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined }>
}

export async function canonicalBlockHashWithQuorum(readers: readonly BlockHashReader[], endpoints: readonly string[], label: string, blockNumber: bigint) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	const observations = await Promise.all(
		readers.map(async (reader, index) => {
			const block = await reader.getBlock({ blockNumber })
			if (block.hash == null) throw new Error(`${label} canonical block is missing its hash`)
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: block.hash,
			}
		}),
	)
	return quorumValue(`${label} canonical block ${blockNumber.toString()}`, observations)
}

export function lifecycleAttemptNeedsRecovery(position: PositionRecord) {
	return (position.status === 'withdrawing' || position.status === 'recovery-required') && position.lifecycleTransactionHashes.length !== 0 && !position.lifecycleReceiptRecovered
}

export async function finalizeSubmittedLifecycleAttempt(lifecyclePosition: PositionRecord, recover: (position: PositionRecord) => Promise<PositionRecord>, persist: (position: PositionRecord) => Promise<unknown>) {
	let recovered: PositionRecord
	try {
		recovered = await recover(lifecyclePosition)
	} catch (error) {
		await persist({ ...lifecyclePosition, status: 'recovery-required' })
		throw error
	}
	await persist(recovered)
	if (recovered.status !== 'closed') throw new Error(`Position ${lifecyclePosition.reportId} lifecycle assets do not match the expected hedge-neutral withdrawal`)
	return recovered
}

type TransactionReceiptReader = {
	getTransactionReceipt: (parameters: { hash: Hex }) => Promise<TransactionReceipt>
}

type ReceiptBlockReader = {
	getBlock: (parameters: { blockNumber: bigint }) => Promise<{ hash?: Hex | null | undefined; timestamp: bigint }>
}

export async function receiptGasExpendituresWithQuorum(readers: readonly ReceiptBlockReader[], endpoints: readonly string[], label: string, receipts: readonly Pick<TransactionReceipt, 'blockHash' | 'blockNumber' | 'effectiveGasPrice' | 'gasUsed' | 'transactionHash'>[]) {
	if (readers.length !== endpoints.length) throw new Error(`${label} block readers and endpoints differ`)
	const observations = await Promise.all(
		readers.map(async (reader, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await Promise.all(
				receipts.map(async receipt => {
					const block = await reader.getBlock({ blockNumber: receipt.blockNumber })
					if (block.hash === null || block.hash === undefined) throw new Error(`${label} receipt block ${receipt.blockNumber.toString()} is missing its canonical hash`)
					if (block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error(`${label} receipt ${receipt.transactionHash} is not in the canonical block`)
					if (typeof receipt.effectiveGasPrice !== 'bigint') throw new Error(`${label} receipt ${receipt.transactionHash} is missing its effective gas price`)
					const milliseconds = block.timestamp * 1_000n
					if (milliseconds < 0n || milliseconds > 8_640_000_000_000_000n) throw new Error(`${label} receipt block timestamp is outside the supported date range`)
					return {
						costWei: receipt.gasUsed * receipt.effectiveGasPrice,
						minedAt: new Date(Number(milliseconds)).toISOString(),
						transactionHash: receipt.transactionHash,
					}
				}),
			),
		})),
	)
	return quorumValue(`${label} canonical receipt blocks`, observations)
}

export async function transactionReceiptsWithQuorum(readers: readonly TransactionReceiptReader[], endpoints: readonly string[], label: string, transactionHashes: readonly Hex[]) {
	if (readers.length !== endpoints.length) throw new Error(`${label} receipt readers and endpoints differ`)
	const observations = await Promise.all(
		readers.map(async (reader, index) => {
			const receipts = await Promise.all(transactionHashes.map(hash => reader.getTransactionReceipt({ hash })))
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: receipts.map(receipt => {
					const effectiveGasPrice = receipt.effectiveGasPrice
					if (typeof effectiveGasPrice !== 'bigint') throw new Error(`${label} receipt ${receipt.transactionHash} is missing its effective gas price`)
					return {
						blockHash: receipt.blockHash,
						blockNumber: receipt.blockNumber,
						effectiveGasPrice,
						gasUsed: receipt.gasUsed,
						logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
						status: receipt.status,
						transactionHash: receipt.transactionHash,
					}
				}),
			}
		}),
	)
	return quorumValue(`${label} receipts`, observations)
}

export async function signAndSubmitOpenOracleDispute<TSigned, TSubmitted>(quoteBlockNumber: bigint, sign: (lastValidBlockNumber: bigint) => Promise<TSigned>, submit: (signed: TSigned) => Promise<TSubmitted>) {
	const signed = await sign(quoteBlockNumber + 1n)
	return submit(signed)
}

export async function retryPrivateSubmissionWithinWindow<T>(parameters: { currentBlockNumber: bigint; lastValidBlockNumber: bigint | undefined; submit: (maxBlockNumber: bigint) => Promise<T> }) {
	if (parameters.lastValidBlockNumber !== undefined && parameters.currentBlockNumber >= parameters.lastValidBlockNumber) return { attempted: false as const }
	const defaultMaxBlockNumber = parameters.currentBlockNumber + 25n
	const maxBlockNumber = parameters.lastValidBlockNumber === undefined || parameters.lastValidBlockNumber > defaultMaxBlockNumber ? defaultMaxBlockNumber : parameters.lastValidBlockNumber
	return {
		attempted: true as const,
		maxBlockNumber,
		result: await parameters.submit(maxBlockNumber),
	}
}

export async function attemptConfirmationRecovery<T>(recover: () => Promise<T>, onFailure: (error: unknown) => Promise<unknown> | unknown) {
	try {
		return await recover()
	} catch (error) {
		await onFailure(error)
		return undefined
	}
}

export async function runFundedExecution<TPrepared, TSubmitted, TResult>(
	isPaused: () => boolean,
	stages: {
		approveToken1: () => Promise<bigint>
		approveToken2: () => Promise<bigint>
		confirm: (submitted: TSubmitted, prepared: TPrepared, approvalGasCost: bigint) => Promise<TResult>
		prepare: () => Promise<TPrepared>
		simulate: (prepared: TPrepared) => Promise<unknown>
		submit: (prepared: TPrepared) => Promise<TSubmitted>
	},
) {
	const approvalGasCost = (await guardedExecutionStep(isPaused, stages.approveToken1)) + (await guardedExecutionStep(isPaused, stages.approveToken2))
	const prepared = await stages.prepare()
	await guardedExecutionStep(isPaused, () => stages.simulate(prepared))
	const submitted = await guardedExecutionStep(isPaused, () => stages.submit(prepared))
	return stages.confirm(submitted, prepared, approvalGasCost)
}

export function recordConfirmedExecution(visible: ExecutionRecord[], pending: ExecutionRecord[], record: ExecutionRecord) {
	if (!visible.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) visible.unshift(record)
	pending.push(record)
}

export async function flushExecutionHistory(pending: ExecutionRecord[], append: (record: ExecutionRecord) => Promise<void>) {
	while (pending.length !== 0) {
		const record = pending[0]
		if (record === undefined) return
		await append(record)
		pending.shift()
	}
}

export function selectBestExecution<T>(candidates: readonly T[], score: (candidate: T) => bigint) {
	let best: T | undefined
	for (const candidate of candidates) {
		if (best === undefined || score(candidate) > score(best)) best = candidate
	}
	return best
}
