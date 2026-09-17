import { publicFailureReason } from '../execution/preflight-failure.ts'
import { publicExplorerUrl, safeString } from '../dashboard/public-fields.ts'
import type { DurableWorkflow, RuntimeState } from '../state/operator-state.ts'

export type ManualExecution = {
	previewId: string
	definitionId: string
	status: 'pending' | 'completed' | 'failed'
	message: string
	live: boolean
	explorerUrl: string | undefined
	plannedSteps?: { id: string; label: string }[]
	planId?: string
	workflow?: DurableWorkflow | undefined
	previousTerminalWorkflowIds: Set<string>
}

export function manualExecutionFeedback(execution: ManualExecution, state: RuntimeState) {
	if (execution.live && execution.planId !== undefined) {
		const workflowId = execution.workflow?.id
		const current = workflowId === undefined ? state.workflows.find(workflow => workflow.planId === execution.planId && workflow.operationId === execution.definitionId && !execution.previousTerminalWorkflowIds.has(workflow.id)) : state.workflows.find(workflow => workflow.id === workflowId)
		// Receipt rollback restores cloned journals; prefer authoritative objects until history is pruned.
		execution.workflow = current ?? execution.workflow
	}
	const workflow = execution.workflow
	const explorer = publicExplorerUrl(execution.explorerUrl)
	const steps =
		workflow === undefined
			? (execution.plannedSteps ?? []).map(step => ({ id: step.id, label: safeString(step.label) ?? 'Transaction', status: 'planned', hash: undefined, explorerUrl: undefined }))
			: workflow.steps.map(step => ({
					id: step.id,
					label: safeString(step.label) ?? 'Transaction',
					status: step.status,
					hash: step.transactionHash,
					explorerUrl: explorer === undefined || step.transactionHash === undefined ? undefined : `${explorer.replace(/\/+$/, '')}/tx/${step.transactionHash}`,
				}))
	const transactions = steps.flatMap(step => (step.hash === undefined ? [] : [{ label: step.label, hash: step.hash, status: step.status, explorerUrl: step.explorerUrl }]))
	const failure = workflow?.steps.findLast(step => step.failure !== undefined)?.failure
	const reason = failure === undefined ? undefined : publicFailureReason(failure)
	let status = execution.status
	let message = execution.message
	let outcome = execution.live ? 'checking' : 'dry-run'
	if (execution.status === 'failed') outcome = 'failed'
	if (workflow !== undefined) {
		if (workflow.status === 'completed') {
			outcome = 'confirmed'
			message = 'Operation confirmed.'
			if (status !== 'pending') status = 'completed'
		} else if (workflow.status === 'failed' || workflow.steps.some(step => step.status === 'failed')) {
			outcome = 'failed'
			message = 'Operation failed.'
		} else if (workflow.status === 'abandoned' && transactions.length === 0) {
			outcome = 'skipped'
			message = 'Operation skipped. No transaction signed. Preview again to use current chain state.'
		} else if (workflow.status === 'waiting-obligation') {
			outcome = 'confirming'
			message = 'Transaction confirmed. Waiting for canonical lifecycle confirmation.'
		} else if (workflow.status === 'blocked' || workflow.status === 'waiting-continuation' || workflow.status === 'abandoned') {
			outcome = 'recovery'
			message = transactions.length === 0 ? 'Operation stopped before signing. Recovery is required.' : 'Operation stopped after partial execution. Recovery is required.'
		} else if (transactions.length !== 0 && transactions.every(transaction => transaction.status === 'confirmed')) {
			outcome = execution.status === 'pending' ? 'executing' : 'recovery'
			message = execution.status === 'pending' ? 'Executing remaining operation steps…' : 'Operation incomplete. Recovery is required.'
		} else if (transactions.length !== 0) {
			outcome = 'submitted'
			message = transactions.some(transaction => transaction.status === 'signed') ? 'Transaction signed. Submission is not yet confirmed.' : 'Transaction submitted. Waiting for confirmation.'
			if (execution.status !== 'pending') {
				message += ' Chaos checks confirmation automatically. See Recovery for progress.'
				if (workflow.steps.some(step => step.status === 'planned' || step.status === 'blocked')) message += ' Remaining steps resume when live execution is enabled and their checks pass.'
			}
		}
		if (outcome === 'failed' && status !== 'pending') status = 'failed'
	} else if (execution.status !== 'pending' && execution.live) {
		outcome = execution.status === 'failed' ? 'failed' : 'unconfirmed'
		if (execution.status === 'completed') message = 'No transaction confirmation recorded. Check recent activity before retrying.'
	}
	return { previewId: execution.previewId, definitionId: execution.definitionId, status, outcome, message, reason, transactions, steps }
}
