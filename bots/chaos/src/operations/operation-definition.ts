import type { ChaosEcosystem, EcosystemSnapshot, EligibilityResult, OperationAbiEntryKind, OperationClassification, OperationContinuationContext, OperationPlanDraft, OperationRisk, PlanningOptions } from './types.ts'

export interface OperationDefinition {
	requiredTradingDeployment?: readonly ('factory' | 'router')[]
	id: string
	label: string
	ecosystem: ChaosEcosystem
	contract: string
	method: string
	/** Defaults to `function`; coverage-only rows retain receive and fallback identity explicitly. */
	abiEntryKind?: OperationAbiEntryKind
	risk: OperationRisk
	classification: OperationClassification
	/** False only for a coverage row that cannot be planned as its own operation. */
	independentlyExecutable?: boolean
	description: string
	discoveryInputs: string[]
	evaluate(snapshot: EcosystemSnapshot, options: PlanningOptions): EligibilityResult
	buildPlan(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlanDraft | undefined
	/** Rebuilds or safely cleans up a partially confirmed selectable workflow. */
	buildContinuationPlan?(snapshot: EcosystemSnapshot, options: PlanningOptions, context: OperationContinuationContext): OperationPlanDraft | undefined
	/**
	 * Builds every currently eligible durable instance in one deterministic pass.
	 * Required for lifecycle definitions; random selection happens only after the
	 * complete set has been synchronized with durable state.
	 */
	buildLifecyclePlans?(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlanDraft[]
	/**
	 * Enumerates raw protocol identities independently of execution policy and
	 * eligibility. Required for lifecycle definitions by the catalog invariant.
	 */
	enumerateLifecyclePresence?(snapshot: EcosystemSnapshot, options: PlanningOptions): Array<Record<string, string | number | boolean>>
	/**
	 * Enumerates every raw identity whose protocol phase is currently due and
	 * must obstruct unrelated novelty. This is independent of local execution
	 * policy and, unlike executable plan construction, must not be paginated.
	 * Required for lifecycle definitions by the catalog invariant.
	 */
	enumerateLifecycleObstructingPresence?(snapshot: EcosystemSnapshot, options: PlanningOptions): Array<Record<string, string | number | boolean>>
}
