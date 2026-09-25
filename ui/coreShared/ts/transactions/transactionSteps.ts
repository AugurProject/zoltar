import { getTransactionReviewSignal } from './transactionReviewScope.js'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { transactionErrorMessages } from '../lib/errors.js'
import type { TransactionPlanStep } from '../wallet/chainBackend.js'
import { transitionTransactionLifecycle, type TransactionFailure, type TransactionLifecycle, type TransactionLifecycleEvent, type TransactionPhase } from './transactionLifecycle.js'
import { signal } from '@preact/signals'
import { formatUnits, maxUint256, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'

export type TransactionStepDetails = {
	proposedRepPerEthPrice?: bigint | undefined
	approval?: { requiredAmount: bigint; approvedAmount: bigint; tokenSymbol: string; tokenUnits: number }
	oracleOutcome?: TransactionPlanStep['oracleOutcome']
	tokenFunding?: readonly { amount: string; limit: string | undefined }[]
	optional?: boolean
	paidFrom?: string
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

/** Stop future review steps while reporting whether a wallet submission or receipt still needs tracking. */
export function cancelTransactionReview(reviewSignal: AbortSignal) {
	const current = transactionSteps.peek()
	const owned = current?.reviewSignal === reviewSignal ? current : undefined
	const trackingSubmitted = owned?.steps.some(step => isTransactionStepInFlight(step) || step.hash !== undefined) ?? false
	owned?.cancel()
	return { trackingSubmitted, steps: owned?.steps }
}

export function createTransactionStepController(signal = getTransactionReviewSignal()) {
	transactionStepOutcome.value = undefined
	let canceled = false
	let rejectReview: ((reason: Error) => void) | undefined
	const steps: TransactionStep[] = []
	let activeIndex = -1
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
	const reviewChoices = async (indices: readonly number[]) => {
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
			publish((index, amount) => {
				const step = steps[index]
				if (selected || canceled || !indices.includes(index) || step?.phase !== 'review') return
				selected = true
				activeIndex = index
				for (const other of steps) if (other !== step && other.phase === 'review') other.phase = 'upcoming'
				if (amount !== undefined && step.approval !== undefined) step.amount = `${amount === maxUint256 ? commonCopy.max : formatUnits(amount, step.approval.tokenUnits)} ${step.approval.tokenSymbol}`
				step.approvalAmount = amount ?? step.approval?.requiredAmount
				transitionStep(step, { type: 'review-confirmed' })
				rejectReview = undefined
				publish()
				resolve({ index, amount })
			})
		})
	}
	return {
		assertActive,
		setPlan(details: TransactionStepDetails[]) {
			if (steps.length > 0) throw new Error('The transaction plan has already started.')
			steps.push(...details.map(step => ({ ...step, phase: 'upcoming' as const })))
		},
		startWithoutReview(index: number) {
			claimWorkflow()
			const step = steps[index]
			if (steps.length !== 1 || index !== 0 || step?.phase !== 'upcoming' || step.approval !== undefined || (step.tokenFunding?.length ?? 0) > 0) throw new Error('Only a single transaction without approvals can skip app review.')
			activeIndex = index
			step.phase = 'wallet'
			publish()
			return undefined
		},
		async review(index = activeIndex + 1) {
			return (await reviewChoices([index])).amount
		},
		async chooseFunding(indices: readonly number[]) {
			assertActive()
			for (let index = 0; index < steps.length - 1; index += 1) {
				const step = steps[index]
				if (step !== undefined && !indices.includes(index) && step.phase !== 'confirmed') step.phase = 'skipped'
			}
			if (indices.length === 0) {
				publish()
				return undefined
			}
			return await reviewChoices(indices)
		},
		skipped() {
			const step = steps[activeIndex]
			if (step !== undefined) step.phase = 'skipped'
			if (!canceled) publish()
		},
		submitted(hash: Hash) {
			const step = steps[activeIndex]
			if (step === undefined) return
			transitionStep(step, { type: 'submitted', hash })
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
			transitionStep(step, { type: 'failed', failure })
			if (!canceled) publish()
		},
	}
}
