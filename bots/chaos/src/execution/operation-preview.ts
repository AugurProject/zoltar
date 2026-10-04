import type { OperationPlan } from '../operations/types.ts'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { OperationRediscoveryRequired, type ExecutionEnvironment } from './execution-context.ts'
import { assertFreshWalletAssetDebits, assertStepPreflightCalls, rediscoverableSimulationAndGas } from './execution-preflight.ts'
import { agreedLatestBlock, exactAttestedEthBalance } from './execution-quorum.ts'
import { assertOperationEthFunding, assertOperationPlanFresh, assertOperationPrincipalCaps, assertStepSafety } from './safety.ts'
import { assertTerminalSubmissionBoundary } from '../runtime/workflows.ts'

/** A plan that cannot meet current policy is ineligible; RPC failures still propagate unchanged. */
function assertPreviewSafety(check: () => unknown) {
	try {
		check()
	} catch (error) {
		throw new OperationRediscoveryRequired(errorMessage(error), error)
	}
}

/** Read-only checks: later steps may depend on state changes made by the first transaction. */
export async function preflightOperationPreview(environment: ExecutionEnvironment, plan: OperationPlan) {
	assertTerminalSubmissionBoundary(plan)
	assertPreviewSafety(() => assertOperationPrincipalCaps(plan, environment.settings.strategy))
	const anchor = await agreedLatestBlock(environment, `${plan.label} preview block`)
	assertPreviewSafety(() => assertOperationPlanFresh(plan, anchor.number, environment.settings.strategy.workflowValidForBlocks))
	const balance = await exactAttestedEthBalance(environment, environment.sender, anchor)
	assertPreviewSafety(() => assertOperationEthFunding(plan, balance, environment.settings.strategy))
	const step = plan.steps[0]
	if (step === undefined) return
	await assertFreshWalletAssetDebits(environment, step, anchor)
	await assertStepPreflightCalls(environment, step, anchor)
	const gasEstimate = await rediscoverableSimulationAndGas(environment, step, anchor)
	assertPreviewSafety(() => assertStepSafety({ baseFeePerGas: anchor.baseFeePerGas, ethBalanceAttoEth: balance, gasEstimate, step, strategy: environment.settings.strategy }))
}
