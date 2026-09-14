import { EcosystemSnapshot, OperationDefinition, OperationEvidence, PlanningOptions, PoolSnapshot } from '../types.ts'

import { amount, choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'

import { type AbiValue, zeroAddress } from '@zoltar/bot-shared/ethereum'

import { securityPoolAbi, securityPoolForkerAbi } from '@zoltar/bot-shared/contracts/abi'

import { BINARY_OUTCOME_NONE, MIGRATION_TIME_SECONDS, childPoolForOutcome, childRouteTopologyCapacityBlocker, childUniverseTopologyCapacityBlocker, compareDecimalStrings, decodedChildRepSplitEvidence, decodedVaultMigrationEvidence, forkOutcomesForPool, lifecycleBatches, walletVault } from './planning.ts'

import { timestampDeadlineHasRequiredSafety } from '../timing.ts'

import { walletVaultMigrationRouteCapacityBlocker } from './vaults.ts'

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

function claimForkedEscalationCandidates(snapshot: EcosystemSnapshot, options?: PlanningOptions, enforceTopologyCapacity = options !== undefined) {
	const now = amount(snapshot.anchor.timestamp)
	const candidates = snapshot.pools.flatMap(pool => {
		const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		const deadlineAvailable = options === undefined ? now <= deadline : timestampDeadlineHasRequiredSafety(now, deadline, options)
		if (pool.systemState !== 1 || !pool.forkOwnQuestion || !pool.forkUnresolvedEscalation || !pool.escalationCanTriggerOwnFork || amount(pool.forkActivationTime) === 0n || !deadlineAvailable) return []
		const deposits = snapshot.escalationDeposits.filter(deposit => !deposit.claimed && deposit.pool.toLowerCase() === pool.address.toLowerCase() && deposit.vault.toLowerCase() === snapshot.wallet.address.toLowerCase()).sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex))
		return [...new Set(deposits.map(deposit => deposit.outcome))].flatMap(outcome => lifecycleBatches(deposits.filter(deposit => deposit.outcome === outcome)).map(batch => ({ deadline, deposits: batch, outcome, pool })))
	})
	return enforceTopologyCapacity && options !== undefined ? candidates.filter(candidate => childRouteTopologyCapacityBlocker(snapshot, candidate.pool, candidate.outcome.toString(), options, 'Forked escalation claim child route') === undefined) : candidates
}

function claimForkedDepositIndexes(candidate: ReturnType<typeof claimForkedEscalationCandidates>[number]) {
	return [...candidate.deposits].sort((left, right) => compareDecimalStrings(left.depositIndex, right.depositIndex)).map(deposit => BigInt(deposit.depositIndex))
}

function claimForkedMetadata(candidate: ReturnType<typeof claimForkedEscalationCandidates>[number]) {
	const depositIndexes = claimForkedDepositIndexes(candidate)
	return { depositCount: depositIndexes.length, depositIndexes: depositIndexes.map(index => index.toString()).join(','), outcome: candidate.outcome, pool: candidate.pool.address }
}

function buildClaimForkedEscalationPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof claimForkedEscalationCandidates>[number]) {
	const depositIndexes = claimForkedDepositIndexes(candidate)
	return planBase({
		deadlineTimestamp: candidate.deadline.toString(),
		definitionId: claimForkedEscalation.id,
		ecosystem: 'statoblast',
		label: claimForkedEscalation.label,
		metadata: claimForkedMetadata(candidate),
		postconditions: ['Selected fork-time deposits are claimed into the wallet and marked terminal by the canonical index'],
		priority: 'urgent',
		risk: 'low',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address, snapshot.wallet.address, candidate.outcome, depositIndexes],
				evidence: [eventEvidence(snapshot.deployments.securityPoolForker, 'ClaimForkedEscalationDepositsToWallet(address,address,uint8,uint256[],uint256,uint256,bool)')],
				functionName: 'claimForkedEscalationDeposits',
				id: 'claim-forked-escalation',
				label: 'Claim forked escalation deposits',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

export const claimForkedEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(claimForkedEscalationCandidates(snapshot, options), mixSeed(options.seed, claimForkedEscalation.id))
		return candidate === undefined ? undefined : buildClaimForkedEscalationPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return claimForkedEscalationCandidates(snapshot, options).map(candidate => buildClaimForkedEscalationPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot, options) {
		return claimForkedEscalationCandidates(snapshot, options, false).map(claimForkedMetadata)
	},
	enumerateLifecyclePresence(snapshot) {
		return claimForkedEscalationCandidates(snapshot).map(claimForkedMetadata)
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Claims canonically indexed wallet deposits during an own-question fork migration window.',
	discoveryInputs: ['canonical escalation deposit index', 'fork ownership/unresolved state', 'fork activation deadline'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const obstructing = claimForkedEscalationCandidates(snapshot, options, false)
		const actionable = claimForkedEscalationCandidates(snapshot, options)
		const first = obstructing[0]
		const capacityBlocker = first === undefined || actionable.length > 0 ? undefined : childRouteTopologyCapacityBlocker(snapshot, first.pool, first.outcome.toString(), options, 'Forked escalation claim child route')
		return eligible(capacityBlocker, obstructing.length > 0 ? undefined : 'No indexed own-fork escalation deposit is claimable before its migration deadline')
	},
	id: 'statoblast.escalation.claim-forked',
	label: 'Claim forked escalation deposits',
	method: 'claimForkedEscalationDeposits',
	risk: 'low',
}

function unresolvedMigrationCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.pools.flatMap(pool => {
		const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		const validOutcomes = new Set(forkOutcomesForPool(snapshot, pool))
		if (pool.systemState !== 1 || !pool.forkUnresolvedEscalation || validOutcomes.size === 0 || amount(pool.forkActivationTime) === 0n || !timestampDeadlineHasRequiredSafety(now, deadline, options)) return []
		return pool.unresolvedEscalationMigrationReadyOutcomes.flatMap(outcome => {
			const outcomeIndex = BigInt(outcome)
			const notMaterialized = outcomeIndex > 2n || pool.walletEscalationMaterializedOutcomes[Number(outcomeIndex)] === false
			return validOutcomes.has(outcome) && notMaterialized ? [{ deadline, outcome, pool }] : []
		})
	})
}

function actionableUnresolvedMigrationCandidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	return unresolvedMigrationCandidates(snapshot, options).filter(candidate => walletVaultMigrationRouteCapacityBlocker(snapshot, candidate.pool, candidate.outcome, options, 'Unresolved vault migration child route') === undefined)
}

function unresolvedMigrationPresenceCandidates(snapshot: EcosystemSnapshot) {
	const now = amount(snapshot.anchor.timestamp)
	return snapshot.pools.flatMap(pool => {
		const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
		if (pool.systemState !== 1 || !pool.forkUnresolvedEscalation || amount(pool.forkActivationTime) === 0n || now > deadline) return []
		return forkOutcomesForPool(snapshot, pool).flatMap(outcome => {
			const outcomeIndex = BigInt(outcome)
			const notMaterialized = outcomeIndex <= 2n ? pool.walletEscalationMaterializedOutcomes[Number(outcomeIndex)] === false : pool.unresolvedEscalationMigrationReadyOutcomes.includes(outcome)
			return notMaterialized ? [{ deadline, outcome, pool }] : []
		})
	})
}

function buildUnresolvedMigrationPlan(snapshot: EcosystemSnapshot, candidate: ReturnType<typeof unresolvedMigrationCandidates>[number]) {
	return planBase({
		deadlineTimestamp: candidate.deadline.toString(),
		definitionId: migrateVaultWithUnresolvedEscalation.id,
		ecosystem: 'statoblast',
		label: migrateVaultWithUnresolvedEscalation.label,
		metadata: { childOutcomeIndex: candidate.outcome, pool: candidate.pool.address },
		postconditions: ['The wallet escalation entitlement is initialized and materialized exactly once for the child outcome'],
		priority: 'urgent',
		risk: 'irreversible',
		snapshot,
		steps: [
			encodeStep({
				abi: securityPoolForkerAbi,
				args: [candidate.pool.address, snapshot.wallet.address, BigInt(candidate.outcome)],
				evidence: [eventEvidence(snapshot.deployments.securityPoolForker, 'EscalationMigrationEntitlementMaterialized(address,address,uint256,address,uint256)')],
				functionName: 'migrateVaultWithUnresolvedEscalation',
				id: 'migrate-unresolved-escalation',
				label: 'Materialize unresolved escalation entitlement',
				to: snapshot.deployments.securityPoolForker,
			}),
		],
	})
}

export const migrateVaultWithUnresolvedEscalation: OperationDefinition = {
	buildPlan(snapshot, options) {
		const candidate = choose(actionableUnresolvedMigrationCandidates(snapshot, options), mixSeed(options.seed, migrateVaultWithUnresolvedEscalation.id))
		return candidate === undefined ? undefined : buildUnresolvedMigrationPlan(snapshot, candidate)
	},
	buildLifecyclePlans(snapshot, options) {
		return actionableUnresolvedMigrationCandidates(snapshot, options).map(candidate => buildUnresolvedMigrationPlan(snapshot, candidate))
	},
	enumerateLifecycleObstructingPresence(snapshot, options) {
		return unresolvedMigrationCandidates(snapshot, options).map(candidate => ({ childOutcomeIndex: candidate.outcome, pool: candidate.pool.address }))
	},
	enumerateLifecyclePresence(snapshot) {
		return unresolvedMigrationPresenceCandidates(snapshot).map(candidate => ({ childOutcomeIndex: candidate.outcome, pool: candidate.pool.address }))
	},
	classification: 'lifecycle-obligation',
	contract: 'SecurityPoolForker',
	description: 'Materializes the wallet vault and unresolved escalation entitlement into an unmaterialized child outcome.',
	discoveryInputs: ['fork activation deadline', 'unresolved fork state', 'wallet entitlement materialization bitmap'],
	ecosystem: 'statoblast',
	evaluate(snapshot, options) {
		const obstructing = unresolvedMigrationCandidates(snapshot, options)
		const actionable = actionableUnresolvedMigrationCandidates(snapshot, options)
		const first = obstructing[0]
		const capacityBlocker = first === undefined || actionable.length > 0 ? undefined : walletVaultMigrationRouteCapacityBlocker(snapshot, first.pool, first.outcome, options, 'Unresolved vault migration child route')
		return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', capacityBlocker, obstructing.length > 0 ? undefined : 'No unresolved wallet escalation entitlement remains inside its migration window')
	},
	id: 'statoblast.fork.migrate-vault-unresolved',
	label: 'Migrate vault with unresolved escalation',
	method: 'migrateVaultWithUnresolvedEscalation',
	risk: 'irreversible',
}

export function forkDefinition(kind: 'initiate' | 'migrate-rep' | 'create-child' | 'migrate-vault' | 'own-question'): OperationDefinition {
	const details = {
		'create-child': ['createChildUniverse', 'statoblast.fork.create-child'],
		initiate: ['initiateSecurityPoolFork', 'statoblast.fork.initiate'],
		'migrate-rep': ['migrateRepToZoltar', 'statoblast.fork.migrate-rep'],
		'migrate-vault': ['migrateVault', 'statoblast.fork.migrate-vault'],
		'own-question': ['forkZoltarWithOwnEscalationGame', 'statoblast.fork.own-question'],
	} as const
	const [method, id] = details[kind]
	type ForkCandidate = { deadline: bigint | undefined; outcome: string; pool: PoolSnapshot }
	type VaultMigrationCandidate = { deadline: bigint; pool: PoolSnapshot; routes: string[] }
	const isOpenChildRoute = (snapshot: EcosystemSnapshot, pool: PoolSnapshot, outcome: string) => {
		const child = childPoolForOutcome(snapshot, pool, outcome)
		return child === undefined || child.systemState === 2
	}
	const migrateRepPresenceCandidates = (snapshot: EcosystemSnapshot): ForkCandidate[] =>
		snapshot.pools.flatMap(pool => {
			if (amount(pool.forkActivationTime) === 0n) return []
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			const target = amount(pool.forkRepMigrationTargetAttoRep)
			if (target === 0n) return []
			return forkOutcomesForPool(snapshot, pool).flatMap(outcome => {
				const progress = amount(pool.forkRepMigrationProgressByOutcome[outcome] ?? '0')
				return progress < target ? [{ deadline, outcome, pool }] : []
			})
		})
	const createChildPresenceCandidates = (snapshot: EcosystemSnapshot): ForkCandidate[] => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.pools.flatMap(pool => {
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			if (pool.systemState !== 1 || amount(pool.forkActivationTime) === 0n || now > deadline) return []
			const children = snapshot.pools.filter(child => child.parent.toLowerCase() === pool.address.toLowerCase())
			return forkOutcomesForPool(snapshot, pool)
				.filter(outcome => !children.some(child => child.forkOutcomeIndex === outcome))
				.map(outcome => ({ deadline, outcome, pool }))
		})
	}
	const vaultMigrationPresenceCandidates = (snapshot: EcosystemSnapshot) => {
		const now = amount(snapshot.anchor.timestamp)
		return snapshot.pools.flatMap(pool => {
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			const vault = walletVault(snapshot, pool)
			if (pool.systemState !== 1 || amount(pool.forkActivationTime) === 0n || now > deadline || forkOutcomesForPool(snapshot, pool).length === 0 || vault === undefined || amount(vault.repBackingUnits) === 0n) return []
			return [{ deadline, pool }]
		})
	}
	const vaultMigrationCandidates = (snapshot: EcosystemSnapshot, options: PlanningOptions, enforceCapacity = true): VaultMigrationCandidate[] => {
		const now = amount(snapshot.anchor.timestamp)
		return vaultMigrationPresenceCandidates(snapshot).flatMap(candidate => {
			if (!timestampDeadlineHasRequiredSafety(now, candidate.deadline, options)) return []
			const routes = forkOutcomesForPool(snapshot, candidate.pool).filter(outcome => isOpenChildRoute(snapshot, candidate.pool, outcome) && (!enforceCapacity || walletVaultMigrationRouteCapacityBlocker(snapshot, candidate.pool, outcome, options, 'Vault migration child route') === undefined))
			return routes.length === 0 ? [] : [{ ...candidate, routes }]
		})
	}
	const candidates = (snapshot: EcosystemSnapshot, options: PlanningOptions, enforceCapacity = true): ForkCandidate[] => {
		const now = amount(snapshot.anchor.timestamp)
		if (kind === 'migrate-rep') {
			return migrateRepPresenceCandidates(snapshot).filter(
				candidate =>
					candidate.pool.systemState === 1 &&
					candidate.deadline !== undefined &&
					timestampDeadlineHasRequiredSafety(now, candidate.deadline, options) &&
					isOpenChildRoute(snapshot, candidate.pool, candidate.outcome) &&
					(!enforceCapacity || childUniverseTopologyCapacityBlocker(snapshot, candidate.pool, candidate.outcome, options, 'Pool-held REP migration child universe') === undefined),
			)
		}
		if (kind === 'migrate-vault') return []
		return snapshot.pools.flatMap<ForkCandidate>(pool => {
			const universe = snapshot.universes.find(value => value.id === pool.universeId)
			const children = snapshot.pools.filter(child => child.parent.toLowerCase() === pool.address.toLowerCase())
			const forkOutcomes = forkOutcomesForPool(snapshot, pool)
			const missingChildOutcomes = forkOutcomes.filter(outcome => !children.some(candidate => candidate.forkOutcomeIndex === outcome))
			const deadline = amount(pool.forkActivationTime) + MIGRATION_TIME_SECONDS
			if (kind === 'initiate') return universe !== undefined && universe.forkTime !== '0' && pool.systemState === 0 && pool.forkActivationTime === '0' && pool.questionOutcome === BINARY_OUTCOME_NONE ? [{ deadline: undefined, outcome: '0', pool }] : []
			if (kind === 'own-question') {
				const forkThreshold = universe === undefined ? 0n : amount(universe.forkThresholdAttoRep)
				const forkBurnDivisor = universe?.forkBurnDivisor === undefined ? 0n : amount(universe.forkBurnDivisor)
				const gameRep = amount(pool.escalationRepBalanceAttoRep)
				return universe !== undefined &&
					forkBurnDivisor > 0n &&
					universe.forkTime === '0' &&
					pool.systemState === 0 &&
					pool.forkActivationTime === '0' &&
					pool.escalationGame !== zeroAddress &&
					pool.escalationCanTriggerOwnFork &&
					amount(pool.poolRepBalanceAttoRep) + gameRep >= forkThreshold &&
					gameRep >= forkThreshold / forkBurnDivisor
					? [{ deadline: undefined, outcome: '0', pool }]
					: []
			}
			if (kind === 'create-child' && forkOutcomes.length === 0) return []
			if (pool.systemState !== 1 || amount(pool.forkActivationTime) === 0n || !timestampDeadlineHasRequiredSafety(now, deadline, options)) return []
			return missingChildOutcomes.flatMap(outcome => (!enforceCapacity || childRouteTopologyCapacityBlocker(snapshot, pool, outcome, options, 'Child pool creation route') === undefined ? [{ deadline, outcome, pool }] : []))
		})
	}
	const candidateMetadata = (candidate: ForkCandidate): Record<string, string | number | boolean> => {
		const metadata: Record<string, string | number | boolean> = kind === 'migrate-vault' ? { pool: candidate.pool.address } : { outcome: candidate.outcome, pool: candidate.pool.address }
		if (kind === 'migrate-rep') metadata['targetAttoRep'] = candidate.pool.forkRepMigrationTargetAttoRep
		return metadata
	}
	const build = (snapshot: EcosystemSnapshot, candidate: ForkCandidate) => {
		const outcome = candidate.outcome
		let args: readonly AbiValue[] = [candidate.pool.address]
		if (kind === 'migrate-rep') args = [candidate.pool.address, [BigInt(outcome)]]
		else if (kind === 'create-child' || kind === 'migrate-vault') args = [candidate.pool.address, BigInt(outcome)]
		let evidence: OperationEvidence[]
		if (kind === 'initiate') evidence = [eventEvidence(candidate.pool.address, 'PoolForkModeActivated(uint256,uint256,uint8)')]
		else if (kind === 'create-child') evidence = [eventEvidence(snapshot.deployments.securityPoolForker, 'ChildPoolLinked(address,uint256,address,address)')]
		else if (kind === 'migrate-vault') {
			const child = childPoolForOutcome(snapshot, candidate.pool, outcome)
			evidence = [decodedVaultMigrationEvidence(snapshot, candidate.pool, 'outcomeIndex', outcome, child), decodedVaultMigrationEvidence(snapshot, candidate.pool, 'resultingParentRepBackingUnits', '0', child)]
		} else if (kind === 'own-question') evidence = [eventEvidence(snapshot.deployments.zoltar, 'UniverseForked(address,uint248,uint256,uint256,uint256,uint256,uint256)')]
		else evidence = [decodedChildRepSplitEvidence(snapshot, candidate.pool, outcome)]
		let postconditions = ['Fork workflow advances without violating canonical parent/child accounting']
		if (kind === 'migrate-vault') postconditions = [`The wallet source vault reaches zero backing on the canonical outcome ${outcome} child route`]
		if (kind === 'migrate-rep') postconditions = ['The next canonical scan confirms the indexed child REP split reached its immutable fork target, including when another keeper won the race']
		const plan = planBase({
			definitionId: id,
			ecosystem: 'statoblast',
			label: kind === 'migrate-vault' ? `Fork workflow: migrate-vault through outcome ${outcome}` : `Fork workflow: ${kind}`,
			metadata: candidateMetadata(candidate),
			postconditions,
			priority: candidate.deadline === undefined ? 'random' : 'urgent',
			risk: 'irreversible',
			snapshot,
			steps: [
				encodeStep({
					abi: securityPoolForkerAbi,
					args,
					evidence,
					functionName: method,
					id: kind === 'migrate-rep' || kind === 'migrate-vault' ? `${method}-${candidate.pool.address.toLowerCase()}-${outcome}` : method,
					label: kind === 'migrate-vault' ? `migrate-vault through outcome ${outcome}` : kind,
					to: snapshot.deployments.securityPoolForker,
				}),
			],
		})
		if (candidate.deadline !== undefined) plan.deadlineTimestamp = candidate.deadline.toString()
		return plan
	}
	let discoveryInputs = ['pool fork state', 'universe tree', 'wallet vault state']
	if (kind === 'migrate-vault') discoveryInputs = ['pool fork state', 'universe tree', 'wallet source-vault backing', 'existing canonical child route state']
	if (kind === 'migrate-rep') discoveryInputs = ['pool fork state', 'universe tree', 'canonical indexed child REP split progress']
	return {
		buildPlan(snapshot, options) {
			if (kind === 'migrate-vault') {
				const candidate = choose(vaultMigrationCandidates(snapshot, options), mixSeed(options.seed, id))
				if (candidate === undefined) return undefined
				const route = choose(candidate.routes, mixSeed(options.seed, `${id}:${candidate.pool.address.toLowerCase()}`))
				return route === undefined ? undefined : build(snapshot, { deadline: candidate.deadline, outcome: route, pool: candidate.pool })
			}
			const candidate = choose(candidates(snapshot, options), mixSeed(options.seed, id))
			return candidate === undefined ? undefined : build(snapshot, candidate)
		},
		buildLifecyclePlans(snapshot, options) {
			if (kind === 'migrate-vault') {
				return vaultMigrationCandidates(snapshot, options).flatMap(candidate => {
					const route = choose(candidate.routes, mixSeed(options.seed, `${id}:${candidate.pool.address.toLowerCase()}`))
					if (route === undefined) return []
					const plan = build(snapshot, { deadline: candidate.deadline, outcome: route, pool: candidate.pool })
					return plan === undefined ? [] : [plan]
				})
			}
			return candidates(snapshot, options).flatMap(candidate => {
				const plan = build(snapshot, candidate)
				return plan === undefined ? [] : [plan]
			})
		},
		enumerateLifecycleObstructingPresence(snapshot, options) {
			if (kind === 'migrate-vault') {
				return vaultMigrationCandidates(snapshot, options, false).flatMap(candidate => {
					const route = choose(candidate.routes, mixSeed(options.seed, `${id}:${candidate.pool.address.toLowerCase()}`))
					if (route === undefined) return []
					return [candidateMetadata({ deadline: candidate.deadline, outcome: route, pool: candidate.pool })]
				})
			}
			return candidates(snapshot, options, false).map(candidateMetadata)
		},
		enumerateLifecyclePresence(snapshot, options) {
			if (kind === 'migrate-rep') {
				return migrateRepPresenceCandidates(snapshot).map(candidate => ({ outcome: candidate.outcome, pool: candidate.pool.address, targetAttoRep: candidate.pool.forkRepMigrationTargetAttoRep }))
			}
			if (kind === 'migrate-vault') return vaultMigrationPresenceCandidates(snapshot).map(candidate => ({ pool: candidate.pool.address }))
			if (kind === 'create-child') return createChildPresenceCandidates(snapshot).map(candidate => ({ outcome: candidate.outcome, pool: candidate.pool.address }))
			return candidates(snapshot, options).flatMap(candidate => {
				const plan = build(snapshot, candidate)
				return plan === undefined ? [] : [plan.metadata]
			})
		},
		classification: kind === 'create-child' || kind === 'migrate-rep' || kind === 'migrate-vault' ? 'lifecycle-obligation' : 'selectable',
		contract: 'SecurityPoolForker',
		description: kind === 'migrate-vault' ? 'Migrates the wallet vault through one canonical child route and requires terminal zero source backing in the receipt.' : `Advances the permissionless ${kind} phase of pool fork migration.`,
		discoveryInputs,
		ecosystem: 'statoblast',
		evaluate(snapshot, options) {
			if (kind === 'migrate-vault') {
				const obstructing = vaultMigrationCandidates(snapshot, options, false)
				const actionable = vaultMigrationCandidates(snapshot, options)
				const first = obstructing[0]
				const route = first?.routes[0]
				const capacityBlocker = first === undefined || route === undefined || actionable.length > 0 ? undefined : walletVaultMigrationRouteCapacityBlocker(snapshot, first.pool, route, options, 'Vault migration child route')
				return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', capacityBlocker, obstructing.length > 0 ? undefined : 'No pool is in the exact required fork phase')
			}
			const obstructing = candidates(snapshot, options, false)
			const actionable = candidates(snapshot, options)
			const first = obstructing[0]
			let capacityBlocker: string | undefined
			if (first !== undefined && actionable.length === 0) {
				if (kind === 'create-child') capacityBlocker = childRouteTopologyCapacityBlocker(snapshot, first.pool, first.outcome, options, 'Child pool creation route')
				if (kind === 'migrate-rep') capacityBlocker = childUniverseTopologyCapacityBlocker(snapshot, first.pool, first.outcome, options, 'Pool-held REP migration child universe')
			}
			return eligible(options.allowIrreversibleOperations === true ? undefined : 'Irreversible operations are disabled', capacityBlocker, obstructing.length > 0 ? undefined : 'No pool is in the exact required fork phase')
		},
		id,
		label: `Fork ${kind}`,
		method,
		risk: 'irreversible',
	}
}
