import { type Workflow } from './workflow-history.js'
import { formatDate, node, setBadge, statusLabel, statusTone } from './dom.js'
import { pendingTransactionSummary } from './pending-transaction-summary.js'
import { type Snapshot, type OperationEvaluation, type Obligation, type PendingTransaction } from './dashboard-data.ts'

type DashboardRecoveryViewContext = {
	currentWorkflow: HTMLDivElement
	ecosystemLabel: (value: string | undefined) => string
	transactionIdentifier: (hash: string, type: string) => HTMLSpanElement
	ecosystemOrder: readonly ['zoltar', 'statoblast', 'open-oracle', 'trading']
	normalizeEcosystem: (value: string | undefined) => string
	operationIsIndependentlyExecutable: (value: OperationEvaluation) => boolean
	ecosystemLabels: Map<string, string>
	coverageSummary: HTMLDivElement
	pendingCount: HTMLSpanElement
	obligationCount: HTMLSpanElement
	obligationFields: HTMLFieldSetElement
	workflowFields: HTMLFieldSetElement
	workflowRecoveryPanel: HTMLElement
	workflowRecoverySummary: HTMLDivElement
	workflowForm: HTMLFormElement
	obligationForm: HTMLFormElement
	replacementForm: HTMLFormElement
	cancellationForm: HTMLFormElement
	candidateForm: HTMLFormElement
	obligationIdInput: HTMLSelectElement
	replacementFields: HTMLFieldSetElement
	cancellationFields: HTMLFieldSetElement
	candidateFields: HTMLFieldSetElement
	pendingTransactions: HTMLDivElement
	transactionLine: (prefix: string, hash: string | undefined, type: string) => HTMLElement
	obligations: HTMLDivElement
	obligationDetail: (obligation: Obligation) => string
}

export function createDashboardRecoveryView(context: DashboardRecoveryViewContext) {
	function renderWorkflow(value: Workflow | undefined, pendingTransactions: readonly PendingTransaction[]) {
		if (value === undefined) {
			context.currentWorkflow.className = 'empty-state'
			context.currentWorkflow.textContent = 'No operation is in progress.'
			return
		}
		context.currentWorkflow.className = ''
		const heading = node('div', 'workflow-heading')
		const copy = node('div')
		copy.append(node('strong', undefined, value.label ?? value.operationId ?? 'Active workflow'))
		copy.append(node('p', undefined, `${context.ecosystemLabel(value.ecosystem)} · started ${formatDate(value.startedAt)}`))
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
				const hash = context.transactionIdentifier(step.txHash, 'workflow transaction hash')
				hash.classList.add('step-hash')
				hash.dataset['stepHash'] = ''
				detail.append(hash)
			}
			row.append(marker, node('span', 'step-label', step.label ?? 'Workflow step'), detail)
			steps.append(row)
		}
		if (value.steps.length === 0) steps.append(node('li', undefined, 'Workflow state is being prepared.'))
		context.currentWorkflow.replaceChildren(heading, ...(waitingTransaction === undefined ? [] : [transactionWaitNote(waitingTransaction)]), steps)
	}

	function renderCoverage(values: OperationEvaluation[]) {
		const cards = context.ecosystemOrder.map(ecosystem => {
			const operations = values.filter(value => context.normalizeEcosystem(value.ecosystem) === ecosystem && context.operationIsIndependentlyExecutable(value))
			const eligible = operations.filter(value => value.enabled !== false && value.eligible === true).length
			const card = node('div', 'coverage-card')
			card.append(node('span', undefined, context.ecosystemLabels.get(ecosystem) ?? ecosystem), node('strong', undefined, `${eligible.toString()}/${operations.length.toString()}`), node('small', undefined, 'eligible operations'))
			return card
		})
		context.coverageSummary.replaceChildren(...cards)
	}

	function transactionWaitNote(transaction: PendingTransaction) {
		const summary = pendingTransactionSummary(transaction)
		const note = node('div', `transaction-wait ${summary.tone}`)
		note.append(node('strong', undefined, summary.headline))
		if (summary.detail !== '') note.append(node('small', undefined, summary.detail))
		return note
	}

	function renderRecovery(value: Snapshot) {
		context.pendingCount.textContent = value.pendingTransactions.length.toString()
		context.obligationCount.textContent = value.obligations.length.toString()
		context.obligationFields.disabled = value.paused !== true || value.obligations.length === 0
		const recoverableWorkflow = value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' ? value.currentWorkflow : undefined
		context.workflowRecoveryPanel.hidden = recoverableWorkflow === undefined
		context.workflowFields.disabled = value.paused !== true || recoverableWorkflow === undefined
		if (recoverableWorkflow !== undefined) {
			const label = recoverableWorkflow.label ?? recoverableWorkflow.operationId ?? 'Partial workflow'
			context.workflowRecoverySummary.replaceChildren(node('strong', undefined, label), node('span', 'badge warning', statusLabel(recoverableWorkflow.status)), node('p', 'muted', `Workflow ${recoverableWorkflow.id ?? 'ID unavailable'} · ${recoverableWorkflow.operationId ?? 'Operation unavailable'}`))
		}
		const selectedObligation = context.obligationIdInput.value
		context.obligationIdInput.replaceChildren(
			...value.obligations.map(obligation => {
				const option = document.createElement('option')
				option.value = obligation.id ?? ''
				option.textContent = `${obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'} · ${statusLabel(obligation.status ?? 'pending')}`
				return option
			}),
		)
		if (value.obligations.some(obligation => obligation.id === selectedObligation)) {
			context.obligationIdInput.value = selectedObligation
		}
		context.replacementFields.disabled = value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
		context.cancellationFields.disabled = value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
		const queuedCandidate = value.pendingTransactions[0]?.replacementHash ?? value.pendingTransactions[0]?.cancellationHash
		context.candidateFields.disabled = value.paused !== true || queuedCandidate === undefined
		context.replacementForm.hidden = value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
		context.cancellationForm.hidden = value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
		context.candidateForm.hidden = queuedCandidate === undefined
		context.workflowForm.hidden = recoverableWorkflow === undefined
		context.obligationForm.hidden = value.obligations.length === 0
		if (value.pendingTransactions.length === 0) {
			context.pendingTransactions.className = 'stack-list empty-state'
			context.pendingTransactions.textContent = 'No transaction requires confirmation.'
		} else {
			context.pendingTransactions.className = 'stack-list'
			context.pendingTransactions.replaceChildren(
				...value.pendingTransactions.map(transaction => {
					const row = node('div', 'stack-row')
					const copy = node('div')
					copy.append(node('strong', undefined, transaction.label ?? transaction.operationId ?? 'Pending transaction'))
					copy.append(context.transactionLine(`Nonce ${String(transaction.nonce ?? '—')}`, transaction.hash, 'pending transaction hash'))
					if (transaction.replacementHash !== undefined) {
						copy.append(context.transactionLine('Replacement queued', transaction.replacementHash, 'replacement transaction hash'))
					}
					if (transaction.cancellationHash !== undefined) {
						copy.append(context.transactionLine('Cancellation queued', transaction.cancellationHash, 'cancellation transaction hash'))
					}
					const status = node('span')
					setBadge(status, statusLabel(transaction.status ?? 'pending'), statusTone(transaction.status ?? 'pending'))
					row.append(copy, status, transactionWaitNote(transaction))
					return row
				}),
			)
		}
		if (value.obligations.length === 0) {
			context.obligations.className = 'stack-list empty-state'
			context.obligations.textContent = 'No follow-up obligation is due.'
		} else {
			context.obligations.className = 'stack-list'
			context.obligations.replaceChildren(
				...value.obligations.map(obligation => {
					const row = node('div', 'stack-row')
					const copy = node('div')
					copy.append(node('strong', undefined, obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'))
					copy.append(node('small', undefined, context.obligationDetail(obligation)))
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
