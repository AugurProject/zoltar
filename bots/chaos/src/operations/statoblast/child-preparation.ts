import { securityPoolFactoryAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { choose, eligible, encodeStep, mixSeed, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationEvidence, OperationStep, PoolSnapshot } from '../types.ts'

export function childPreparationCount(pool: PoolSnapshot, outcome: string) {
	const preparation = pool.childPoolPreparations[outcome]
	return preparation === undefined ? 0 : Number(preparation.feedRequired) + Number(preparation.dependenciesRequired)
}

/** Canonical discovery records every eligible fork route; a missing ledger waits for create-child's lifecycle plan. */
export function childLedgerNeedsPreparation(pool: PoolSnapshot, outcome: string) {
	const preparation = pool.childPoolPreparations[outcome]
	return preparation !== undefined && (preparation.childPool === zeroAddress || !preparation.historyReady)
}

export function childPreparationSteps(snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string): OperationStep[] {
	const preparation = pool.childPoolPreparations[outcome]
	if (preparation === undefined) return []
	const factory = snapshot.deployments.securityPoolFactory
	const steps: OperationStep[] = []
	const present = (abi: string, functionName: string, args: string[]): OperationEvidence => ({ kind: 'storage-postcondition', contract: factory, abi, functionName, args, relation: 'greater-than', expected: '0' })
	if (preparation.feedRequired)
		steps.push(
			encodeStep({
				abi: securityPoolFactoryAbi,
				functionName: 'preparePortfolioChildPriceFeed',
				args: [pool.address, BigInt(outcome)],
				to: factory,
				id: `prepare-child-feed-${outcome}`,
				label: 'Prepare child pool shared price feed',
				evidence: [present('function sharedPriceFeeds(address,uint248) view returns (address)', 'sharedPriceFeeds', [preparation.portfolio, preparation.childUniverseId])],
			}),
		)
	if (preparation.dependenciesRequired)
		steps.push(
			encodeStep({
				abi: securityPoolFactoryAbi,
				functionName: 'prepareChildPoolDependencies',
				args: [pool.address, BigInt(outcome)],
				to: factory,
				id: `prepare-child-contracts-${outcome}`,
				label: 'Prepare child coordinator and auction',
				// Check the first returned dependency: factory installs coordinator and auction atomically.
				evidence: [present('function getChildPoolDependencies(address,uint256) view returns (address,address)', 'getChildPoolDependencies', [pool.address, outcome])],
			}),
		)
	return steps
}

export const CHILD_PREPARATION_OPERATIONS: OperationDefinition[] = [
	{ id: 'statoblast.child.prepare-feed', method: 'preparePortfolioChildPriceFeed', label: 'Prepare shared child feed' },
	{ id: 'statoblast.child.prepare-contracts', method: 'prepareChildPoolDependencies', label: 'Prepare child pool contracts' },
].map(definition => ({
	...definition,
	buildPlan: () => undefined,
	classification: 'prerequisite',
	contract: 'SecurityPoolFactory',
	description: 'Permissionless canonical deployment preparation composed into child creation before any owner migration.',
	discoveryInputs: ['factory child dependencies', 'shared universe feed'],
	ecosystem: 'statoblast',
	evaluate: () => ({ eligible: false, blockers: ['Included in child pool creation plans'] }),
	risk: 'low',
}))

/** Registered child histories can finish after migration closes; no owner funds move. */
const initializationCandidates = (snapshot: EcosystemSnapshot) =>
	snapshot.pools.flatMap(pool =>
		Object.entries(pool.childPoolPreparations)
			.filter(([, preparation]) => preparation.childPool !== zeroAddress && !preparation.historyReady)
			.map(([outcome, preparation]) => ({ pool, outcome, preparation })),
	)

const initializationMetadata = (candidate: ReturnType<typeof initializationCandidates>[number]) => ({ pool: candidate.pool.address, outcome: candidate.outcome, initialized: candidate.preparation.historyOutcomesInitialized })

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
				functionName: 'continueChildUniverse',
				args: [candidate.pool.address, BigInt(candidate.outcome)],
				to: snapshot.deployments.securityPoolForker,
				id: 'initialize-child-history',
				label: 'Initialize one child history outcome',
				evidence: [
					{ kind: 'storage-postcondition', contract: candidate.preparation.game, abi: 'function forkCarrySnapshotOutcomesInitialized() view returns (uint8)', functionName: 'forkCarrySnapshotOutcomesInitialized', args: [], relation: 'greater-than', expected: candidate.preparation.historyOutcomesInitialized.toString() },
				],
			}),
		],
	})
}

export const initializeChildHistory: OperationDefinition = {
	id: 'statoblast.child.initialize-history',
	method: 'continueChildUniverse',
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
	enumerateLifecyclePresence: snapshot => initializationCandidates(snapshot).map(initializationMetadata),
	enumerateLifecycleObstructingPresence: snapshot => initializationCandidates(snapshot).map(initializationMetadata),
	evaluate: snapshot => eligible(initializationCandidates(snapshot).length > 0 ? undefined : 'No registered child has pending history initialization'),
}
