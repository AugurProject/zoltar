import type { Address } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../config/settings.ts'
import { randomInteger } from '../core/random.ts'
import type { OperationPlan } from '../operations/types.ts'
import type { RuntimeState } from '../state/operator-state.ts'
import { chaosReadClients, planningOptions, type CanonicalScanResult } from './canonical-scan.ts'
import { applyRetirementAssessment, assessRetirement, buildV3RetirementPlan, readV3Position, readV3PositionsWithQuorum, reconcileV3PositionJournal, recordCanonicalRecoveredBalances, type V3PositionObservation } from './retirement.ts'

export async function retirementPositionsForScan(parameters: { blockNumber: bigint; pool: Parameters<typeof chaosReadClients>[1]; profileId: string; settings: OperatorSettings; state: RuntimeState; wallet: Address | undefined }) {
	const { blockNumber, pool, profileId, settings, state, wallet } = parameters
	if (wallet !== undefined) reconcileV3PositionJournal(state.retirement, state.workflows, profileId, wallet)
	if (state.retirement.status === 'inactive' || state.retirement.positions.length === 0) return []
	if (settings.connectivity === undefined) throw new Error('Retirement V3 scan requires configured RPC connectivity')
	const observations = await readV3PositionsWithQuorum(
		chaosReadClients(settings, pool).map(candidate => (position, anchor) => readV3Position(candidate.client, position, anchor)),
		settings.connectivity.rpcQuorum,
		state.retirement.positions,
		blockNumber,
	)
	for (const observation of observations) {
		observation.position.lastCheckedAtBlock = blockNumber.toString()
		if (observation.liquidity > 0n) observation.position.status = 'active'
		else if (observation.tokensOwed0 > 0n || observation.tokensOwed1 > 0n) observation.position.status = 'collect-only'
		else observation.position.status = 'closed'
	}
	return observations
}

export async function processRetirementCycle(parameters: { execute: (plan: OperationPlan) => Promise<void>; persist: () => Promise<void>; prepareExecution: () => Promise<void>; scan: CanonicalScanResult; settings: OperatorSettings; state: RuntimeState; v3: readonly V3PositionObservation[] }) {
	const { scan, settings, state } = parameters
	if (state.retirement.status === 'inactive') return undefined
	recordCanonicalRecoveredBalances(state.retirement, scan.snapshot)
	const assessment = assessRetirement({
		blockHash: scan.anchor.blockHash,
		blockNumber: scan.anchor.blockNumber,
		evaluations: state.evaluations,
		retirement: state.retirement,
		planning: planningOptions(settings, Number(scan.anchor.blockNumber & 0xffff_ffffn)),
		snapshot: scan.snapshot,
		state,
		v3: parameters.v3,
		canonicalScanComplete: scan.canonicalLifecyclePresenceComplete && scan.carryProofJournalComplete && scan.indexComplete,
		sweepLimits: {
			maximumEthAttoEth: settings.strategy.maximumEthPerOperationAttoEth,
			maximumRepAttoRep: settings.strategy.maximumRepPerOperationAttoRep,
			minimumEthReserveAttoEth: settings.strategy.minimumEthReserveAttoEth,
		},
	})
	applyRetirementAssessment(state.retirement, assessment, scan.anchor.blockHash, scan.anchor.blockNumber)
	state.scheduler.status = 'paused'
	await parameters.persist()
	if (state.paused || !settings.runtime.execute || assessment.action === undefined) {
		return settings.runtime.once || (state.retirement.policies.exitAfterCompletion && (state.retirement.status === 'drained' || state.retirement.status === 'drained-with-residuals'))
	}
	await parameters.prepareExecution()
	const plan = assessment.action.kind === 'existing-plan' ? assessment.action.plan : buildV3RetirementPlan(scan.snapshot, assessment.action.observation, randomInteger(0, 0x1_0000_0000))
	if (plan.definitionId.startsWith('retirement.sweep.') && state.retirement.finalSweepStartedAt === undefined) {
		state.retirement.finalSweepStartedAt = new Date().toISOString()
		await parameters.persist()
	}
	await parameters.execute(plan)
	return settings.runtime.once
}
