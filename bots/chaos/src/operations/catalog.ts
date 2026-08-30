import { OPEN_ORACLE_OPERATIONS } from './open-oracle.ts'
import { STATOBLAST_OPERATIONS } from './statoblast.ts'
import { assertWorkflowPrerequisiteLimit } from './timing.ts'
import { TRADING_OPERATIONS } from './trading.ts'
import type { CanonicalLifecyclePresence, EcosystemSnapshot, EvaluatedOperation, OperationContinuationContext, OperationDefinition, OperationPlan, PlanningOptions } from './types.ts'
import { ZOLTAR_OPERATIONS } from './zoltar.ts'

export { MUTATING_CONTRACT_SURFACE, classifiedMethod, type ContractMethodClassification } from '../contracts/surface.ts'

export const CHAOS_OPERATION_CATALOG: readonly OperationDefinition[] = [...ZOLTAR_OPERATIONS, ...STATOBLAST_OPERATIONS, ...OPEN_ORACLE_OPERATIONS, ...TRADING_OPERATIONS]

export function operationHasCanonicalContinuationBuilder(definitionId: string) {
	return CHAOS_OPERATION_CATALOG.some(definition => definition.id === definitionId && definition.buildContinuationPlan !== undefined)
}

function publicDefinition(definition: OperationDefinition): EvaluatedOperation['definition'] {
	return {
		classification: definition.classification,
		contract: definition.contract,
		description: definition.description,
		discoveryInputs: [...definition.discoveryInputs],
		ecosystem: definition.ecosystem,
		id: definition.id,
		independentlyExecutable: definition.classification === 'selectable' || definition.classification === 'lifecycle-obligation',
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
	assertWorkflowPrerequisiteLimit(plan)
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
	if (plan?.continuationDisposition !== undefined) throw new Error(`Initial selectable plan ${definition.id} cannot declare a continuation disposition`)
	return plan === undefined ? blockedPlannerEvaluation(definition) : evaluatedPlan(definition, plan, options.seed)
}

function evaluateLifecycleDefinition(definition: OperationDefinition, snapshot: EcosystemSnapshot, options: PlanningOptions): EvaluatedOperation[] {
	const eligibility = definition.evaluate(snapshot, options)
	if (!eligibility.eligible) return [{ definition: publicDefinition(definition), eligibility }]
	if (definition.buildLifecyclePlans === undefined) throw new Error(`Lifecycle definition ${definition.id} has no single-pass instance enumerator`)
	const plans = definition.buildLifecyclePlans(snapshot, options)
	if (plans.length === 0) return [blockedPlannerEvaluation(definition)]
	if (plans.some(plan => plan.continuationDisposition !== undefined)) throw new Error(`Lifecycle definition ${definition.id} cannot declare a selectable continuation disposition`)
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
		if (definition.enumerateLifecycleObstructingPresence === undefined) throw new Error(`Lifecycle definition ${definition.id} has no obstructing presence enumerator`)
		const raw = uniqueLifecycleMetadata(definition.id, 'raw', definition.enumerateLifecyclePresence(snapshot, options))
		const obstructing = uniqueLifecycleMetadata(definition.id, 'obstructing', definition.enumerateLifecycleObstructingPresence(snapshot, options))
		for (const key of obstructing.keys()) {
			if (!raw.has(key)) throw new Error(`Lifecycle definition ${definition.id} exposes an obstructing identity outside raw presence`)
		}
		for (const plan of definition.buildLifecyclePlans(snapshot, options)) {
			const key = canonicalMetadata(plan.metadata)
			if (!raw.has(key)) throw new Error(`Lifecycle definition ${definition.id} built an actionable plan outside raw presence`)
			if (!obstructing.has(key)) throw new Error(`Lifecycle definition ${definition.id} built an actionable plan outside obstructing presence`)
		}
		return [...raw.entries()].map(([key, metadata]) => ({ blocksNovelty: obstructing.has(key), definitionId: definition.id, ecosystem: definition.ecosystem, metadata }))
	})
}

function canonicalMetadata(metadata: OperationPlan['metadata']) {
	return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))))
}

function uniqueLifecycleMetadata(definitionId: string, kind: 'obstructing' | 'raw', metadata: Array<Record<string, string | number | boolean>>) {
	const unique = new Map<string, Record<string, string | number | boolean>>()
	for (const instance of metadata) {
		const key = canonicalMetadata(instance)
		if (unique.has(key)) throw new Error(`Lifecycle definition ${definitionId} exposes duplicate ${kind} identity ${key}`)
		unique.set(key, instance)
	}
	return unique
}

function metadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return typeof value === 'string' ? value : undefined
}

function metadataNumber(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	return typeof value === 'number' ? value : undefined
}

function isolateSelectableContinuation(snapshot: EcosystemSnapshot, metadata: OperationPlan['metadata'], options: Omit<PlanningOptions, 'seed'>): EcosystemSnapshot {
	const universeId = metadataString(metadata, 'universeId')
	const questionId = metadataString(metadata, 'questionId')
	const poolAddress = metadataString(metadata, 'pool')
	const coordinatorAddress = metadataString(metadata, 'coordinator')
	const direction = metadataString(metadata, 'direction')
	const longOutcome = metadataNumber(metadata, 'longOutcome')
	const pairAddress = metadataString(metadata, 'pair')
	const reportId = metadataString(metadata, 'reportId')
	const tokenAddress = metadataString(metadata, 'token')
	const pools = snapshot.pools.filter(pool => {
		if (poolAddress !== undefined && pool.address.toLowerCase() !== poolAddress.toLowerCase()) return false
		return coordinatorAddress === undefined || pool.coordinator.toLowerCase() === coordinatorAddress.toLowerCase()
	})
	const tokens = tokenAddress === undefined ? snapshot.wallet.tokens : snapshot.wallet.tokens.filter(token => token.address.toLowerCase() === tokenAddress.toLowerCase())
	const nativeToken = tokenAddress?.toLowerCase() === '0x0000000000000000000000000000000000000000'
	const shares = snapshot.wallet.shares.flatMap(share => {
		if (direction !== undefined && longOutcome !== undefined) return []
		if (direction === 'YES-to-NO' || longOutcome === 1) return [{ ...share, no: '0' }]
		if (direction === 'NO-to-YES' || longOutcome === 2) return [{ ...share, yes: '0' }]
		return direction === undefined && longOutcome === undefined ? [share] : []
	})
	return {
		...snapshot,
		pairs: pairAddress === undefined ? snapshot.pairs : snapshot.pairs.filter(pair => pair.address.toLowerCase() === pairAddress.toLowerCase()),
		pools: poolAddress === undefined && coordinatorAddress === undefined ? snapshot.pools : pools,
		questions: questionId === undefined ? snapshot.questions : snapshot.questions.filter(question => question.id === questionId),
		reports: reportId === undefined ? snapshot.reports : snapshot.reports.filter(report => report.reportId === reportId),
		universes: universeId === undefined ? snapshot.universes : snapshot.universes.filter(universe => universe.id === universeId),
		wallet: {
			...snapshot.wallet,
			ethBalanceAttoEth: tokenAddress !== undefined && !nativeToken ? (options.minimumEthReserveAttoEth ?? '0') : snapshot.wallet.ethBalanceAttoEth,
			shares,
			tokens: nativeToken ? [] : tokens,
		},
	}
}

/** Rebuilds the exact durable instance, independent of current candidate order. */
export function reevaluateOperationContinuation(snapshot: EcosystemSnapshot, previousPlan: OperationPlan, options: Omit<PlanningOptions, 'seed'>, context: Partial<Pick<OperationContinuationContext, 'confirmedStepIds' | 'continuationDisposition'>> = {}): EvaluatedOperation {
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
	if (definition.buildContinuationPlan !== undefined) {
		const continuationDisposition = context.continuationDisposition ?? previousPlan.continuationDisposition
		const plan = definition.buildContinuationPlan(continuationSnapshot, planningOptions, {
			confirmedStepIds: context.confirmedStepIds ?? [],
			...(continuationDisposition === undefined ? {} : { continuationDisposition }),
			previousPlan,
		})
		if (plan !== undefined && continuationDisposition === 'cleanup-only' && plan.continuationDisposition !== 'cleanup-only') {
			throw new Error(`Cleanup-only continuation builder ${definition.id} returned an unmarked plan`)
		}
		if (plan !== undefined && canonicalMetadata(plan.metadata) === canonicalMetadata(previousPlan.metadata)) {
			return evaluatedPlan(definition, plan, previousPlan.planningSeed)
		}
		return {
			definition: publicDefinition(definition),
			eligibility: { blockers: ['The exact selectable workflow has no safe canonical continuation or cleanup plan'], eligible: false },
		}
	}
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
