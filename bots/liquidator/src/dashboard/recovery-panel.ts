import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import type { Snapshot } from './api-validation.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'

type RecoveryPanelContext = {
	state: DashboardState
	elements: DashboardElements
	refresh: () => Promise<void>
}

type PendingTransaction = Snapshot['pendingTransactions'][number]
type PendingStagedOperation = Snapshot['pendingStagedOperations'][number]

function recoveryCard(title: string, metadataText: string) {
	const card = document.createElement('article')
	card.className = 'recovery-card'
	const heading = document.createElement('h3')
	heading.textContent = title
	const metadata = document.createElement('p')
	metadata.className = 'mono muted'
	metadata.textContent = metadataText
	card.append(heading, metadata)
	return card
}

function stagedOperationCard(operation: PendingStagedOperation) {
	const card = recoveryCard(
		`Staged operation ${operation.operationId}`,
		`queued block ${operation.queuedBlock} · latest checked ${operation.latestRecoveryBlock ?? 'not yet'} · historical ${operation.historicalRecoveryComplete ? 'complete' : (operation.nextHistoricalBlock ?? 'not enabled')} · ${operation.coordinator} → ${operation.target}`,
	)
	const status = document.createElement('p')
	status.className = 'muted'
	status.textContent = operation.candidateBlock === undefined ? 'Waiting for a canonical outcome.' : `Outcome found at block ${operation.candidateBlock}; waiting for canonical finality.`
	card.append(status)
	return card
}

/** Renders pending transaction intents with their reconciliation forms and the staged operations awaiting a canonical outcome. */
export function createRecoveryPanel({ state, elements, refresh }: RecoveryPanelContext) {
	function reconciliationLocked(snapshot: Snapshot) {
		return state.pendingNetworkProfile !== undefined || !state.stateConnected || !snapshot.paused
	}

	function transactionCard(intent: PendingTransaction, snapshot: Snapshot) {
		const card = recoveryCard(intent.label, `${intent.mode} · nonce ${intent.nonce} · submitted at block ${intent.submissionBlock} · ${intent.hash}`)
		const form = document.createElement('form')
		form.className = 'reconciliation-form'
		const label = document.createElement('label')
		label.textContent = 'Finalized replacement or cancellation hash'
		const input = document.createElement('input')
		input.autocomplete = 'off'
		input.inputMode = 'text'
		input.pattern = '0x[0-9a-fA-F]{64}'
		input.placeholder = '0x…'
		input.required = true
		const button = document.createElement('button')
		button.type = 'submit'
		button.textContent = 'Verify & reconcile'
		button.disabled = reconciliationLocked(snapshot)
		const status = document.createElement('span')
		status.className = 'action-status'
		status.setAttribute('role', 'alert')
		const saved = state.recoveryActionStates.get(intent.hash.toLowerCase())
		if (saved !== undefined) actionStatus(status, saved.message, saved.failed)
		label.append(input)
		form.append(label, button, status)
		form.addEventListener('submit', async event => {
			event.preventDefault()
			if (!(await confirmOperatorAction({ title: 'Reconcile transaction', description: 'Use only a finalized transaction that intentionally replaced or canceled this intent.', phrase: 'RECONCILE', confirmLabel: 'Verify and reconcile' }))) return
			button.disabled = true
			actionStatus(status, 'Checking RPC quorum and canonical finality…')
			try {
				await put('/api/reconcile-transaction', { intentHash: intent.hash, replacementHash: input.value.trim() })
				state.recoveryActionStates.delete(intent.hash.toLowerCase())
				actionStatus(status, 'Reconciled')
				await refresh()
			} catch (error) {
				const message = publicFailure(error, 'Could not reconcile this intent. Confirm the replacement hash and finality, then retry.')
				state.recoveryActionStates.set(intent.hash.toLowerCase(), { failed: true, message })
				actionStatus(status, message, true)
			} finally {
				button.disabled = reconciliationLocked(snapshot)
			}
		})
		card.append(form)
		return card
	}

	function renderRecovery(snapshot: Snapshot) {
		const recoveryList = elements.recoveryList
		if (document.activeElement instanceof HTMLElement && recoveryList.contains(document.activeElement)) return
		if (snapshot.pendingTransactions.length === 0 && snapshot.pendingStagedOperations.length === 0) {
			const empty = document.createElement('p')
			empty.className = 'empty'
			empty.textContent = 'No pending recovery work.'
			recoveryList.replaceChildren(empty)
			return
		}
		recoveryList.replaceChildren(...snapshot.pendingTransactions.map(intent => transactionCard(intent, snapshot)), ...snapshot.pendingStagedOperations.map(stagedOperationCard))
	}

	return { renderRecovery }
}

/** Wires the recheck button, which polls the bot state immediately. */
export function registerRecoveryRecheck({ elements, controls, refresh }: { elements: DashboardElements; controls: MutationControls; refresh: () => Promise<void> }) {
	elements.recheckRecovery.addEventListener('click', async () => {
		elements.recheckRecovery.disabled = true
		try {
			await refresh()
		} finally {
			elements.recheckRecovery.disabled = controls.chainSettingsLocked()
		}
	})
}
