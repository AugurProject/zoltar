import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import type { TransactionPlanStep } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { signal } from '@preact/signals'
import { formatUnits, maxUint256, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'

export type TransactionStepDetails = {
	proposedRepPerEthPrice?: bigint | undefined
	approval?: { requiredAmount: bigint; approvedAmount: bigint; tokenSymbol: string; tokenUnits: number }
	oracleOutcome?: TransactionPlanStep['oracleOutcome']
	tokenFunding?: readonly { amount: string; limit: string | undefined }[]
	optional?: boolean
	title: string
	description: string
	contractAddress: Address | undefined
	spender: Address | undefined
	amount: string | undefined
	ethValueAttoEth: bigint | undefined
}

type TransactionStep = TransactionStepDetails & {
	phase: 'skipped' | 'upcoming' | 'review' | 'pending' | 'confirmed' | 'failed'
	hash?: Hash
	error?: string
	approvalAmount?: bigint | undefined
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

export function createTransactionStepController(signal?: AbortSignal) {
	let canceled = false
	let rejectReview: ((reason: Error) => void) | undefined
	const steps: TransactionStep[] = []
	let activeIndex = -1
	const stop = () => {
		canceled = true
		rejectReview?.(new Error('Remaining transactions canceled. Transactions already sent are unchanged.'))
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
	const reviewChoices = async (indices: readonly number[]) => {
		if (canceled) throw new Error('Transaction sequence canceled. Review the action again.')
		const current = transactionSteps.peek()
		if (current !== undefined && current.cancel !== cancel) {
			if (current.steps.some(step => step.phase === 'review' || step.phase === 'pending')) throw new Error('Finish or cancel the current transaction first.')
			current.cancel()
		}
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
				for (const other of steps) if (other.phase === 'review') other.phase = 'upcoming'
				if (amount !== undefined && step.approval !== undefined) step.amount = `${amount === maxUint256 ? commonCopy.max : formatUnits(amount, step.approval.tokenUnits)} ${step.approval.tokenSymbol}`
				step.approvalAmount = amount ?? step.approval?.requiredAmount
				step.phase = 'pending'
				rejectReview = undefined
				publish()
				resolve({ index, amount })
			})
		})
	}
	return {
		setPlan(details: TransactionStepDetails[]) {
			if (steps.length > 0) throw new Error('The transaction plan has already started.')
			steps.push(...details.map(step => ({ ...step, phase: 'upcoming' as const })))
		},
		async review(index = activeIndex + 1) {
			return (await reviewChoices([index])).amount
		},
		async chooseFunding(indices: readonly number[]) {
			if (canceled) throw new Error('Transaction sequence canceled. Review the action again.')
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
			step.hash = hash
			if (!canceled) publish()
		},
		receipt(hash: Hash, status: string) {
			const step = steps.find(candidate => candidate.hash === hash)
			if (step === undefined) return
			step.phase = status === 'success' ? 'confirmed' : 'failed'
			if (status === 'success' && step.approval !== undefined && step.approvalAmount !== undefined) step.approval = { ...step.approval, approvedAmount: step.approvalAmount }
			if (status !== 'success') step.error = 'Transaction reverted.'
			if (!canceled) publish()
		},
		failed(message: string) {
			const step = steps[activeIndex]
			if (step === undefined) return
			if (step.phase !== 'confirmed') step.phase = 'failed'
			step.error = message
			if (!canceled) publish()
		},
	}
}
