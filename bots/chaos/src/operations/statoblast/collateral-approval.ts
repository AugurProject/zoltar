import { openOracleCleanupPlan } from '../open-oracle/approvals.ts'
import { metadataAddress, metadataPositiveAmount } from '../trading/continuations.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationDefinition, OperationPlan, PlanningOptions } from '../types.ts'

/** Continue only the reviewed collateral spend, or revoke its workflow-created allowance. */
export function collateralSpendContinuation({
	snapshot,
	options,
	context,
	buildPlan,
	approvalId,
	actionId,
	label,
	risk,
}: {
	snapshot: EcosystemSnapshot
	options: PlanningOptions
	context: OperationContinuationContext
	buildPlan: OperationDefinition['buildPlan']
	approvalId: string
	actionId: string
	label: string
	risk: OperationPlan['risk']
}) {
	const token = metadataAddress(context.previousPlan.metadata, 'collateralToken')
	const spender = metadataAddress(context.previousPlan.metadata, 'collateralSpender')
	const required = metadataPositiveAmount(context.previousPlan.metadata, 'collateralBudget')
	if (token === undefined || spender === undefined || required === undefined) return undefined
	const cleanup = () => {
		const plan = openOracleCleanupPlan(snapshot, context, [{ id: approvalId, token, spender, required }], label, risk)
		return plan === undefined ? undefined : { ...plan, ecosystem: 'statoblast' as const }
	}
	if (context.continuationDisposition === 'cleanup-only' || context.confirmedStepIds.includes(actionId)) return cleanup()
	const next = buildPlan(snapshot, options)
	const prior = context.previousPlan.steps.find(step => step.id === actionId)
	const action = next?.steps.find(step => step.id === actionId)
	if (prior === undefined || action === undefined || prior.to !== action.to || prior.data !== action.data || token !== snapshot.deployments.weth || next?.metadata['collateralBudget'] !== required.toString() || next.metadata['collateralSpender'] !== spender || next.metadata['collateralToken'] !== token) return cleanup()
	if (context.confirmedStepIds.includes(approvalId) && next.steps.some(step => step.id === approvalId)) return cleanup()
	return next
}
