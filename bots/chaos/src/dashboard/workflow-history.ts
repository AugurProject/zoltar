import { formatDate, node, replaceWhenChanged, setBadge, statusLabel, statusTone, transactionExplorerUrl } from './dom.js'
import { workflowProgress } from './workflow-progress.js'

export type WorkflowStep = {
	confirmedAt?: string | undefined
	label?: string | undefined
	status?: string | undefined
	txHash?: string | undefined
}

export type Workflow = {
	classification?: string | undefined
	completedAt?: string | undefined
	ecosystem?: string | undefined
	id?: string | undefined
	label?: string | undefined
	operationId?: string | undefined
	startedAt?: string | undefined
	status?: string | undefined
	updatedAt?: string | undefined
	steps: WorkflowStep[]
}

export function createWorkflowHistory(container: HTMLElement) {
	let cache = new Map<string, { signature: string; element: HTMLDetailsElement }>()
	const empty = node('p', 'empty-state', 'No workflows recorded yet.')
	return (workflows: readonly Workflow[], explorerUrl: string | undefined, paused: boolean) => {
		const retained = new Map<string, { signature: string; element: HTMLDetailsElement }>()
		const rows = [...workflows]
			.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
			.map((workflow, index) => {
				const key = workflow.id ?? String(index)
				const signature = JSON.stringify([workflow, explorerUrl, paused])
				const cached = cache.get(key)
				if (cached?.signature === signature) {
					retained.set(key, cached)
					return cached.element
				}
				const details = node('details', 'panel workflow-history-entry')
				details.open = cached?.element.open ?? false
				const summary = node('summary')
				const label = node('span')
				label.append(node('strong', undefined, workflow.label ?? workflow.operationId ?? 'Workflow'), node('span', 'muted', `Started ${formatDate(workflow.startedAt)}`))
				const badge = node('span')
				const tone = workflow.status?.startsWith('waiting-') === true ? 'warning' : statusTone(workflow.status)
				setBadge(badge, statusLabel(workflow.status), workflow.status === 'completed' ? 'success' : tone)
				summary.append(label, badge)
				const active = workflow.status === 'waiting-transaction' || workflow.status === 'waiting-obligation' || (!paused && workflow.status === 'running')
				details.append(
					summary,
					node('p', 'muted', `Updated ${formatDate(workflow.updatedAt)}`),
					workflowProgress(
						workflow.steps.map(step => ({ ...step, hash: step.txHash, explorerUrl: step.txHash === undefined ? undefined : transactionExplorerUrl(explorerUrl, step.txHash) })),
						active,
					),
				)
				retained.set(key, { signature, element: details })
				return details
			})
		cache = retained
		replaceWhenChanged(container, rows.length === 0 ? [empty] : rows)
	}
}
