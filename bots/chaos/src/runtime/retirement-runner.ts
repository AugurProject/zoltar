import type { Address } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../config/settings.ts'
import type { OperationPlan } from '../operations/types.ts'
import { evaluateOperationCatalog } from '../operations/catalog.ts'
import type { DurableWorkflow, RuntimeState } from '../state/operator-state.ts'
import { chaosReadClients, planningOptions, type CanonicalAnchor, type CanonicalScanResult } from './canonical-scan.ts'
import { applyRetirementAssessment, assessRetirement, buildV3RetirementPlan, readV3Position, readV3PositionsWithQuorum, reconcileV3PositionJournal, type V3PositionObservation } from './retirement.ts'
import { recordCanonicalRecoveredBalances } from './retirement-balance-evidence.ts'
import { retirementCleanupBlocker } from './workflows.ts'

type RetirementScan = Pick<CanonicalScanResult, 'anchor' | 'executionReady' | 'canonicalLifecyclePresenceComplete' | 'carryProofsComplete' | 'indexComplete' | 'snapshot'>

export function enforceRetirementContinuation(state: RuntimeState, workflow: DurableWorkflow, hasCanonicalContinuation: boolean, operationAllowed: boolean) {
	if (state.retirement.status === 'inactive' || operationAllowed) return true
	const blocker = retirementCleanupBlocker(workflow, hasCanonicalContinuation)
	if (blocker === undefined) return true
	state.retirement.status = 'blocked'
	state.retirement.blockers = [{ category: 'operator-action', details: blocker, id: workflow.id }]
	return false
}

function retirementEvaluationsForScan(scan: RetirementScan, settings: OperatorSettings, state: RuntimeState) {
	return evaluateOperationCatalog(scan.snapshot, {
		...planningOptions(settings, 0),
		allowHighRisk: true,
		allowIrreversibleOperations: state.retirement.policies.migrateExistingClaims,
		seed: 0,
	})
}

export function updateRetirementAssessment(scan: RetirementScan, settings: OperatorSettings, state: RuntimeState, v3: readonly V3PositionObservation[]) {
	if (state.retirement.status === 'inactive') return undefined
	state.evaluations = retirementEvaluationsForScan(scan, settings, state)
	const canonicalScanComplete = scan.canonicalLifecyclePresenceComplete && scan.carryProofsComplete && scan.indexComplete
	if (scan.executionReady) recordCanonicalRecoveredBalances(state.retirement, scan.snapshot)
	const assessment = assessRetirement({
		blockHash: scan.anchor.blockHash,
		blockNumber: scan.anchor.blockNumber,
		evaluations: state.evaluations,
		retirement: state.retirement,
		planning: { ...planningOptions(settings, 0), allowHighRisk: true, allowIrreversibleOperations: state.retirement.policies.migrateExistingClaims, seed: 0 },
		snapshot: scan.snapshot,
		state,
		v3,
		canonicalScanComplete,
		executionReady: scan.executionReady,
		sweepLimits: { maximumEthAttoEth: settings.strategy.maximumEthPerOperationAttoEth, maximumGasCostAttoEth: settings.strategy.maximumGasCostAttoEth, maximumRepAttoRep: settings.strategy.maximumRepPerOperationAttoRep, minimumEthReserveAttoEth: settings.strategy.minimumEthReserveAttoEth },
	})
	applyRetirementAssessment(state.retirement, assessment, scan.anchor.blockHash, scan.anchor.blockNumber, { profileId: state.profileId, scannedWallet: scan.snapshot.wallet.address, signerAddress: state.signerAddress })
	state.scheduler.status = 'paused'
	return assessment
}

export function updateV3PositionStatus(observation: V3PositionObservation, blockNumber: bigint) {
	observation.position.lastCheckedAtBlock = blockNumber.toString()
	if (observation.liquidity > 0n) observation.position.status = 'active'
	else if (observation.tokensOwed0 > 0n || observation.tokensOwed1 > 0n) observation.position.status = 'collect-only'
	else if (observation.position.status !== 'pending-confirmation' || (observation.position.registeredBy === 'workflow' && observation.position.creationTransactionHash !== undefined)) observation.position.status = 'closed'
}

export function recordV3ScanFailure(state: RuntimeState, position: RuntimeState['retirement']['positions'][number], error: unknown) {
	if (position.status !== 'pending-confirmation') position.status = 'blocked'
	const details = error instanceof Error ? error.message : String(error)
	state.retirement.blockers = [...state.retirement.blockers.filter(blocker => blocker.id !== position.id), { category: 'ambiguous-position', details, id: position.id }]
}

export function recordV3ScanSuccess(state: RuntimeState, observation: V3PositionObservation, blockNumber: bigint) {
	state.retirement.blockers = state.retirement.blockers.filter(blocker => blocker.id !== observation.position.id)
	updateV3PositionStatus(observation, blockNumber)
}

export async function retirementPositionsForScan(parameters: { anchor: Pick<CanonicalAnchor, 'blockHash' | 'blockNumber'>; pool: Parameters<typeof chaosReadClients>[1]; profileId: string; settings: OperatorSettings; state: RuntimeState; wallet: Address | undefined }) {
	const { anchor, pool, profileId, settings, state, wallet } = parameters
	if (wallet !== undefined) reconcileV3PositionJournal(state.retirement, state.workflows, profileId, wallet)
	if (state.retirement.status === 'inactive' || state.retirement.positions.length === 0) return []
	if (settings.connectivity === undefined) throw new Error('Retirement V3 scan requires configured RPC connectivity')
	const readers = chaosReadClients(settings, pool).map(candidate => (position: Parameters<typeof readV3Position>[1], positionAnchor: Parameters<typeof readV3Position>[2]) => readV3Position(candidate.client, position, positionAnchor))
	const observations: V3PositionObservation[] = []
	for (const position of state.retirement.positions) {
		try {
			const positionObservations = await readV3PositionsWithQuorum(readers, settings.connectivity.rpcQuorum, [position], anchor)
			for (const observation of positionObservations) recordV3ScanSuccess(state, observation, anchor.blockNumber)
			observations.push(...positionObservations)
		} catch (error) {
			recordV3ScanFailure(state, position, error)
		}
	}
	return observations
}

export async function processRetirementCycle(parameters: { execute: (plan: OperationPlan) => Promise<void>; persist: () => Promise<void>; prepareExecution: () => Promise<void>; scan: RetirementScan; settings: OperatorSettings; state: RuntimeState; v3: readonly V3PositionObservation[] }) {
	const { scan, settings, state } = parameters
	if (state.retirement.status === 'inactive') return undefined
	const assessment = updateRetirementAssessment(scan, settings, state, parameters.v3)
	if (assessment === undefined) throw new Error('Active retirement did not produce an assessment')
	await parameters.persist()
	if (!scan.executionReady || state.paused || !settings.runtime.execute || assessment.action === undefined) {
		return settings.runtime.once || (state.retirement.policies.exitAfterCompletion && (state.retirement.status === 'drained' || state.retirement.status === 'drained-with-residuals'))
	}
	await parameters.prepareExecution()
	const plan = assessment.action.kind === 'existing-plan' ? assessment.action.plan : buildV3RetirementPlan(scan.snapshot, assessment.action.observation, 0)
	if (plan.definitionId.startsWith('retirement.sweep.') && state.retirement.finalSweepStartedAt === undefined) {
		state.retirement.finalSweepStartedAt = new Date().toISOString()
		await parameters.persist()
	}
	await parameters.execute(plan)
	return settings.runtime.once
}
