import { describe, expect, test } from 'bun:test'
import { evaluateSelectableOperationDefinition } from '../../src/operations/catalog.ts'
import { TRADING_OPERATIONS } from '../../src/operations/trading.ts'
import { genesisInitializationDefinitionId, type GenesisInitializationState } from '../../src/runtime/selection.ts'
import { address, snapshotFixture } from './fixture.ts'

const maximumEthSpendAttoEth = 10n ** 15n
const maximumRepSpendAttoRep = 10n ** 15n

const options = {
	allowHighRisk: true,
	allowIrreversibleOperations: true,
	immutableTopologyCapacity: { maxPools: 100, maxQuestions: 100, maxStagedOperationsPerPool: 100, maxUniverses: 100, maxVaultsPerPool: 100, maximumAggregateItems: 10_000 },
	maximumBlockIntervalSeconds: 15,
	maxEthSpendAttoEth: maximumEthSpendAttoEth.toString(),
	maxRepSpendAttoRep: maximumRepSpendAttoRep.toString(),
	minimumEthReserveAttoEth: 0n.toString(),
	minimumRepReserveAttoRep: 0n.toString(),
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
		snapshot.genesisUniswap = { factory: true, initialized: false, liquidity: '0', proxy: true, seeder: true }
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

	test('creates, initializes, and seeds REP/WETH pools for canonical child universes', () => {
		const snapshot = snapshotFixture()
		const childRep = address(43)
		const uniswapFactory = address(44)
		const childPool = address(45)
		const genesisUniverse = snapshot.universes[0]
		if (genesisUniverse === undefined) throw new Error('Genesis universe fixture missing')
		snapshot.deployments.uniswapV3Factory = uniswapFactory
		snapshot.universes.push({ ...genesisUniverse, id: '2', repToken: childRep })
		snapshot.wallet.tokens.push({ address: childRep, allowances: {}, balance: '1000000000000000000', openOracleCredit: '0', openOracleInternalAllowanceToSelf: '0', symbol: 'REP' })
		snapshot.universeUniswap = {
			factory: true,
			pools: [
				{ initialized: true, liquidity: '1', pool: address(46), repToken: genesisUniverse.repToken, universeId: '0' },
				{ initialized: false, liquidity: '0', repToken: childRep, universeId: '2' },
			],
			proxy: true,
			seeder: true,
		}

		const creation = evaluateSelectableOperationDefinition('trading.universe-uniswap.create-pool', snapshot, options)
		expect(creation.plan?.metadata).toMatchObject({ factory: uniswapFactory, rep: childRep, universeId: '2' })

		snapshot.universeUniswap.pools[1] = { initialized: false, liquidity: '0', pool: childPool, repToken: childRep, universeId: '2' }
		const initialization = evaluateSelectableOperationDefinition('trading.universe-uniswap.initialize-pool', snapshot, options)
		expect(initialization.plan?.metadata).toMatchObject({ pool: childPool, universeId: '2' })

		snapshot.universeUniswap.pools[1] = { initialized: true, liquidity: '0', pool: childPool, repToken: childRep, universeId: '2' }
		snapshot.universeUniswap.pools.push({ initialized: true, liquidity: '0', pool: address(47), repToken: address(48), universeId: '1' })
		const seeding = evaluateSelectableOperationDefinition('trading.universe-uniswap.seed-pool', snapshot, options)
		expect(seeding.plan?.metadata).toMatchObject({ pool: childPool, rep: childRep, universeId: '2' })
		expect(seeding.plan?.steps.map(step => step.id)).toEqual(['approve-universe-token0', 'approve-universe-token1', 'seed-universe-uniswap-pool'])
		const plan = seeding.plan
		if (plan === undefined) throw new Error('Child-universe seeding plan missing')
		const seeder = String(plan.metadata['seeder'])
		for (const token of snapshot.wallet.tokens) token.allowances[seeder] = '1'
		const definition = TRADING_OPERATIONS.find(candidate => candidate.id === 'trading.universe-uniswap.seed-pool')
		const continuation = definition?.buildContinuationPlan?.(snapshot, options, { confirmedStepIds: ['approve-universe-token0'], previousPlan: plan })
		expect(continuation?.metadata).toEqual(plan.metadata)
		expect(continuation?.continuationDisposition).toBeUndefined()
		const cleanup = definition?.buildContinuationPlan?.(snapshot, options, { confirmedStepIds: ['approve-universe-token0'], continuationDisposition: 'cleanup-only', previousPlan: plan })
		expect(cleanup?.steps.map(step => step.id)).toEqual(['revoke-universe-token0'])
		snapshot.universeUniswap.pools.pop()

		const childInventory = snapshot.wallet.tokens.find(token => token.address === childRep)
		if (childInventory === undefined) throw new Error('Child REP inventory missing')
		childInventory.balance = '1010'
		const reserveBound = evaluateSelectableOperationDefinition('trading.universe-uniswap.seed-pool', snapshot, { ...options, maxRepSpendAttoRep: '100', minimumRepReserveAttoRep: '1000' })
		const repMaximumKey = reserveBound.plan?.metadata['token0'] === childRep ? 'maximum0' : 'maximum1'
		expect(reserveBound.plan?.metadata[repMaximumKey]).toBe('10')
	})
})
