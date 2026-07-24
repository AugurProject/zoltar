import type { Address, Hex, TransactionReceipt, TransactionReplacement } from '@zoltar/shared/ethereum'
import type { ExecutionRecord, OpportunitySnapshot } from './operator-state.js'
import { isSelfReport } from './strategy.js'

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

export function opportunityDecision(parameters: { account: Address | undefined; currentReporter: Address; execute: boolean; executionReady: boolean; hasRequiredInventory: boolean | undefined; profitable: boolean }): OpportunitySnapshot['decision'] {
	if (!parameters.profitable) return 'unprofitable'
	if (isSelfReport(parameters.account, parameters.currentReporter)) return 'self-report'
	if (parameters.hasRequiredInventory === false) return 'insufficient-inventory'
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
