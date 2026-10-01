import type { Snapshot } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'

/** A recovery form whose submission found no current item, so it reloads state before the operator retries. */
export type RecoveryContextRefresh = {
	available: (value: Snapshot) => boolean
	fields: HTMLFieldSetElement
	loadedMessage: string
	missingMessage: string
	name: string
	retryButton: HTMLButtonElement
	status: HTMLSpanElement
}

export function createRecoveryContexts(elements: DashboardElements) {
	const replacement: RecoveryContextRefresh = {
		available: value => value.paused === true && value.pendingTransactions.length === 1 && value.pendingTransactions[0]?.hash !== undefined && value.pendingTransactions[0]?.cancellationHash === undefined,
		fields: elements.replacementFields,
		loadedMessage: 'Current pending intent loaded. Review the transaction hash, then submit again.',
		missingMessage: 'No pending intent is currently actionable for replacement. Recovery controls remain disabled.',
		name: 'pending intent',
		retryButton: elements.replacementRetryButton,
		status: elements.replacementStatus,
	}

	const cancellation: RecoveryContextRefresh = {
		available: value => value.paused === true && value.pendingTransactions.length === 1 && value.pendingTransactions[0]?.hash !== undefined && value.pendingTransactions[0]?.replacementHash === undefined,
		fields: elements.cancellationFields,
		loadedMessage: 'Current pending intent loaded. Review the cancellation details, then submit again.',
		missingMessage: 'No pending intent is currently actionable for cancellation. Recovery controls remain disabled.',
		name: 'pending intent',
		retryButton: elements.cancellationRetryButton,
		status: elements.cancellationStatus,
	}

	const candidate: RecoveryContextRefresh = {
		available: value => {
			const intent = value.pendingTransactions[0]
			return value.paused === true && value.pendingTransactions.length === 1 && intent?.hash !== undefined && (intent.replacementHash !== undefined || intent.cancellationHash !== undefined)
		},
		fields: elements.candidateFields,
		loadedMessage: 'Current recovery candidate loaded. Review it, then submit again.',
		missingMessage: 'No queued recovery candidate is available. Candidate controls remain disabled.',
		name: 'recovery candidate',
		retryButton: elements.candidateRetryButton,
		status: elements.candidateStatus,
	}

	const workflow: RecoveryContextRefresh = {
		available: value => value.paused === true && value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' && value.currentWorkflow.id !== undefined && value.currentWorkflow.updatedAt !== undefined,
		fields: elements.workflowFields,
		loadedMessage: 'Partial workflow loaded. Review it, then submit again.',
		missingMessage: 'No partial workflow awaiting continuation is available. Workflow controls remain disabled.',
		name: 'partial workflow',
		retryButton: elements.workflowRetryButton,
		status: elements.workflowStatus,
	}

	const obligation: RecoveryContextRefresh = {
		available: value => {
			const obligation = value.obligations.find(candidate => candidate.id === elements.obligationIdInput.value)
			return value.paused === true && obligation?.id !== undefined && obligation.updatedAt !== undefined
		},
		fields: elements.obligationFields,
		loadedMessage: 'Current lifecycle item loaded. Review it, then submit again.',
		missingMessage: 'No current lifecycle item is available. Lifecycle controls remain disabled.',
		name: 'lifecycle item',
		retryButton: elements.obligationRetryButton,
		status: elements.obligationStatus,
	}

	return { replacement, cancellation, candidate, workflow, obligation, all: [replacement, cancellation, candidate, workflow, obligation] as const }
}

export type RecoveryContexts = ReturnType<typeof createRecoveryContexts>
