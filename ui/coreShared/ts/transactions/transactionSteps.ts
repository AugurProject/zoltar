import { getTransactionReviewSignal } from './transactionReviewScope.js'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { getErrorMessage, transactionErrorMessages } from '../lib/errors.js'
import type { TransactionPlanStep } from '../wallet/chainBackend.js'
import { transitionTransactionLifecycle, type TransactionFailure, type TransactionLifecycle, type TransactionLifecycleEvent, type TransactionPhase } from './transactionLifecycle.js'
import { signal } from '@preact/signals'
import { maxUint256, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance, formatValueWithUnit } from '../lib/formatters.js'
import type { GlobalTransactionRow } from '../types/components.js'

/** A token amount a step transfers from the wallet, kept as a fixed-point value so every surface formats it from the same source. */
export type TokenFundingAmount = { amount: bigint; tokenSymbol: string; tokenUnits: number }

export type TransactionStepDetails = {
	proposedRepPerEthPrice?: bigint | undefined
	approval?: { purpose?: string | undefined; requiredAmount: bigint; recommendedAmount?: bigint | undefined; approvedAmount: bigint; tokenSymbol: string; tokenUnits: number }
	oracleOutcome?: TransactionPlanStep['oracleOutcome']
	tokenFunding?: readonly TokenFundingAmount[]
	optional?: boolean
	paidFrom?: string
	reviewRows?: readonly { label: string; value: string }[]
	technicalRows?: GlobalTransactionRow[]
	title: string
	/** Explains the step when the title alone does not convey its consequence; omitted for self-describing actions. */
	description: string | undefined
	contractAddress: Address | undefined
	contractLabel: string | undefined
	spender: Address | undefined
	amount: string | undefined
	ethValueAttoEth: bigint | undefined
}

/** A step waits (`upcoming`), is skipped, or runs through the transaction lifecycle phases. */
type TransactionStepPhase = 'skipped' | 'upcoming' | TransactionPhase

type TransactionStep = TransactionStepDetails & {
	phase: TransactionStepPhase
	hash?: Hash
	submittedAt?: number
	repriced?: boolean
	failure?: TransactionFailure
	approvalAmount?: bigint | undefined
}

/** The wallet prompt is open or the broadcast transaction is waiting for its receipt. */
export function isTransactionStepInFlight(step: Pick<TransactionStep, 'phase'>) {
	return step.phase === 'wallet' || step.phase === 'pending'
}

function getStepLifecycle(step: TransactionStep): TransactionLifecycle | undefined {
	if (step.phase === 'review' || step.phase === 'wallet') return { phase: step.phase }
	if (step.phase === 'pending' || step.phase === 'confirmed') return step.hash === undefined ? { phase: 'wallet' } : { phase: step.phase, hash: step.hash }
	if (step.phase === 'failed') return { phase: 'failed', failure: step.failure ?? { kind: 'error', message: transactionErrorMessages.confirmationUnavailable }, hash: step.hash }
	return undefined
}

/** Moves a step through the shared lifecycle; a step that never started can still fail before its review. */
function transitionStep(step: TransactionStep, event: TransactionLifecycleEvent) {
	const lifecycle = getStepLifecycle(step)
	// A confirmed step stays confirmed; a failure found afterwards (such as an approval below the requirement) stops the workflow.
	if (lifecycle?.phase === 'confirmed' && event.type === 'failed') {
		step.failure = event.failure
		return
	}
	let next: TransactionLifecycle | undefined
	if (lifecycle !== undefined) next = transitionTransactionLifecycle(lifecycle, event)
	else if (event.type === 'failed') next = { phase: 'failed', failure: event.failure }
	if (next === undefined || next === lifecycle) return
	step.phase = next.phase
	if (next.phase === 'pending' || next.phase === 'confirmed') step.hash = next.hash
	if (next.phase === 'failed') {
		step.failure = next.failure
		if (next.hash !== undefined) step.hash = next.hash
	}
}

type TransactionSteps = {
	showReviewDialog: boolean
	showLifecycle: boolean
	reviewCheck: { status: 'checking' } | { status: 'failed' | 'changed'; message: string; retry: () => void } | undefined
	reviewSignal: AbortSignal | undefined
	steps: TransactionStep[]
	activeIndex: number
	finish: () => void
	confirmStep: (index: number, amount?: bigint) => void
	confirm: (amount?: bigint) => void
	cancel: () => void
}

export const transactionSteps = signal<TransactionSteps | undefined>(undefined)
export const transactionStepOutcome = signal<{ hash: Hash; title: string; tone: 'success' | 'error'; detail?: string } | undefined>(undefined)

export function createTransactionStepController(signal = getTransactionReviewSignal(), showReviewDialog = true, showLifecycle = false) {
	transactionStepOutcome.value = undefined
	let canceled = false
	let rejectReview: ((reason: Error) => void) | undefined
	const steps: TransactionStep[] = []
	let activeIndex = -1
	let reviewCheck: TransactionSteps['reviewCheck']
	const stop = () => {
		canceled = true
		rejectReview?.(new Error(transactionErrorMessages.reviewCanceled))
		rejectReview = undefined
	}
	const clear = () => {
		if (transactionSteps.peek()?.cancel === cancel) transactionSteps.value = undefined
	}
	const cancel = () => {
		stop()
		clear()
	}
	const abort = () => {
		stop()
		// Abort can run during component teardown; release the presentation after subscribers detach.
		queueMicrotask(clear)
	}
	if (signal?.aborted) abort()
	else signal?.addEventListener('abort', abort, { once: true })
	const publish = (confirmStep: (index: number, amount?: bigint) => void = () => undefined) => {
		if (canceled) return
		transactionSteps.value = {
			showReviewDialog,
			showLifecycle,
			reviewCheck,
			reviewSignal: signal,
			steps: [...steps],
			activeIndex,
			confirm: amount => confirmStep(activeIndex, amount),
			confirmStep,
			cancel,
			finish: () => {
				for (const step of steps) if (step.phase === 'upcoming') step.phase = 'skipped'
				publish()
			},
		}
	}
	const assertActive = () => {
		if (canceled) throw new Error(transactionErrorMessages.reviewCanceled)
	}
	const claimWorkflow = () => {
		assertActive()
		const current = transactionSteps.peek()
		if (current !== undefined && current.cancel !== cancel) {
			if (current.steps.some(step => step.phase === 'review' || isTransactionStepInFlight(step))) throw new Error('Finish or cancel the current transaction first.')
			current.cancel()
		}
	}
	const reviewChoices = async (indices: readonly number[], checked?: { check: (retrying: boolean) => Promise<void>; recheck?: (amount?: bigint) => Promise<void> | undefined; retryStatus?: (error: unknown) => 'failed' | 'changed' | undefined; initialError?: Error | undefined; deferWallet?: boolean }) => {
		claimWorkflow()
		const first = indices[0]
		if (first === undefined || indices.some(index => steps[index] === undefined)) throw new Error('An unexpected transaction was blocked. Review the action again.')
		activeIndex = first
		for (const index of indices) {
			const step = steps[index]
			if (step !== undefined) step.phase = 'review'
		}
		return await new Promise<{ index: number; amount: bigint | undefined }>((resolve, reject) => {
			rejectReview = reject
			let selected = false
			const accept = (index: number, amount?: bigint) => {
				assertActive()
				const step = steps[index]
				if (step?.phase !== 'review') return
				selected = true
				activeIndex = index
				for (const other of steps) if (other !== step && other.phase === 'review') other.phase = 'upcoming'
				if (amount !== undefined && step.approval !== undefined) {
					const formattedAmount = amount === maxUint256 ? commonCopy.max : formatCurrencyBalance(amount, step.approval.tokenUnits)
					step.amount = formatValueWithUnit(formattedAmount, step.approval.tokenSymbol)
					step.title = commonCopy.formatApproveTokenAmount(formattedAmount, step.approval.tokenSymbol)
				}
				step.approvalAmount = amount ?? step.approval?.requiredAmount
				if (checked?.deferWallet === true) reviewCheck = { status: 'checking' }
				else transitionStep(step, { type: 'review-confirmed' })
				rejectReview = undefined
				publish()
				resolve({ index, amount })
			}
			const showRetry = (status: 'failed' | 'changed', error: unknown) => {
				const message = status === 'changed' && error instanceof Error ? error.message : getErrorMessage(error, transactionCopy.currentStateCheckFailed)
				reviewCheck = { status, message, retry: () => void runCheck(true) }
			}
			const runCheck = async (retrying = false) => {
				if (checked === undefined || canceled || reviewCheck?.status === 'checking') return
				reviewCheck = { status: 'checking' }
				publish(confirmChoice)
				try {
					await checked.check(retrying)
					if (canceled) return
					reviewCheck = undefined
				} catch (error) {
					if (canceled) return
					showRetry(checked.retryStatus?.(error) ?? 'failed', error)
				}
				publish(confirmChoice)
			}
			const confirmChoice = (index: number, amount?: bigint) => {
				if (selected || canceled || reviewCheck !== undefined || !indices.includes(index) || steps[index]?.phase !== 'review') return
				const recheck = checked?.recheck?.(amount)
				if (recheck === undefined) {
					accept(index, amount)
					return
				}
				reviewCheck = { status: 'checking' }
				publish(confirmChoice)
				void recheck
					.then(() => {
						if (canceled) return
						reviewCheck = undefined
						accept(index, amount)
					})
					.catch(error => {
						if (canceled) return
						const status = checked?.retryStatus?.(error)
						if (status !== undefined) {
							showRetry(status, error)
							publish(confirmChoice)
							return
						}
						reviewCheck = undefined
						rejectReview = undefined
						reject(error)
					})
			}
			if (checked?.initialError !== undefined) {
				showRetry(checked.retryStatus?.(checked.initialError) ?? 'failed', checked.initialError)
				publish(confirmChoice)
			} else if (checked === undefined) publish(confirmChoice)
			else void runCheck()
		})
	}
	return {
		assertActive,
		setPlan(details: TransactionStepDetails[]) {
			if (steps.length > 0) throw new Error('The transaction plan has already started.')
			steps.push(...details.map(step => ({ ...step, phase: 'upcoming' as const })))
		},
		setReviewRows(index: number, reviewRows: readonly { label: string; value: string }[]) {
			const step = steps[index]
			if (step !== undefined) step.reviewRows = reviewRows
		},
		setTechnicalRows(index: number, rows: GlobalTransactionRow[]) {
			const step = steps[index]
			if (step !== undefined) step.technicalRows = rows
		},
		startWithoutReview(index: number) {
			claimWorkflow()
			const step = steps[index]
			if (step?.phase !== 'upcoming') throw new Error('This transaction has already started.')
			if (steps.slice(0, index).some(previous => previous.phase !== 'confirmed' && previous.phase !== 'skipped')) throw new Error('Wait for preceding transactions to confirm.')
			activeIndex = index
			step.phase = 'wallet'
			step.approvalAmount = step.approval?.requiredAmount
			publish()
			return step.approvalAmount
		},
		async review(index = activeIndex + 1, checked?: Parameters<typeof reviewChoices>[1]) {
			return (await reviewChoices([index], checked)).amount
		},
		async chooseFunding(indices: readonly number[], automatically = false, checked?: Parameters<typeof reviewChoices>[1]) {
			assertActive()
			for (let index = 0; index < steps.length - 1; index += 1) {
				const step = steps[index]
				if (step !== undefined && !indices.includes(index) && step.phase !== 'confirmed') step.phase = 'skipped'
			}
			if (indices.length === 0) {
				publish()
				return undefined
			}
			if (automatically) {
				const index = indices[0]
				if (index === undefined) throw new Error('Missing funding transaction.')
				return { index, amount: this.startWithoutReview(index) }
			}
			return await reviewChoices(indices, checked)
		},
		openWallet() {
			assertActive()
			const step = steps[activeIndex]
			if (step?.phase !== 'review') return
			reviewCheck = undefined
			transitionStep(step, { type: 'review-confirmed' })
			publish()
		},
		skipped() {
			const step = steps[activeIndex]
			if (step !== undefined) step.phase = 'skipped'
			reviewCheck = undefined
			if (!canceled) publish()
		},
		submitted(hash: Hash, repriced = false) {
			const step = steps[activeIndex]
			if (step === undefined) return
			transitionStep(step, { type: 'submitted', hash })
			step.submittedAt ??= Date.now()
			if (repriced) step.repriced = true
			if (!canceled) publish()
		},
		receipt(hash: Hash, status: 'success' | 'reverted') {
			const step = steps.find(candidate => candidate.hash === hash)
			if (step === undefined) return
			transitionStep(step, { type: 'receipt', hash, status })
			if (status !== 'success') transactionStepOutcome.value = { hash, title: step.title, tone: 'error', detail: transactionCopy.revertedCheckingDetails }
			else if (steps.at(-1) !== step) transactionStepOutcome.value = { hash, title: transactionCopy.completedAction(step.title), tone: 'success' }
			if (status === 'success' && step.approval !== undefined && step.approvalAmount !== undefined) step.approval = { ...step.approval, approvedAmount: step.approvalAmount }
			if (!canceled) publish()
		},
		failed(failure: TransactionFailure) {
			const step = steps[activeIndex]
			if (step === undefined) return
			reviewCheck = undefined
			transitionStep(step, { type: 'failed', failure })
			if (!canceled) publish()
		},
	}
}
