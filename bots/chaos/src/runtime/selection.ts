import { randomInteger } from '../core/random.ts'
import { OperationRediscoveryRequired } from '../execution/execution-context.ts'
import type { EcosystemSnapshot, EvaluatedOperation, OperationPlan } from '../operations/types.ts'

function eligibleOperationPlans(evaluations: readonly EvaluatedOperation[]) {
	return evaluations.flatMap(evaluation => {
		if (!evaluation.eligibility.eligible || evaluation.plan === undefined) return []
		return [evaluation.plan]
	})
}

function deadlineValue(plan: OperationPlan) {
	if (plan.deadlineTimestamp === undefined) return 2n ** 256n - 1n
	if (!/^(?:0|[1-9]\d*)$/.test(plan.deadlineTimestamp)) {
		throw new Error(`Operation ${plan.definitionId} has an invalid deadline timestamp`)
	}
	return BigInt(plan.deadlineTimestamp)
}

export function urgentOperationPlans(evaluations: readonly EvaluatedOperation[]) {
	const urgent = eligibleOperationPlans(evaluations).filter(plan => plan.priority === 'urgent' || plan.obligation)
	for (const plan of urgent) deadlineValue(plan)
	return urgent.sort((left, right) => {
		const leftDeadline = deadlineValue(left)
		const rightDeadline = deadlineValue(right)
		if (leftDeadline < rightDeadline) return -1
		if (leftDeadline > rightDeadline) return 1
		return left.id.localeCompare(right.id)
	})
}

export function randomOperationPlans(evaluations: readonly EvaluatedOperation[], selectableOperationAllowlist?: readonly string[]) {
	const allowed = selectableOperationAllowlist === undefined ? undefined : new Set(selectableOperationAllowlist)
	return eligibleOperationPlans(evaluations).filter(plan => plan.priority === 'random' && !plan.obligation && (allowed === undefined || allowed.has(plan.definitionId)))
}

/** Explain an empty scheduler selection using the evaluations before live preflight mutates them. */
export function randomOperationSkipReason(evaluations: readonly EvaluatedOperation[], selectableOperationAllowlist: readonly string[] | undefined, attemptedCandidates: number) {
	if (attemptedCandidates === 1) return 'Random run skipped: the only candidate failed preflight. See preceding failures'
	if (attemptedCandidates > 1) return `Random run skipped: all ${attemptedCandidates.toString()} candidates failed preflight. See preceding failures`
	const eligibleRandom = new Set(randomOperationPlans(evaluations).map(plan => plan.definitionId)).size
	if (eligibleRandom > 0 && randomOperationPlans(evaluations, selectableOperationAllowlist).length === 0) {
		return `Random run skipped: the allowlist excludes all ${eligibleRandom.toString()} eligible random operation${eligibleRandom === 1 ? '' : 's'}`
	}
	if (urgentOperationPlans(evaluations).length > 0) return 'Random run skipped: only lifecycle operations are eligible'
	return 'Random run skipped: no random operation has an eligible plan in the current state'
}

/** Probe randomly without replacement; no scheduler run or workflow starts until a probe succeeds. */
export async function selectExecutableOperationPlan(candidates: readonly OperationPlan[], preflight: (plan: OperationPlan) => Promise<void>, rejected: (plan: OperationPlan, error: OperationRediscoveryRequired) => void, pickIndex: (length: number) => number = length => randomInteger(0, length)) {
	const remaining = [...candidates]
	while (remaining.length !== 0) {
		const [plan] = remaining.splice(pickIndex(remaining.length), 1)
		if (plan === undefined) throw new Error('Operation selection returned an invalid candidate index')
		try {
			await preflight(plan)
			return plan
		} catch (error) {
			// Connectivity failures and unexpected errors must still stop the cycle safely.
			if (!(error instanceof OperationRediscoveryRequired)) throw error
			rejected(plan, error)
		}
	}
	return undefined
}

export function genesisInitializationTarget(snapshot: Pick<EcosystemSnapshot, 'anchor' | 'questions' | 'pools' | 'pairs'>) {
	const initializerQuestion = [...snapshot.questions]
		.filter(question => question.kind === 'binary' && (BigInt(question.endTime) > BigInt(snapshot.anchor.timestamp) || snapshot.pools.some(pool => pool.universeId === '0' && pool.questionId === question.id)))
		.sort((left, right) => {
			if (BigInt(left.id) < BigInt(right.id)) return -1
			return BigInt(left.id) > BigInt(right.id) ? 1 : 0
		})[0]
	const genesisPool = initializerQuestion === undefined ? undefined : snapshot.pools.find(pool => pool.universeId === '0' && pool.questionId === initializerQuestion.id)
	const genesisPair = genesisPool === undefined ? undefined : snapshot.pairs.find(pair => pair.pool.toLowerCase() === genesisPool.address.toLowerCase())
	return { genesisPair, genesisPool, initializerQuestion }
}

export type GenesisInitializationState = {
	genesisUniversePresent: boolean
	hasInitializedPair: boolean
	hasPair: boolean
	hasPool: boolean
	hasQuestion: boolean
	hasWalletVault: boolean
	hasUniswapPool: boolean
	hasUniswapSeeder: boolean
	hasWeth: boolean
	hasInitializedUniswapPool: boolean
	hasSeededUniswapPool: boolean
	tradingFactoryDeployed: boolean
	tradingRouterDeployed: boolean
}

export const genesisInitializationDefinitionIds = new Set([
	'zoltar.question.create-binary',
	'statoblast.pool.deploy',
	'statoblast.vault.deposit-rep',
	'trading.genesis-uniswap.deploy-seeder',
	'trading.genesis-uniswap.create-pool',
	'trading.genesis-uniswap.initialize-pool',
	'open-oracle.weth.wrap',
	'trading.genesis-uniswap.seed-pool',
	'trading.root.deploy-factory',
	'trading.root.deploy-router',
	'trading.pair.create',
	'trading.pair.initialize-eth',
])

export function genesisInitializationDefinitionId(state: GenesisInitializationState) {
	if (!state.genesisUniversePresent) return undefined
	let definitionId: string | undefined
	if (!state.hasQuestion) definitionId = 'zoltar.question.create-binary'
	else if (!state.hasPool) definitionId = 'statoblast.pool.deploy'
	else if (!state.hasWalletVault) definitionId = 'statoblast.vault.deposit-rep'
	else if (!state.hasUniswapSeeder) definitionId = 'trading.genesis-uniswap.deploy-seeder'
	else if (!state.hasUniswapPool) definitionId = 'trading.genesis-uniswap.create-pool'
	else if (!state.hasInitializedUniswapPool) definitionId = 'trading.genesis-uniswap.initialize-pool'
	else if (!state.hasWeth) definitionId = 'open-oracle.weth.wrap'
	else if (!state.hasSeededUniswapPool) definitionId = 'trading.genesis-uniswap.seed-pool'
	else if (!state.tradingFactoryDeployed) definitionId = 'trading.root.deploy-factory'
	else if (!state.tradingRouterDeployed) definitionId = 'trading.root.deploy-router'
	else if (!state.hasPair) definitionId = 'trading.pair.create'
	else if (!state.hasInitializedPair) definitionId = 'trading.pair.initialize-eth'
	return definitionId
}

export function genesisInitializationPlan(evaluations: readonly EvaluatedOperation[], state: GenesisInitializationState) {
	const definitionId = genesisInitializationDefinitionId(state)
	if (definitionId === undefined) return undefined
	const plans = eligibleOperationPlans(evaluations)
	return plans.find(candidate => candidate.definitionId === definitionId)
}
