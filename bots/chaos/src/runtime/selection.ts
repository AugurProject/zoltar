import { randomInt } from 'node:crypto'
import type { EvaluatedOperation, OperationPlan } from '../operations/types.ts'

export type RandomIndex = (upperExclusive: number) => number

const cryptoRandomIndex: RandomIndex = upperExclusive => randomInt(upperExclusive)

function requireRandomIndex(index: number, length: number) {
	if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
		throw new Error(`Random operation index must be from 0 through ${(length - 1).toString()}`)
	}
	return index
}

export function eligibleOperationPlans(evaluations: readonly EvaluatedOperation[]) {
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

export function selectOperationPlan(evaluations: readonly EvaluatedOperation[], randomIndex: RandomIndex = cryptoRandomIndex, selectableOperationAllowlist?: readonly string[]): OperationPlan | undefined {
	const urgent = urgentOperationPlans(evaluations)
	if (urgent.length > 0) return urgent[0]
	const candidates = randomOperationPlans(evaluations, selectableOperationAllowlist)
	if (candidates.length === 0) return undefined
	return candidates[requireRandomIndex(randomIndex(candidates.length), candidates.length)]
}
