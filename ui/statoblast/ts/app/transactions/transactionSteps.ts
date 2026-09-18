import type { TransactionPlanStep } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { signal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'

export type TransactionStepDetails = {
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
}

type TransactionSteps = {
	steps: TransactionStep[]
	activeIndex: number
	finish: () => void
	confirm: () => void
	cancel: () => void
}

export const transactionSteps = signal<TransactionSteps | undefined>(undefined)

export function createTransactionStepController() {
	let canceled = false
	let rejectReview: ((reason: Error) => void) | undefined
	const steps: TransactionStep[] = []
	let activeIndex = -1
	const cancel = () => {
		canceled = true
		rejectReview?.(new Error('Remaining transactions canceled. Transactions already sent are unchanged.'))
		rejectReview = undefined
		if (transactionSteps.peek()?.cancel === cancel) transactionSteps.value = undefined
	}
	const publish = (confirm: () => void = () => undefined) => {
		transactionSteps.value = {
			steps: [...steps],
			activeIndex,
			confirm,
			cancel,
			finish: () => {
				for (const step of steps) if (step.phase === 'upcoming') step.phase = 'skipped'
				publish()
			},
		}
	}
	return {
		setPlan(details: TransactionStepDetails[]) {
			if (steps.length > 0) throw new Error('The transaction plan has already started.')
			steps.push(...details.map(step => ({ ...step, phase: 'upcoming' as const })))
		},
		async review() {
			if (canceled) throw new Error('Transaction sequence canceled. Review the action again.')
			const current = transactionSteps.peek()
			if (current !== undefined && current.cancel !== cancel) {
				if (current.steps.some(step => step.phase === 'review' || step.phase === 'pending')) throw new Error('Finish or cancel the current transaction first.')
				current.cancel()
			}
			activeIndex += 1
			const step = steps[activeIndex]
			if (step === undefined) throw new Error('An unexpected transaction was blocked. Review the action again.')
			step.phase = 'review'
			await new Promise<void>((resolve, reject) => {
				rejectReview = reject
				publish(() => {
					if (step.phase !== 'review' || canceled) return
					step.phase = 'pending'
					rejectReview = undefined
					publish()
					resolve()
				})
			})
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
			if (status !== 'success') step.error = 'Transaction reverted. Remaining steps were not sent.'
			if (!canceled) publish()
		},
		failed(message: string) {
			const step = steps[activeIndex]
			if (step === undefined || step.phase === 'confirmed') return
			step.phase = 'failed'
			step.error = message
			if (!canceled) publish()
		},
	}
}
