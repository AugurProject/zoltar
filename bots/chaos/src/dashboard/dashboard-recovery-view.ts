import { type Workflow } from './workflow-history.js'
import { formatDate, node, renderWhenChanged, setBadge, statusLabel, statusTone } from './dom.js'
import { pendingTransactionSummary } from './pending-transaction-summary.js'
import { recoveryFormSubmitting } from './recovery-form-lock.ts'
import { type Snapshot, type OperationEvaluation, type PendingTransaction } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { ecosystemLabel, ecosystemLabels, ecosystemOrder, normalizeEcosystem, obligationDetail, operationIsIndependentlyExecutable, transactionIdentifier, transactionLine } from './dashboard-format.ts'
import type { DashboardState } from './dashboard-state.ts'

export function createDashboardRecoveryView({ state, elements }: { state: DashboardState; elements: DashboardElements }) {
	function renderWorkflow(value: Workflow | undefined, pendingTransactions: readonly PendingTransaction[]) {
		const stepHashes = new Set(value?.steps.flatMap(step => (step.txHash === undefined ? [] : [step.txHash.toLowerCase()])) ?? [])
		const waitingTransaction = value?.status === 'waiting-transaction' ? pendingTransactions.find(transaction => transaction.hash !== undefined && stepHashes.has(transaction.hash.toLowerCase())) : undefined
		const waitSummary = waitingTransaction === undefined ? undefined : pendingTransactionSummary(waitingTransaction)
		renderWhenChanged(elements.currentWorkflow, JSON.stringify([value, waitSummary, state.configuration?.explorerUrl]), () => buildWorkflow(value, waitingTransaction))
	}

	function buildWorkflow(value: Workflow | undefined, waitingTransaction: PendingTransaction | undefined) {
		if (value === undefined) {
			elements.currentWorkflow.className = 'empty-state'
			elements.currentWorkflow.textContent = 'No operation is in progress.'
			return
		}
		elements.currentWorkflow.className = ''
		const heading = node('div', 'workflow-heading')
		const copy = node('div')
		copy.append(node('strong', undefined, value.label ?? value.operationId ?? 'Active workflow'))
		copy.append(node('p', undefined, `${ecosystemLabel(value.ecosystem)} · started ${formatDate(value.startedAt)}`))
		const status = node('span')
		setBadge(status, value.status === undefined ? 'In progress' : statusLabel(value.status), statusTone(value.status))
		heading.append(copy, status)
		const steps = node('ol', 'step-list')
		for (const step of value.steps) {
			const row = node('li')
			const marker = node('span', `step-dot ${step.status ?? ''}`)
			marker.setAttribute('aria-hidden', 'true')
			const detail = node('span', 'step-detail')
			const readableStatus = statusLabel(step.status)
			const status = node('span', `step-status ${statusTone(step.status)}`, readableStatus)
			status.dataset['stepStatus'] = step.status?.trim().toLowerCase() || 'waiting'
			detail.append(status)
			if (step.txHash !== undefined) {
				const hash = transactionIdentifier(state.configuration?.explorerUrl, step.txHash, 'workflow transaction hash')
				hash.classList.add('step-hash')
				hash.dataset['stepHash'] = ''
				detail.append(hash)
			}
			row.append(marker, node('span', 'step-label', step.label ?? 'Workflow step'), detail)
			steps.append(row)
		}
		if (value.steps.length === 0) steps.append(node('li', undefined, 'Workflow state is being prepared.'))
		elements.currentWorkflow.replaceChildren(heading, ...(waitingTransaction === undefined ? [] : [transactionWaitNote(waitingTransaction)]), steps)
	}

	function renderCoverage(values: OperationEvaluation[]) {
		const independent = values.filter(operationIsIndependentlyExecutable)
		const selectable = independent.filter(value => value.classification === 'selectable')
		const eligibleRandom = selectable.filter(value => value.enabled !== false && value.eligible === true)
		const random = independent.filter(value => value.enabled !== false && value.randomEligible === true)
		const lifecycle = independent.filter(value => value.enabled !== false && value.lifecycleEligible === true)
		const known = independent.some(value => value.randomAllowed !== undefined)
		const disabled = selectable.length > 0 && known && selectable.every(value => value.randomAllowed === false)
		let detail = 'No random operation has an eligible plan in the current state.'
		if (!known) detail = 'Waiting for operation discovery.'
		else if (disabled) detail = 'New random work disabled by allowlist.'
		else if (random.length > 0) detail = `${random.length.toString()} operation${random.length === 1 ? '' : 's'} permitted by the allowlist. Live preflight must pass before execution.`
		else if (eligibleRandom.length > 0) detail = `The allowlist excludes all ${eligibleRandom.length.toString()} eligible random operation${eligibleRandom.length === 1 ? '' : 's'}.`
		else if (lifecycle.length > 0) detail = 'Only lifecycle operations have eligible plans.'
		const readiness = node('div', 'readiness-summary')
		const badge = node('span')
		if (!known) setBadge(badge, 'Random work: discovering', 'neutral')
		else if (random.length > 0) setBadge(badge, 'Random work: ready for selection', 'success')
		else setBadge(badge, 'Random work: blocked', 'warning')
		readiness.append(badge, node('p', 'muted', detail))
		if (disabled || (random.length === 0 && eligibleRandom.length > 0)) {
			const settings = node('a', 'text-link', 'Review random-operation settings')
			settings.href = '/settings'
			readiness.append(settings)
		}
		if (disabled && state.configuration?.initializeGenesisUniverse === true) readiness.append(node('p', 'muted', 'Genesis initialization remains permitted.'))
		const cards = ecosystemOrder.map(ecosystem => {
			const operations = independent.filter(value => normalizeEcosystem(value.ecosystem) === ecosystem)
			const eligible = operations.filter(value => value.enabled !== false && value.eligible === true).length
			const randomCount = random.filter(value => normalizeEcosystem(value.ecosystem) === ecosystem).length
			const lifecycleCount = lifecycle.filter(value => normalizeEcosystem(value.ecosystem) === ecosystem).length
			const card = node('div', 'coverage-card')
			card.append(
				node('span', undefined, ecosystemLabels.get(ecosystem) ?? ecosystem),
				node('strong', undefined, `${eligible.toString()}/${operations.length.toString()}`),
				node('small', undefined, 'eligible now'),
				node('small', undefined, `Random selections: ${randomCount.toString()}`),
				node('small', undefined, `Lifecycle ready: ${lifecycleCount.toString()}`),
			)
			return card
		})
		const grid = node('div', 'coverage-grid')
		grid.append(...cards)
		renderWhenChanged(elements.coverageSummary, JSON.stringify([readiness.outerHTML, cards.map(card => card.textContent)]), () => elements.coverageSummary.replaceChildren(readiness, grid))
	}

	/** The wait note carries relative ages, so it refreshes on its own without rebuilding the row that holds the transaction hash. */
	function fillTransactionWaitNote(note: HTMLElement, transaction: PendingTransaction) {
		const summary = pendingTransactionSummary(transaction)
		renderWhenChanged(note, JSON.stringify(summary), () => {
			note.className = `transaction-wait ${summary.tone}`
			note.replaceChildren(node('strong', undefined, summary.headline), ...(summary.detail === '' ? [] : [node('small', undefined, summary.detail)]))
		})
	}

	function transactionWaitNote(transaction: PendingTransaction) {
		const note = node('div')
		fillTransactionWaitNote(note, transaction)
		return note
	}

	let pendingTransactionNotes: HTMLElement[] = []

	function renderRecovery(value: Snapshot) {
		elements.pendingCount.textContent = value.pendingTransactions.length.toString()
		elements.obligationCount.textContent = value.obligations.length.toString()
		elements.obligationFields.disabled = recoveryFormSubmitting(elements.obligationFields) || value.paused !== true || value.obligations.length === 0
		const recoverableWorkflow = value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' ? value.currentWorkflow : undefined
		elements.workflowRecoveryPanel.hidden = recoverableWorkflow === undefined
		elements.workflowFields.disabled = recoveryFormSubmitting(elements.workflowFields) || value.paused !== true || recoverableWorkflow === undefined
		if (recoverableWorkflow !== undefined) {
			const label = recoverableWorkflow.label ?? recoverableWorkflow.operationId ?? 'Partial workflow'
			const detail = `Workflow ${recoverableWorkflow.id ?? 'ID unavailable'} · ${recoverableWorkflow.operationId ?? 'Operation unavailable'}`
			renderWhenChanged(elements.workflowRecoverySummary, JSON.stringify([label, recoverableWorkflow.status, detail]), () => elements.workflowRecoverySummary.replaceChildren(node('strong', undefined, label), node('span', 'badge warning', statusLabel(recoverableWorkflow.status)), node('p', 'muted', detail)))
		}
		const obligationOptions = value.obligations.map(obligation => ({ label: `${obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'} · ${statusLabel(obligation.status ?? 'pending')}`, value: obligation.id ?? '' }))
		renderWhenChanged(elements.obligationIdInput, JSON.stringify(obligationOptions), () => {
			const selectedObligation = elements.obligationIdInput.value
			elements.obligationIdInput.replaceChildren(...obligationOptions.map(option => new Option(option.label, option.value)))
			if (obligationOptions.some(option => option.value === selectedObligation)) elements.obligationIdInput.value = selectedObligation
		})
		elements.replacementFields.disabled = recoveryFormSubmitting(elements.replacementFields) || value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
		elements.cancellationFields.disabled = recoveryFormSubmitting(elements.cancellationFields) || value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
		const queuedCandidate = value.pendingTransactions[0]?.replacementHash ?? value.pendingTransactions[0]?.cancellationHash
		elements.candidateFields.disabled = recoveryFormSubmitting(elements.candidateFields) || value.paused !== true || queuedCandidate === undefined
		elements.replacementForm.hidden = value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
		elements.cancellationForm.hidden = value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
		elements.candidateForm.hidden = queuedCandidate === undefined
		elements.workflowForm.hidden = recoverableWorkflow === undefined
		elements.obligationForm.hidden = value.obligations.length === 0
		const explorerUrl = state.configuration?.explorerUrl
		// The observation only feeds the wait note, which updates in place below.
		const pendingRows = value.pendingTransactions.map(({ observation: _observation, submittedAt: _submittedAt, ...row }) => row)
		renderWhenChanged(elements.pendingTransactions, JSON.stringify([pendingRows, explorerUrl]), () => {
			pendingTransactionNotes = []
			if (value.pendingTransactions.length === 0) {
				elements.pendingTransactions.className = 'stack-list empty-state'
				elements.pendingTransactions.textContent = 'No transaction requires confirmation.'
				return
			}
			elements.pendingTransactions.className = 'stack-list'
			elements.pendingTransactions.replaceChildren(
				...value.pendingTransactions.map(transaction => {
					const row = node('div', 'stack-row')
					const copy = node('div')
					copy.append(node('strong', undefined, transaction.label ?? transaction.operationId ?? 'Pending transaction'))
					copy.append(transactionLine(explorerUrl, `Nonce ${String(transaction.nonce ?? '—')}`, transaction.hash, 'pending transaction hash'))
					if (transaction.replacementHash !== undefined) copy.append(transactionLine(explorerUrl, 'Replacement queued', transaction.replacementHash, 'replacement transaction hash'))
					if (transaction.cancellationHash !== undefined) copy.append(transactionLine(explorerUrl, 'Cancellation queued', transaction.cancellationHash, 'cancellation transaction hash'))
					const status = node('span')
					setBadge(status, statusLabel(transaction.status ?? 'pending'), statusTone(transaction.status ?? 'pending'))
					const note = transactionWaitNote(transaction)
					pendingTransactionNotes.push(note)
					row.append(copy, status, note)
					return row
				}),
			)
		})
		for (const [index, transaction] of value.pendingTransactions.entries()) {
			const note = pendingTransactionNotes[index]
			if (note !== undefined) fillTransactionWaitNote(note, transaction)
		}
		const obligationRows = value.obligations.map(obligation => {
			const automaticRetryWaiting = obligation.status === 'deferred' && obligation.notBefore !== undefined
			const tone: ReturnType<typeof statusTone> = automaticRetryWaiting ? 'warning' : statusTone(obligation.status ?? 'pending')
			return {
				badge: automaticRetryWaiting ? 'Retry waiting' : statusLabel(obligation.status ?? 'pending'),
				detail: obligationDetail(obligation),
				title: obligation.label ?? obligation.operationId ?? 'Lifecycle obligation',
				tone,
			}
		})
		renderWhenChanged(elements.obligations, JSON.stringify(obligationRows), () => {
			if (obligationRows.length === 0) {
				elements.obligations.className = 'stack-list empty-state'
				elements.obligations.textContent = 'No follow-up obligation is due.'
				return
			}
			elements.obligations.className = 'stack-list'
			elements.obligations.replaceChildren(
				...obligationRows.map(obligation => {
					const row = node('div', 'stack-row')
					const copy = node('div')
					copy.append(node('strong', undefined, obligation.title), node('small', undefined, obligation.detail))
					const status = node('span')
					setBadge(status, obligation.badge, obligation.tone)
					row.append(copy, status)
					return row
				}),
			)
		})
	}
	return { renderWorkflow, renderCoverage, renderRecovery }
}
