import { securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { choose, eligible, encodeStep, mixSeed, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence } from '../types.ts'

/** Registered child histories can finish after migration closes; no owner funds move. */
const initializationCandidates = (snapshot: EcosystemSnapshot, actionable = true) =>
	snapshot.pools.flatMap(pool =>
		Object.entries(pool.childPoolPreparations)
			.filter(([, preparation]) => preparation.childPool !== zeroAddress && !preparation.historyReady && (!actionable || preparation.branchReady))
			.map(([outcome, preparation]) => ({ pool, outcome, preparation })),
	)

const initializationMetadata = (candidate: ReturnType<typeof initializationCandidates>[number]) => ({ pool: candidate.pool.address, outcome: candidate.outcome, initialized: candidate.preparation.historyOutcomesInitialized })

function initializationEvidence(candidate: ReturnType<typeof initializationCandidates>[number]): OperationEvidence[] {
	const { preparation } = candidate
	if (preparation.portfolio !== zeroAddress && preparation.sourceGame === zeroAddress) return [{ kind: 'storage-postcondition', contract: preparation.childPool, abi: 'function systemState() view returns (uint8)', functionName: 'systemState', args: [], relation: 'equals', expected: '0' }]
	if (preparation.portfolio !== zeroAddress && preparation.game === zeroAddress) return [{ kind: 'storage-postcondition', contract: preparation.childPool, abi: 'function escalationGame() view returns (address)', functionName: 'escalationGame', args: [], relation: 'greater-than', expected: '0' }]
	return [{ kind: 'storage-postcondition', contract: preparation.game, abi: 'function forkCarrySnapshotOutcomesInitialized() view returns (uint8)', functionName: 'forkCarrySnapshotOutcomesInitialized', args: [], relation: 'greater-than', expected: preparation.historyOutcomesInitialized.toString() }]
}

function initializationPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof initializationCandidates>[number]) {
	return planBase({
		definitionId: initializeChildHistory.id,
		ecosystem: 'statoblast',
		label: initializeChildHistory.label,
		metadata: initializationMetadata(candidate),
		priority: 'urgent',
		risk: 'low',
		snapshot,
		postconditions: ['The next bounded child-history outcome is initialized without extending any migration window'],
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				functionName: 'materializePortfolioQuestion',
				args: [candidate.preparation.sourcePool, BigInt(candidate.preparation.childUniverseId)],
				to: snapshot.deployments.securityPoolForker,
				id: 'initialize-child-history',
				label: 'Initialize one child history outcome',
				gasLimit: 16_777_216n,
				evidence: initializationEvidence(candidate),
			}),
		],
	})
}

export const initializeChildHistory: OperationDefinition = {
	id: 'statoblast.child.initialize-history',
	method: 'materializePortfolioQuestion',
	label: 'Initialize child dispute history',
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	ecosystem: 'statoblast',
	risk: 'low',
	description: 'Permissionlessly initializes one inherited outcome for a registered child, including after the migration deadline.',
	discoveryInputs: ['canonical child registration', 'child history progress'],
	buildPlan(snapshot, options) {
		const candidate = choose(initializationCandidates(snapshot), mixSeed(options.seed, initializeChildHistory.id))
		return candidate === undefined ? undefined : initializationPlan(snapshot, candidate)
	},
	buildLifecyclePlans: snapshot => initializationCandidates(snapshot).map(candidate => initializationPlan(snapshot, candidate)),
	enumerateLifecyclePresence: snapshot => initializationCandidates(snapshot, false).map(initializationMetadata),
	enumerateLifecycleObstructingPresence: snapshot => initializationCandidates(snapshot).map(initializationMetadata),
	evaluate: snapshot => eligible(initializationCandidates(snapshot).length > 0 ? undefined : 'No registered child has pending history initialization'),
}
