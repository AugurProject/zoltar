import { OperationRediscoveryRequired } from '../execution/transaction-executor.ts'
import { operationHasCanonicalContinuationBuilder } from '../operations/catalog.ts'
import type { OperationPlan } from '../operations/types.ts'
import { recordActivity, type DurableWorkflow, type RuntimeState } from '../state/operator-state.ts'
import { markRetryableWorkflowForRediscovery, markWorkflowForRediscovery, retryableOnChainWorkflowFailure, workflowFailureHasTransaction } from './workflows.ts'

export function workflowForPlan(state: RuntimeState, plan: Pick<OperationPlan, 'definitionId' | 'id'>) {
	return state.workflows.find(workflow => workflow.planId === plan.id && workflow.operationId === plan.definitionId)
}

export function rediscoverableExecutionFailure(state: RuntimeState, plan: OperationPlan, error: unknown) {
	if (!(error instanceof OperationRediscoveryRequired)) return false
	const workflow = workflowForPlan(state, plan)
	if (workflow === undefined || workflowFailureHasTransaction(workflow)) return false
	markWorkflowForRediscovery(workflow, error)
	if (workflow.classification === 'selectable' && workflow.steps.some(step => step.status === 'confirmed') && operationHasCanonicalContinuationBuilder(workflow.operationId)) {
		workflow.continuationDisposition = 'cleanup-only'
	}
	return true
}

function repairRetryableSelectableWorkflow(state: RuntimeState, workflow: DurableWorkflow) {
	if (workflow.classification !== 'selectable' || workflow.status !== 'failed' || !retryableOnChainWorkflowFailure(workflow)) {
		return false
	}
	if (workflow.steps.some(step => step.status === 'confirmed') && operationHasCanonicalContinuationBuilder(workflow.operationId)) {
		markRetryableWorkflowForRediscovery(workflow, 'A finalized on-chain failure left confirmed preparation on chain; canonical cleanup is required')
		recordActivity(state, {
			ecosystem: workflow.ecosystem,
			message: `Finalized selectable transaction failure retained for canonical cleanup: ${workflow.label}`,
			operationId: workflow.operationId,
			status: 'skipped',
			type: 'recovery',
		})
		return true
	}
	const timestamp = new Date().toISOString()
	workflow.completedAt ??= timestamp
	workflow.status = 'abandoned'
	workflow.updatedAt = timestamp
	recordActivity(state, {
		ecosystem: workflow.ecosystem,
		message: `Finalized selectable transaction failure retained as a completed attempt for fresh canonical discovery: ${workflow.label}`,
		operationId: workflow.operationId,
		status: 'skipped',
		type: 'recovery',
	})
	return true
}

export function abandonRetryableSelectableFailure(state: RuntimeState, plan: Pick<OperationPlan, 'definitionId' | 'ecosystem' | 'id' | 'label'>) {
	const workflow = workflowForPlan(state, plan)
	return workflow === undefined ? false : repairRetryableSelectableWorkflow(state, workflow)
}

export function repairDurableSelectableFailures(state: RuntimeState) {
	const repairedWorkflowIds: string[] = []
	const semanticFailures = state.workflows.filter(workflow => workflow.classification === 'selectable' && workflow.status === 'failed' && workflow.steps.some(step => step.status === 'failed' && step.failureKind === 'semantic-failure'))
	for (const workflow of state.workflows) {
		if (workflow.classification !== 'selectable' || workflow.status !== 'failed' || !retryableOnChainWorkflowFailure(workflow)) continue
		if (repairRetryableSelectableWorkflow(state, workflow)) {
			repairedWorkflowIds.push(workflow.id)
		}
	}
	if (semanticFailures.length !== 0) {
		const newlyStopped = !state.safetyPaused
		state.safetyPaused = true
		state.paused = true
		state.scheduler.status = 'paused'
		state.status = 'paused'
		const firstFailure = semanticFailures[0]
		state.error = `Durable semantic transaction failure requires explicit operator review before novelty${firstFailure === undefined ? '' : `: ${firstFailure.label}`}`
		if (newlyStopped) {
			recordActivity(state, {
				ecosystem: firstFailure?.ecosystem,
				message: 'Durable semantic transaction failure restored the safety pause before novel execution',
				operationId: firstFailure?.operationId,
				status: 'failed',
				type: 'recovery',
			})
		}
	}
	return { repairedWorkflowIds, requiresSafetyStop: semanticFailures.length !== 0 }
}
