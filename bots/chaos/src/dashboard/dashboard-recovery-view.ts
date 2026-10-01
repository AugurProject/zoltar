import { type Workflow } from './workflow-history.js'
import { formatDate, node, setBadge, statusLabel, statusTone } from './dom.js'
import { pendingTransactionSummary } from './pending-transaction-summary.js'
import { type Snapshot, type OperationEvaluation, type PendingTransaction } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { ecosystemLabel, ecosystemLabels, ecosystemOrder, normalizeEcosystem, obligationDetail, operationIsIndependentlyExecutable, transactionIdentifier, transactionLine } from './dashboard-format.ts'
import type { DashboardState } from './dashboard-state.ts'

export function createDashboardRecoveryView({ state, elements }: { state: DashboardState; elements: DashboardElements }) {
	function renderWorkflow(value: Workflow | undefined, pendingTransactions: readonly PendingTransaction[]) {
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
		const stepHashes = new Set(value.steps.flatMap(step => (step.txHash === undefined ? [] : [step.txHash.toLowerCase()])))
		const waitingTransaction = value.status === 'waiting-transaction' ? pendingTransactions.find(transaction => transaction.hash !== undefined && stepHashes.has(transaction.hash.toLowerCase())) : undefined
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
		const cards = ecosystemOrder.map(ecosystem => {
			const operations = values.filter(value => normalizeEcosystem(value.ecosystem) === ecosystem && operationIsIndependentlyExecutable(value))
			const eligible = operations.filter(value => value.enabled !== false && value.eligible === true).length
			const card = node('div', 'coverage-card')
			card.append(node('span', undefined, ecosystemLabels.get(ecosystem) ?? ecosystem), node('strong', undefined, `${eligible.toString()}/${operations.length.toString()}`), node('small', undefined, 'eligible operations'))
			return card
		})
		elements.coverageSummary.replaceChildren(...cards)
	}

	function transactionWaitNote(transaction: PendingTransaction) {
		const summary = pendingTransactionSummary(transaction)
		const note = node('div', `transaction-wait ${summary.tone}`)
		note.append(node('strong', undefined, summary.headline))
		if (summary.detail !== '') note.append(node('small', undefined, summary.detail))
		return note
	}

	function renderRecovery(value: Snapshot) {
		elements.pendingCount.textContent = value.pendingTransactions.length.toString()
		elements.obligationCount.textContent = value.obligations.length.toString()
		elements.obligationFields.disabled = value.paused !== true || value.obligations.length === 0
		const recoverableWorkflow = value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' ? value.currentWorkflow : undefined
		elements.workflowRecoveryPanel.hidden = recoverableWorkflow === undefined
		elements.workflowFields.disabled = value.paused !== true || recoverableWorkflow === undefined
		if (recoverableWorkflow !== undefined) {
			const label = recoverableWorkflow.label ?? recoverableWorkflow.operationId ?? 'Partial workflow'
			elements.workflowRecoverySummary.replaceChildren(node('strong', undefined, label), node('span', 'badge warning', statusLabel(recoverableWorkflow.status)), node('p', 'muted', `Workflow ${recoverableWorkflow.id ?? 'ID unavailable'} · ${recoverableWorkflow.operationId ?? 'Operation unavailable'}`))
		}
		const selectedObligation = elements.obligationIdInput.value
		elements.obligationIdInput.replaceChildren(
			...value.obligations.map(obligation => {
				const option = document.createElement('option')
				option.value = obligation.id ?? ''
				option.textContent = `${obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'} · ${statusLabel(obligation.status ?? 'pending')}`
				return option
			}),
		)
		if (value.obligations.some(obligation => obligation.id === selectedObligation)) {
			elements.obligationIdInput.value = selectedObligation
		}
		elements.replacementFields.disabled = value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
		elements.cancellationFields.disabled = value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
		const queuedCandidate = value.pendingTransactions[0]?.replacementHash ?? value.pendingTransactions[0]?.cancellationHash
		elements.candidateFields.disabled = value.paused !== true || queuedCandidate === undefined
		elements.replacementForm.hidden = value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
		elements.cancellationForm.hidden = value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
		elements.candidateForm.hidden = queuedCandidate === undefined
		elements.workflowForm.hidden = recoverableWorkflow === undefined
		elements.obligationForm.hidden = value.obligations.length === 0
		if (value.pendingTransactions.length === 0) {
			elements.pendingTransactions.className = 'stack-list empty-state'
			elements.pendingTransactions.textContent = 'No transaction requires confirmation.'
		} else {
			elements.pendingTransactions.className = 'stack-list'
			elements.pendingTransactions.replaceChildren(
				...value.pendingTransactions.map(transaction => {
					const row = node('div', 'stack-row')
					const copy = node('div')
					copy.append(node('strong', undefined, transaction.label ?? transaction.operationId ?? 'Pending transaction'))
					copy.append(transactionLine(state.configuration?.explorerUrl, `Nonce ${String(transaction.nonce ?? '—')}`, transaction.hash, 'pending transaction hash'))
					if (transaction.replacementHash !== undefined) {
						copy.append(transactionLine(state.configuration?.explorerUrl, 'Replacement queued', transaction.replacementHash, 'replacement transaction hash'))
					}
					if (transaction.cancellationHash !== undefined) {
						copy.append(transactionLine(state.configuration?.explorerUrl, 'Cancellation queued', transaction.cancellationHash, 'cancellation transaction hash'))
					}
					const status = node('span')
					setBadge(status, statusLabel(transaction.status ?? 'pending'), statusTone(transaction.status ?? 'pending'))
					row.append(copy, status, transactionWaitNote(transaction))
					return row
				}),
			)
		}
		if (value.obligations.length === 0) {
			elements.obligations.className = 'stack-list empty-state'
			elements.obligations.textContent = 'No follow-up obligation is due.'
		} else {
			elements.obligations.className = 'stack-list'
			elements.obligations.replaceChildren(
				...value.obligations.map(obligation => {
					const row = node('div', 'stack-row')
					const copy = node('div')
					copy.append(node('strong', undefined, obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'))
					copy.append(node('small', undefined, obligationDetail(obligation)))
					const status = node('span')
					const automaticRetryWaiting = obligation.status === 'deferred' && obligation.notBefore !== undefined
					setBadge(status, automaticRetryWaiting ? 'Retry waiting' : statusLabel(obligation.status ?? 'pending'), automaticRetryWaiting ? 'warning' : statusTone(obligation.status ?? 'pending'))
					row.append(copy, status)
					return row
				}),
			)
		}
	}
	return { renderWorkflow, renderCoverage, renderRecovery }
}
