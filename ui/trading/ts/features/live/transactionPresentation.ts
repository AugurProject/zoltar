import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import * as workflowCopy from '../../copy/workflows.js'
import type { TransactionPhase } from './transactionWorkflow.js'

/** The button label while a transaction is in flight: checking the price, then the wallet, then the chain. */
export function transactionPendingLabel(phase: TransactionPhase) {
	if (phase === 'preparing') return workflowCopy.checkingLatestPrice
	if (phase === 'submitting') return workflowCopy.confirmInWallet
	return workflowCopy.waitingForConfirmation
}

export function transactionInFlight(phase: TransactionPhase) {
	return phase === 'preparing' || phase === 'submitting' || phase === 'pending'
}

/** One plain-language status line per phase, named by the action the user pressed. */
export function transactionStatusText(phase: TransactionPhase, action: string) {
	if (phase === 'preparing') return workflowCopy.preparingAction(action)
	if (phase === 'submitting') return workflowCopy.actionPendingInWallet(action)
	if (phase === 'pending') return workflowCopy.actionPendingOnchain(action)
	if (phase === 'confirmed') return workflowCopy.actionConfirmedOnchain(action)
	return undefined
}

/** The group notice: a blocked idle action explains itself; an in-flight or finished workflow keeps its progress text. */
export function resolveActionGroupMessage(phase: TransactionPhase, availability: ActionAvailability, statusText: string | undefined) {
	if ((phase === 'idle' || phase === 'error') && availability.disabled && availability.reason !== undefined) return availability.reason
	return statusText ?? availability.reason
}
