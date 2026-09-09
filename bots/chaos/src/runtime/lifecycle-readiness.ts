import type { DurableObligation, RuntimeState } from '../state/operator-state.ts'
import type { OperationPlan } from '../operations/types.ts'
import { MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS, obligationForPlan } from './obligations.ts'
import { urgentOperationPlans } from './selection.ts'
import { retryableOnChainWorkflowFailure } from './workflows.ts'

function retryableLifecycleObligation(state: Pick<RuntimeState, 'obligations' | 'workflows'>, obligation: DurableObligation) {
	const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
	return workflow !== undefined && retryableOnChainWorkflowFailure(workflow) && obligation.automaticRetryCount < MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS
}

export function lifecycleObstructions(state: Pick<RuntimeState, 'obligations' | 'workflows'>) {
	let automaticRetry: DurableObligation | undefined
	for (const obligation of state.obligations) {
		if (obligation.status === 'deferred' && obligation.notBefore !== undefined) {
			automaticRetry ??= obligation
			continue
		}
		if (obligation.status !== 'blocked' && obligation.status !== 'executing' && obligation.status !== 'failed') continue
		if (obligation.status === 'failed' && retryableLifecycleObligation(state, obligation)) {
			automaticRetry ??= obligation
			continue
		}
		return { automaticRetry, hard: obligation }
	}
	return { automaticRetry, hard: undefined }
}

export function actionableUrgentLifecyclePlan(state: Pick<RuntimeState, 'evaluations' | 'obligations' | 'workflows'>, allow: (plan: OperationPlan) => boolean = () => true) {
	return urgentOperationPlans(state.evaluations).find(plan => obligationForPlan(state, plan) !== undefined && allow(plan))
}
