import type { EcosystemSnapshot, EvaluatedOperation } from '../operations/types.ts'
import { recordActivity, type DurableWorkflow, type RuntimeState } from '../state/operator-state.ts'
import { uniswapV3PositionKey } from '../state/retirement.ts'
import { durableWorkflowPlan } from './workflows.ts'
import { buildV3RetirementPlan } from './retirement-v3-positions.ts'
import type { V3PositionObservation } from './retirement-types.ts'

export const V3_RETIREMENT_OPERATION = 'retirement.uniswap-v3.drain-position'

export type RetirementContinuationContext = { state: RuntimeState; observations: readonly V3PositionObservation[] }

/** Observations must come from the current agreed scan, after receipt/reorg recovery. */
export function evaluateV3RetirementContinuation(snapshot: EcosystemSnapshot, workflow: DurableWorkflow, context: RetirementContinuationContext): EvaluatedOperation {
	const { state, observations } = context
	const definition = { id: V3_RETIREMENT_OPERATION, classification: workflow.classification, contract: 'UniswapV3Pool', description: 'Recover the exact durable retirement position', discoveryInputs: [], ecosystem: workflow.ecosystem, label: workflow.label, method: 'collect', risk: workflow.risk }
	const blocked = (reason: string): EvaluatedOperation => ({ definition, eligibility: { eligible: false, blockers: [reason] } })
	if (workflow.operationId !== V3_RETIREMENT_OPERATION) return blocked('Unsupported retirement continuation')
	if (state.pendingTransactions.length !== 0 || state.rollbackQueue.length !== 0 || workflow.steps.some(step => step.status === 'signed' || step.status === 'submitted')) return blocked('Resolve pending transaction and reorg recovery before retirement continuation')
	const observation = observations.find(candidate => candidate.position.id === workflow.metadata['positionId'])
	if (observation === undefined) return blocked('The exact retirement position requires a current canonical quorum observation')
	const { position } = observation
	if (
		snapshot.chainId !== state.chainId ||
		!state.retirement.positions.includes(position) ||
		position.profileId !== state.profileId ||
		position.owner.toLowerCase() !== state.signerAddress?.toLowerCase() ||
		position.owner.toLowerCase() !== snapshot.wallet.address.toLowerCase() ||
		position.pool !== workflow.metadata['pool'] ||
		position.positionKey !== workflow.metadata['positionKey'] ||
		position.positionKey.toLowerCase() !== uniswapV3PositionKey(position.owner, position.tickLower, position.tickUpper).toLowerCase()
	)
		return blocked('Retirement continuation profile, signer, pool or position identity changed')
	const burn = workflow.steps.find(step => step.id === 'burn-full-v3-position')
	if (burn?.status !== 'confirmed' || burn.transactionHash === undefined || workflow.steps.some(step => step.id !== 'burn-full-v3-position' && step.id !== 'collect-full-v3-position')) return blocked('Retirement continuation requires confirmed burn provenance')
	if (observation.liquidity !== 0n) return blocked('Canonical position still has liquidity after confirmed burn; reconcile its receipt before continuing')
	const closed = observation.tokensOwed0 === 0n && observation.tokensOwed1 === 0n
	const plan = closed ? { ...durableWorkflowPlan(workflow), createdAtBlock: snapshot.anchor.blockNumber, steps: [] } : buildV3RetirementPlan(snapshot, observation, workflow.planningSeed)
	return { definition, eligibility: { eligible: true, blockers: [] }, plan: { ...plan, continuationDisposition: 'cleanup-only' } }
}

export function reconcileClosedV3RetirementWorkflow(snapshot: EcosystemSnapshot, workflow: DurableWorkflow, context: RetirementContinuationContext) {
	const evaluation = evaluateV3RetirementContinuation(snapshot, workflow, context)
	if (!evaluation.eligibility.eligible || evaluation.plan?.steps.length !== 0) throw new Error('Retirement completion requires verified zero position balances')
	// Preserve transaction history without inventing a receipt for the unneeded collect.
	workflow.status = 'completed'
	workflow.completedAt = new Date().toISOString()
	workflow.updatedAt = workflow.completedAt
	recordActivity(context.state, { type: 'recovery', status: 'info', operationId: workflow.operationId, message: `Retirement workflow ${workflow.id} reconciled: zero liquidity and owed tokens at ${snapshot.anchor.blockNumber} (${snapshot.anchor.blockHash})` })
}
