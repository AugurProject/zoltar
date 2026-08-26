import { OPEN_ORACLE_OPERATIONS } from './open-oracle.ts'
import { STATOBLAST_OPERATIONS } from './statoblast.ts'
import { TRADING_OPERATIONS } from './trading.ts'
import type { CanonicalLifecyclePresence, EcosystemSnapshot, EvaluatedOperation, OperationDefinition, OperationPlan, PlanningOptions } from './types.ts'
import { ZOLTAR_OPERATIONS } from './zoltar.ts'

export { MUTATING_CONTRACT_SURFACE, classifiedMethod, type ContractMethodClassification } from '../contracts/surface.ts'

export const CHAOS_OPERATION_CATALOG: readonly OperationDefinition[] = [...ZOLTAR_OPERATIONS, ...STATOBLAST_OPERATIONS, ...OPEN_ORACLE_OPERATIONS, ...TRADING_OPERATIONS]

function publicDefinition(definition: OperationDefinition): EvaluatedOperation['definition'] {
	return {
		classification: definition.classification,
		contract: definition.contract,
		description: definition.description,
		discoveryInputs: [...definition.discoveryInputs],
		ecosystem: definition.ecosystem,
		id: definition.id,
		label: definition.label,
		method: definition.method,
		risk: definition.risk,
	}
}

function blockedPlannerEvaluation(definition: OperationDefinition): EvaluatedOperation {
	return {
		definition: publicDefinition(definition),
		eligibility: { blockers: ['Planner found no safe candidate at the anchored snapshot'], eligible: false },
	}
}

function evaluatedPlan(definition: OperationDefinition, plan: Omit<OperationPlan, 'planningSeed'>, seed: number): EvaluatedOperation {
	return {
		definition: publicDefinition(definition),
		eligibility: { blockers: [], eligible: true },
		plan: { ...plan, planningSeed: seed },
	}
}

function evaluateDefinition(definition: OperationDefinition, snapshot: EcosystemSnapshot, options: PlanningOptions): EvaluatedOperation {
	const eligibility = definition.evaluate(snapshot, options)
	const evaluated: EvaluatedOperation = { definition: publicDefinition(definition), eligibility }
	if (!eligibility.eligible || definition.classification !== 'selectable') return evaluated
	const plan = definition.buildPlan(snapshot, options)
	return plan === undefined ? blockedPlannerEvaluation(definition) : evaluatedPlan(definition, plan, options.seed)
}

function evaluateLifecycleDefinition(definition: OperationDefinition, snapshot: EcosystemSnapshot, options: PlanningOptions): EvaluatedOperation[] {
	const eligibility = definition.evaluate(snapshot, options)
	if (!eligibility.eligible) return [{ definition: publicDefinition(definition), eligibility }]
	if (definition.buildLifecyclePlans === undefined) throw new Error(`Lifecycle definition ${definition.id} has no single-pass instance enumerator`)
	const plans = definition.buildLifecyclePlans(snapshot, options)
	if (plans.length === 0) return [blockedPlannerEvaluation(definition)]
	return plans.map(plan => evaluatedPlan(definition, plan, options.seed))
}

export function evaluateOperationCatalog(snapshot: EcosystemSnapshot, options: PlanningOptions): EvaluatedOperation[] {
	return CHAOS_OPERATION_CATALOG.flatMap(definition => {
		if (definition.classification !== 'lifecycle-obligation') return [evaluateDefinition(definition, snapshot, options)]
		return evaluateLifecycleDefinition(definition, snapshot, options)
	})
}

/**
 * Enumerates raw on-chain lifecycle identities before local policy, signer,
 * submission-mode, and actionability filters. Consumers use this complete set
 * to retain terminal tombstones; it is not an executable plan list.
 */
export function canonicalLifecyclePresence(snapshot: EcosystemSnapshot, options: PlanningOptions): CanonicalLifecyclePresence[] {
	return CHAOS_OPERATION_CATALOG.flatMap(definition => {
		if (definition.classification !== 'lifecycle-obligation') return []
		if (definition.buildLifecyclePlans === undefined) throw new Error(`Lifecycle definition ${definition.id} has no single-pass instance enumerator`)
		if (definition.enumerateLifecyclePresence === undefined) throw new Error(`Lifecycle definition ${definition.id} has no raw presence enumerator`)
		const metadata = definition.enumerateLifecyclePresence(snapshot, options)
		return metadata.map(instance => ({ definitionId: definition.id, ecosystem: definition.ecosystem, metadata: instance }))
	})
}

function canonicalMetadata(metadata: OperationPlan['metadata']) {
	return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))))
}

function metadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return typeof value === 'string' ? value : undefined
}

function isolateSelectableContinuation(snapshot: EcosystemSnapshot, metadata: OperationPlan['metadata'], options: Omit<PlanningOptions, 'seed'>): EcosystemSnapshot {
	const universeId = metadataString(metadata, 'universeId')
	const questionId = metadataString(metadata, 'questionId')
	const poolAddress = metadataString(metadata, 'pool')
	const coordinatorAddress = metadataString(metadata, 'coordinator')
	const pairAddress = metadataString(metadata, 'pair')
	const tokenAddress = metadataString(metadata, 'token')
	const pools = snapshot.pools.filter(pool => {
		if (poolAddress !== undefined && pool.address.toLowerCase() !== poolAddress.toLowerCase()) return false
		return coordinatorAddress === undefined || pool.coordinator.toLowerCase() === coordinatorAddress.toLowerCase()
	})
	const tokens = tokenAddress === undefined ? snapshot.wallet.tokens : snapshot.wallet.tokens.filter(token => token.address.toLowerCase() === tokenAddress.toLowerCase())
	const nativeToken = tokenAddress?.toLowerCase() === '0x0000000000000000000000000000000000000000'
	return {
		...snapshot,
		pairs: pairAddress === undefined ? snapshot.pairs : snapshot.pairs.filter(pair => pair.address.toLowerCase() === pairAddress.toLowerCase()),
		pools: poolAddress === undefined && coordinatorAddress === undefined ? snapshot.pools : pools,
		questions: questionId === undefined ? snapshot.questions : snapshot.questions.filter(question => question.id === questionId),
		universes: universeId === undefined ? snapshot.universes : snapshot.universes.filter(universe => universe.id === universeId),
		wallet: {
			...snapshot.wallet,
			ethBalanceAttoEth: tokenAddress !== undefined && !nativeToken ? (options.minimumEthReserveAttoEth ?? '0') : snapshot.wallet.ethBalanceAttoEth,
			tokens: nativeToken ? [] : tokens,
		},
	}
}

/** Rebuilds the exact durable instance, independent of current candidate order. */
export function reevaluateOperationContinuation(snapshot: EcosystemSnapshot, previousPlan: OperationPlan, options: Omit<PlanningOptions, 'seed'> = {}): EvaluatedOperation {
	const definition = CHAOS_OPERATION_CATALOG.find(candidate => candidate.id === previousPlan.definitionId)
	if (definition === undefined) throw new Error(`Unknown durable operation definition ${previousPlan.definitionId}`)
	if (definition.classification === 'lifecycle-obligation') {
		const evaluations = evaluateLifecycleDefinition(definition, snapshot, { ...options, seed: previousPlan.planningSeed })
		const expected = canonicalMetadata(previousPlan.metadata)
		const exact = evaluations.find(evaluation => evaluation.plan !== undefined && canonicalMetadata(evaluation.plan.metadata) === expected)
		return (
			exact ?? {
				definition: publicDefinition(definition),
				eligibility: { blockers: ['The exact durable lifecycle instance is not eligible at the anchored snapshot'], eligible: false },
			}
		)
	}
	const planningOptions = { ...options, seed: previousPlan.planningSeed }
	const continuationSnapshot = previousPlan.steps.length > 1 ? isolateSelectableContinuation(snapshot, previousPlan.metadata, options) : snapshot
	const evaluated = evaluateDefinition(definition, continuationSnapshot, planningOptions)
	if (previousPlan.steps.length <= 1 || (evaluated.plan !== undefined && canonicalMetadata(evaluated.plan.metadata) === canonicalMetadata(previousPlan.metadata))) return evaluated
	return {
		definition: publicDefinition(definition),
		eligibility: { blockers: ['The exact selectable workflow instance is not eligible at the anchored snapshot'], eligible: false },
	}
}

export function eligibleOperationPlans(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlan[] {
	return evaluateOperationCatalog(snapshot, options)
		.map(operation => operation.plan)
		.filter((plan): plan is OperationPlan => plan !== undefined)
}

export function urgentOperationPlans(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlan[] {
	return eligibleOperationPlans(snapshot, options)
		.filter(plan => plan.obligation)
		.sort((left, right) => {
			if (left.deadlineTimestamp === undefined) return right.deadlineTimestamp === undefined ? 0 : 1
			if (right.deadlineTimestamp === undefined) return -1
			const leftDeadline = BigInt(left.deadlineTimestamp)
			const rightDeadline = BigInt(right.deadlineTimestamp)
			if (leftDeadline < rightDeadline) return -1
			if (leftDeadline > rightDeadline) return 1
			return 0
		})
}

export type {
	ChaosEcosystem,
	CanonicalLifecyclePresence,
	EcosystemSnapshot,
	EligibilityResult,
	EvaluatedOperation,
	OperationClassification,
	OperationDefinition,
	OperationEvidence,
	OperationPlan,
	OperationRisk,
	OperationStep,
	OperationWalletAssetDebit,
	PlanningOptions,
} from './types.ts'
