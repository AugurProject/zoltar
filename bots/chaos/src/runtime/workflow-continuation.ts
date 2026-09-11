import type { OperatorSettings } from '../config/settings.ts'
import { operationHasCanonicalContinuationBuilder, reevaluateOperationContinuation } from '../operations/catalog.ts'
import type { EcosystemSnapshot, EvaluatedOperation, OperationContinuationDisposition } from '../operations/types.ts'
import type { DurableWorkflow } from '../state/operator-state.ts'
import { applyExecutionPolicy, planningOptions } from './canonical-scan.ts'
import { durableWorkflowPlan } from './workflows.ts'

export function evaluatePolicySafeContinuation(snapshot: EcosystemSnapshot, workflow: DurableWorkflow, settings: OperatorSettings, anchorBlock: string, retirementCleanup = false): { continuationDisposition?: OperationContinuationDisposition; evaluation: EvaluatedOperation } {
	const evaluate = (continuationDisposition: OperationContinuationDisposition | undefined) => {
		const evaluation = reevaluateOperationContinuation(snapshot, durableWorkflowPlan(workflow), planningOptions(settings, workflow.planningSeed), {
			confirmedStepIds: workflow.steps.filter(step => step.status === 'confirmed').map(step => step.id),
			...(continuationDisposition === undefined ? {} : { continuationDisposition }),
		})
		const policySettings = retirementCleanup ? { ...settings, strategy: { ...settings.strategy, allowHighRiskOperations: true, allowIrreversibleOperations: false, enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'] as const } } : settings
		const result = applyExecutionPolicy([evaluation], policySettings, true, anchorBlock, anchorBlock, BigInt(snapshot.wallet.ethBalanceAttoEth), 'durable-continuation')[0]
		if (result === undefined) throw new Error('Canonical continuation evaluation returned no result')
		return result
	}

	const continuation = evaluate(workflow.continuationDisposition)
	if (continuation.eligibility.eligible && continuation.plan !== undefined) {
		const continuationDisposition = continuation.plan.continuationDisposition ?? workflow.continuationDisposition
		return {
			...(continuationDisposition === undefined ? {} : { continuationDisposition }),
			evaluation: continuation,
		}
	}
	if (workflow.classification !== 'selectable' || workflow.continuationDisposition !== undefined || !workflow.steps.some(step => step.status === 'confirmed') || !operationHasCanonicalContinuationBuilder(workflow.operationId)) {
		return { evaluation: continuation }
	}

	const cleanup = evaluate('cleanup-only')
	if (cleanup.eligibility.eligible && cleanup.plan !== undefined) {
		if (cleanup.plan.continuationDisposition !== 'cleanup-only') throw new Error(`Cleanup-only continuation ${workflow.operationId} returned an unmarked plan`)
		return { continuationDisposition: 'cleanup-only', evaluation: cleanup }
	}
	const blockers = [...continuation.eligibility.blockers.map(blocker => `Action continuation: ${blocker}`), ...cleanup.eligibility.blockers.map(blocker => `Cleanup-only continuation: ${blocker}`)]
	return {
		evaluation: {
			definition: continuation.definition,
			eligibility: {
				blockers: blockers.length === 0 ? ['Neither the action continuation nor its cleanup is executable under current policy'] : blockers,
				eligible: false,
			},
		},
	}
}
