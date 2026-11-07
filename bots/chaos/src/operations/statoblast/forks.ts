import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions } from '../types.ts'
import { choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { securityPoolAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import { BINARY_OUTCOME_NONE, childRouteTopologyCapacityBlocker } from './planning.ts'

export const resumeEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const pool = choose(
			snapshot.pools.filter(candidate => candidate.awaitingForkContinuation && candidate.systemState === 0 && candidate.escalationGame !== zeroAddress && candidate.escalationForkCarryFundingComplete && candidate.escalationForkResumedAt === '0'),
			mixSeed(options.seed, resumeEscalation.id),
		)
		if (pool === undefined) return undefined
		return planBase({
			definitionId: resumeEscalation.id,
			ecosystem: 'statoblast',
			label: resumeEscalation.label,
			metadata: { pool: pool.address },
			postconditions: ['Forked escalation game records its resumption time'],
			priority: 'urgent',
			risk: 'low',
			snapshot,
			steps: [encodeStep({ abi: securityPoolAbi, evidence: [eventEvidence(pool.escalationGame, 'ForkContinuationResumed(uint256)')], functionName: 'resumeForkedEscalationGame', id: 'resume-escalation', label: 'Resume forked escalation game', to: pool.address })],
		})
	},
	buildLifecyclePlans(snapshot) {
		return snapshot.pools
			.filter(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkCarryFundingComplete && pool.escalationForkResumedAt === '0')
			.map(pool =>
				planBase({
					definitionId: resumeEscalation.id,
					ecosystem: 'statoblast',
					label: resumeEscalation.label,
					metadata: { pool: pool.address },
					postconditions: ['Forked escalation game records its resumption time'],
					priority: 'urgent',
					risk: 'low',
					snapshot,
					steps: [encodeStep({ abi: securityPoolAbi, evidence: [eventEvidence(pool.escalationGame, 'ForkContinuationResumed(uint256)')], functionName: 'resumeForkedEscalationGame', id: 'resume-escalation', label: 'Resume forked escalation game', to: pool.address })],
				}),
			)
	},
	enumerateLifecycleObstructingPresence(snapshot) {
		return snapshot.pools.filter(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkCarryFundingComplete && pool.escalationForkResumedAt === '0').map(pool => ({ pool: pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return snapshot.pools.filter(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkResumedAt === '0').map(pool => ({ pool: pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPool',
	description: 'Permissionlessly resumes a child escalation game after its fork continuation is initialized.',
	discoveryInputs: ['pool fork continuation flag/state', 'child escalation game'],
	ecosystem: 'statoblast',
	evaluate: snapshot => eligible(snapshot.pools.some(pool => pool.awaitingForkContinuation && pool.systemState === 0 && pool.escalationGame !== zeroAddress && pool.escalationForkCarryFundingComplete && pool.escalationForkResumedAt === '0') ? undefined : 'No fully funded child escalation game is waiting to resume'),
	id: 'statoblast.escalation.resume',
	label: 'Resume forked escalation game',
	method: 'resumeForkedEscalationGame',
	risk: 'low',
}

export function forkDefinition(kind: 'initiate' | 'create-child' | 'own-question'): OperationDefinition {
	const id = `statoblast.fork.${kind}`
	const method = { initiate: 'initiateSecurityPoolFork', 'own-question': 'forkZoltarWithOwnEscalationGame', 'create-child': 'preparePortfolioQuestion' }[kind]
	const label = `Portfolio question fork: ${kind}`
	function candidates(snapshot: EcosystemSnapshot, options?: PlanningOptions) {
		return snapshot.pools.flatMap(pool => {
			const universe = snapshot.universes.find(universe => universe.id === pool.universeId)
			if (universe === undefined) return []
			if (kind === 'initiate') return universe.forkTime !== '0' && pool.systemState === 0 && pool.questionOutcome === BINARY_OUTCOME_NONE ? [{ pool, outcome: '0', targetUniverse: '0' }] : []
			if (kind === 'own-question') return pool.ownQuestionForkReady ? [{ pool, outcome: '0', targetUniverse: '0' }] : []
			if (pool.systemState !== 1 || universe.forkTime === '0') return []
			return Object.entries(pool.childPoolPreparations).flatMap(([outcome, preparation]) =>
				(options === undefined || preparation.branchReady) && preparation.childPool === zeroAddress && (options === undefined || childRouteTopologyCapacityBlocker(snapshot, pool, outcome, options, 'Portfolio question materialization') === undefined)
					? [{ pool, outcome, targetUniverse: preparation.childUniverseId }]
					: [],
			)
		})
	}
	const metadata = (candidate: ReturnType<typeof candidates>[number]) => ({ pool: candidate.pool.address, outcome: candidate.outcome })
	function build(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof candidates>[number]) {
		const evidence: OperationEvidence[] =
			kind === 'create-child'
				? [{ kind: 'storage-postcondition', contract: candidate.pool.portfolio, abi: 'function getPool(uint256,uint248) view returns (address)', functionName: 'getPool', args: [candidate.pool.questionId, candidate.targetUniverse], relation: 'greater-than', expected: '0' }]
				: [{ kind: 'storage-postcondition', contract: candidate.pool.address, abi: 'function systemState() view returns (uint8)', functionName: 'systemState', args: [], relation: 'equals', expected: '1' }]

		return planBase({
			definitionId: id,
			ecosystem: 'statoblast',
			label,
			metadata: metadata(candidate),
			postconditions: [label],
			priority: kind === 'create-child' ? 'urgent' : 'random',
			risk: 'irreversible',
			snapshot,
			steps: [encodeStep({ abi: securityPoolForkerAbi, evidence, args: kind === 'create-child' ? [candidate.pool.address, BigInt(candidate.targetUniverse)] : [candidate.pool.address], functionName: method, id: method, label, to: snapshot.deployments.securityPoolForker, gasLimit: 16_777_216n })],
		})
	}
	return {
		id,
		label,
		method,
		contract: 'SecurityPoolForker',
		classification: kind === 'create-child' ? 'lifecycle-obligation' : 'selectable',
		ecosystem: 'statoblast',
		risk: 'irreversible',
		description: 'Advances native portfolio question fork reporting and lazy child preparation.',
		discoveryInputs: ['native question state', 'universe fork', 'shared branch readiness'],
		evaluate: (snapshot, options) => eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations disabled', candidates(snapshot, options).length > 0 ? undefined : 'No eligible question fork route'),
		buildPlan(snapshot, options) {
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return candidate === undefined ? undefined : build(snapshot, candidate)
		},
		buildLifecyclePlans: (snapshot, options) => (kind === 'create-child' ? candidates(snapshot, options).map(candidate => build(snapshot, candidate)) : []),
		enumerateLifecyclePresence: snapshot => (kind === 'create-child' ? candidates(snapshot).map(metadata) : []),
		enumerateLifecycleObstructingPresence: (snapshot, options) => (kind === 'create-child' ? candidates(snapshot, options).map(metadata) : []),
	}
}
