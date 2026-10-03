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

type TransactionCard = {
	card: HTMLElement
	metadata: HTMLParagraphElement
	explorerLink: HTMLAnchorElement
	input: HTMLInputElement
	button: HTMLButtonElement
	status: HTMLSpanElement
	/** A reconciliation is being confirmed or sent; the card stays locked and keeps its status across polls. */
	busy: boolean
}

type StagedCard = { card: HTMLElement; metadata: HTMLParagraphElement; status: HTMLParagraphElement }

function recoveryCard(title: string) {
	const card = document.createElement('article')
	card.className = 'recovery-card'
	const heading = document.createElement('h3')
	heading.textContent = title
	const metadata = document.createElement('p')
	metadata.className = 'mono muted'
	card.append(heading, metadata)
	return { card, metadata }
}

function setText(target: HTMLElement, text: string) {
	if (target.textContent !== text) target.textContent = text
}

function historicalRecoveryText(operation: PendingStagedOperation) {
	if (operation.historicalRecoveryComplete) return 'historical backfill complete'
	return operation.nextHistoricalBlock === undefined ? 'historical backfill not enabled' : `historical backfill next block ${operation.nextHistoricalBlock}`
}

/**
 * Renders pending transaction intents with their reconciliation forms and the staged operations awaiting a canonical
 * outcome. Cards are kept per intent and updated in place, so a poll never discards a typed hash or an in-flight status.
 */
export function createRecoveryPanel({ state, elements, refresh }: RecoveryPanelContext) {
	const transactionCards = new Map<string, TransactionCard>()
	const stagedCards = new Map<string, StagedCard>()
	let renderedKey: string | undefined
	let latestSnapshot: Snapshot | undefined

	function reconciliationLocked() {
		return state.pendingNetworkProfile !== undefined || !state.stateConnected || latestSnapshot?.paused !== true
	}

	function explorerTransactionUrl(hash: string) {
		const explorerBase = state.configuration?.network?.explorerUrl
		return explorerBase !== undefined && URL.canParse(explorerBase) && /^0x[0-9a-fA-F]{64}$/.test(hash) ? `${explorerBase.replace(/\/+$/, '')}/tx/${hash}` : undefined
	}

	function createTransactionCard(intent: PendingTransaction): TransactionCard {
		const { card, metadata } = recoveryCard(intent.label)
		const explorerLink = document.createElement('a')
		explorerLink.target = '_blank'
		explorerLink.rel = 'noopener noreferrer'
		explorerLink.textContent = 'View pending transaction in explorer'
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
		input.spellcheck = false
		const button = document.createElement('button')
		button.type = 'submit'
		button.textContent = 'Verify & reconcile'
		const status = document.createElement('span')
		status.className = 'action-status'
		status.setAttribute('role', 'alert')
		const saved = state.recoveryActionStates.get(intent.hash.toLowerCase())
		if (saved !== undefined) actionStatus(status, saved.message, saved.failed)
		label.append(input)
		form.append(label, button, status)
		const entry: TransactionCard = { busy: false, button, card, explorerLink, input, metadata, status }
		form.addEventListener('submit', async event => {
			event.preventDefault()
			if (entry.busy || reconciliationLocked()) return
			const replacementHash = input.value.trim()
			entry.busy = true
			syncTransactionCard(entry, intent)
			try {
				if (!(await confirmOperatorAction({ title: 'Reconcile transaction', description: 'Use only a finalized transaction that intentionally replaced or canceled this intent.', phrase: 'RECONCILE', confirmLabel: 'Verify and reconcile' }))) return
				actionStatus(status, 'Checking RPC quorum and canonical finality…')
				await put('/api/reconcile-transaction', { intentHash: intent.hash, replacementHash })
				state.recoveryActionStates.delete(intent.hash.toLowerCase())
				actionStatus(status, 'Reconciled')
				await refresh()
			} catch (error) {
				const message = publicFailure(error, 'Could not reconcile this intent. Confirm the replacement hash and finality, then retry.')
				state.recoveryActionStates.set(intent.hash.toLowerCase(), { failed: true, message })
				actionStatus(status, message, true)
			} finally {
				entry.busy = false
				syncTransactionCard(entry, intent)
			}
		})
		card.append(explorerLink, form)
		return entry
	}

	function syncTransactionCard(entry: TransactionCard, intent: PendingTransaction) {
		setText(entry.metadata, `${intent.mode} · nonce ${intent.nonce} · submitted at block ${intent.submissionBlock} · ${intent.hash}`)
		const url = explorerTransactionUrl(intent.hash)
		entry.explorerLink.hidden = url === undefined
		if (url === undefined) entry.explorerLink.removeAttribute('href')
		else if (entry.explorerLink.getAttribute('href') !== url) entry.explorerLink.href = url
		entry.input.disabled = entry.busy
		entry.button.disabled = entry.busy || reconciliationLocked()
	}

	function syncStagedCard(entry: StagedCard, operation: PendingStagedOperation) {
		setText(entry.metadata, `queued block ${operation.queuedBlock} · latest checked ${operation.latestRecoveryBlock ?? 'not yet'} · ${historicalRecoveryText(operation)} · ${operation.coordinator} → ${operation.target}`)
		setText(entry.status, operation.candidateBlock === undefined ? 'Waiting for a canonical outcome.' : `Outcome found at block ${operation.candidateBlock}; waiting for canonical finality.`)
	}

	function createStagedCard(operation: PendingStagedOperation): StagedCard {
		const { card, metadata } = recoveryCard(`Staged operation ${operation.operationId}`)
		const status = document.createElement('p')
		status.className = 'muted'
		card.append(status)
		return { card, metadata, status }
	}

	function renderRecovery(snapshot: Snapshot) {
		latestSnapshot = snapshot
		const recoveryList = elements.recoveryList
		const transactionKeys = snapshot.pendingTransactions.map(intent => intent.hash.toLowerCase())
		const stagedKeys = snapshot.pendingStagedOperations.map(operation => operation.operationId)
		for (const key of transactionCards.keys()) if (!transactionKeys.includes(key)) transactionCards.delete(key)
		for (const key of stagedCards.keys()) if (!stagedKeys.includes(key)) stagedCards.delete(key)
		const cards: HTMLElement[] = []
		for (const intent of snapshot.pendingTransactions) {
			const key = intent.hash.toLowerCase()
			const entry = transactionCards.get(key) ?? createTransactionCard(intent)
			transactionCards.set(key, entry)
			syncTransactionCard(entry, intent)
			cards.push(entry.card)
		}
		for (const operation of snapshot.pendingStagedOperations) {
			const entry = stagedCards.get(operation.operationId) ?? createStagedCard(operation)
			stagedCards.set(operation.operationId, entry)
			syncStagedCard(entry, operation)
			cards.push(entry.card)
		}
		// The list is only rebuilt when its membership changes, so focus and typed values survive ordinary polls.
		const key = JSON.stringify([transactionKeys, stagedKeys])
		if (key === renderedKey) return
		renderedKey = key
		if (cards.length === 0) {
			const empty = document.createElement('p')
			empty.className = 'empty'
			empty.textContent = 'No pending recovery work.'
			recoveryList.replaceChildren(empty)
			return
		}
		const focused = document.activeElement instanceof HTMLElement && recoveryList.contains(document.activeElement) ? document.activeElement : undefined
		recoveryList.replaceChildren(...cards)
		if (focused !== undefined && recoveryList.contains(focused)) focused.focus()
	}

	return { renderRecovery }
}

/** Wires the refresh button, which polls the bot state immediately instead of waiting for the next poll. */
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
