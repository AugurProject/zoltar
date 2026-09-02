import { describe, expect, test } from 'bun:test'
import { evaluateSelectableOperationDefinition } from '../../src/operations/catalog.ts'
import { TRADING_OPERATIONS } from '../../src/operations/trading.ts'
import { genesisInitializationDefinitionId, type GenesisInitializationState } from '../../src/runtime/selection.ts'
import { address, snapshotFixture } from './fixture.ts'

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	immutableTopologyCapacity: { maxPools: 100, maxQuestions: 100, maxStagedOperationsPerPool: 100, maxUniverses: 100, maxVaultsPerPool: 100, maximumAggregateItems: 10_000 },
	maximumBlockIntervalSeconds: 15,
	maxEthSpendAttoEth: (10n ** 15n).toString(),
	maxRepSpendAttoRep: (10n ** 15n).toString(),
	minimumEthReserveAttoEth: '0',
	minimumRepReserveAttoRep: '0',
	seed: 1,
} as const

function completeState(overrides: Partial<GenesisInitializationState>): GenesisInitializationState {
	return {
		genesisUniversePresent: true,
		hasInitializedPair: true,
		hasInitializedUniswapPool: true,
		hasPair: true,
		hasPool: true,
		hasQuestion: true,
		hasSeededUniswapPool: true,
		hasUniswapPool: true,
		hasUniswapSeeder: true,
		hasWeth: true,
		hasWalletVault: true,
		tradingFactoryDeployed: true,
		tradingRouterDeployed: true,
		...overrides,
	}
}

describe('genesis initialization', () => {
	test('advances through every external and protocol trading prerequisite in order', () => {
		expect(genesisInitializationDefinitionId(completeState({ hasQuestion: false }))).toBe('zoltar.question.create-binary')
		expect(genesisInitializationDefinitionId(completeState({ hasPool: false }))).toBe('statoblast.pool.deploy')
		expect(genesisInitializationDefinitionId(completeState({ hasWalletVault: false }))).toBe('statoblast.vault.deposit-rep')
		expect(genesisInitializationDefinitionId(completeState({ hasUniswapSeeder: false }))).toBe('trading.genesis-uniswap.deploy-seeder')
		expect(genesisInitializationDefinitionId(completeState({ hasUniswapPool: false }))).toBe('trading.genesis-uniswap.create-pool')
		expect(genesisInitializationDefinitionId(completeState({ hasInitializedUniswapPool: false }))).toBe('trading.genesis-uniswap.initialize-pool')
		expect(genesisInitializationDefinitionId(completeState({ hasWeth: false }))).toBe('open-oracle.weth.wrap')
		expect(genesisInitializationDefinitionId(completeState({ hasSeededUniswapPool: false }))).toBe('trading.genesis-uniswap.seed-pool')
		expect(genesisInitializationDefinitionId(completeState({ tradingFactoryDeployed: false }))).toBe('trading.root.deploy-factory')
		expect(genesisInitializationDefinitionId(completeState({ tradingRouterDeployed: false }))).toBe('trading.root.deploy-router')
	})

	test('builds bounded pool creation, initialization, and seeding plans from authenticated state', () => {
		const snapshot = snapshotFixture()
		snapshot.deployments.uniswapV3Factory = address(40)
		snapshot.genesisUniswap = { factory: true, initialized: false, liquidity: '0', seeder: true }
		const creation = evaluateSelectableOperationDefinition('trading.genesis-uniswap.create-pool', snapshot, options)
		expect(creation.plan?.steps[0]?.to).toBe(address(40))

		snapshot.genesisUniswap.pool = address(41)
		const initialization = evaluateSelectableOperationDefinition('trading.genesis-uniswap.initialize-pool', snapshot, options)
		expect(initialization.plan?.metadata).toMatchObject({ pool: address(41) })

		snapshot.genesisUniswap.initialized = true
		const seeding = evaluateSelectableOperationDefinition('trading.genesis-uniswap.seed-pool', snapshot, options)
		expect(seeding.plan?.steps.map(step => step.id)).toEqual(['approve-genesis-token0', 'approve-genesis-token1', 'seed-genesis-uniswap-pool'])
		expect(seeding.plan?.steps[2]?.walletAssetDebits).toHaveLength(2)
		const plan = seeding.plan
		if (plan === undefined) throw new Error('Genesis seeding plan missing')
		const seeder = String(plan.metadata['seeder'])
		for (const token of snapshot.wallet.tokens) token.allowances[seeder] = '1'
		const definition = TRADING_OPERATIONS.find(candidate => candidate.id === 'trading.genesis-uniswap.seed-pool')
		const cleanup = definition?.buildContinuationPlan?.(snapshot, options, { confirmedStepIds: ['approve-genesis-token0'], continuationDisposition: 'cleanup-only', previousPlan: plan })
		expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-genesis-token0'])
		const untouched = definition?.buildContinuationPlan?.(snapshot, options, { confirmedStepIds: [], continuationDisposition: 'cleanup-only', previousPlan: plan })
		expect(untouched).toBeUndefined()
	})

	test('binds pool and vault plans to the requested genesis topology despite competitors', () => {
		const snapshot = snapshotFixture()
		const firstQuestion = snapshot.questions[0]
		const firstPool = snapshot.pools[0]
		if (firstQuestion === undefined || firstPool === undefined) throw new Error('Genesis fixtures missing')
		const targetQuestion = { ...firstQuestion, endTime: '2000001000', id: '78' }
		snapshot.questions.push(targetQuestion)
		const deployment = evaluateSelectableOperationDefinition('statoblast.pool.deploy', snapshot, { ...options, genesisInitializationTarget: { questionId: targetQuestion.id, universeId: '0' } })
		expect(deployment.plan?.metadata).toMatchObject({ questionId: targetQuestion.id, universeId: '0' })

		const targetPool = { ...firstPool, address: address(42), questionId: targetQuestion.id, walletVaultRegistered: false }
		snapshot.pools.push(targetPool)
		const deposit = evaluateSelectableOperationDefinition('statoblast.vault.deposit-rep', snapshot, { ...options, genesisInitializationTarget: { pool: targetPool.address, questionId: targetQuestion.id, universeId: '0' } })
		expect(deposit.plan?.metadata).toMatchObject({ pool: targetPool.address })
	})
})
