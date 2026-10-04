import { UNISWAP_POSITION_RANGES } from '../../core/uniswap-ranges.ts'
import { inputMatches } from '../input-values.ts'
import { choose, eligible, mixSeed, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationDefinition, PlanningOptions } from '../types.ts'
import { seederAllowanceCleanup, uniswapSeedAmounts, uniswapSeedSteps } from './uniswap-seeding.ts'

function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions) {
	if (snapshot.universeUniswap?.seeder !== true) return []
	return snapshot.universeUniswap.pools.flatMap(pool => {
		if (!pool.initialized || pool.pool === undefined || !inputMatches(options, 'universeId', pool.universeId) || !inputMatches(options, 'pool', pool.pool)) return []
		const amounts = uniswapSeedAmounts(snapshot, options, pool.repToken)
		if (amounts === undefined) return []
		return UNISWAP_POSITION_RANGES.filter(range => range.id !== 'full' && inputMatches(options, 'range', range.id)).map(range => ({ pool, range, amounts }))
	})
}

export const mintUniswapRange: OperationDefinition = {
	id: 'trading.uniswap.mint-range',
	label: 'Mint ranged REP/WETH liquidity',
	classification: 'selectable',
	contract: 'GenesisUniswapV3Seeder',
	method: 'seed',
	ecosystem: 'trading',
	risk: 'medium',
	description: 'Mints wallet-owned REP/WETH liquidity in narrow or wide ranges around the initial 1:1 price, or ranges above or below it.',
	discoveryInputs: ['authenticated initialized REP/WETH pools and wallet REP/WETH balances'],
	evaluate: (snapshot, options) => eligible(candidates(snapshot, options).length > 0 ? undefined : 'No initialized REP/WETH pool has spendable REP and WETH'),
	buildPlan(snapshot, options) {
		const target = choose(candidates(snapshot, options), mixSeed(options.seed, mintUniswapRange.id))
		if (target?.pool.pool === undefined) return undefined
		const seed = uniswapSeedSteps(snapshot, 'universe', target.pool.pool, target.pool.repToken, target.amounts, 'Mint ranged REP/WETH liquidity', target.range)
		if (seed === undefined) return undefined
		return planBase({
			definitionId: mintUniswapRange.id,
			ecosystem: 'trading',
			label: mintUniswapRange.label,
			risk: 'medium',
			snapshot,
			maximumCleanupTransactionCount: 2,
			metadata: {
				liquidity: seed.liquidity.toString(),
				maximum0: seed.maximum0.toString(),
				maximum1: seed.maximum1.toString(),
				pool: target.pool.pool,
				rep: target.pool.repToken,
				universeId: target.pool.universeId,
				range: target.range.id,
				tickLower: target.range.tickLower,
				tickUpper: target.range.tickUpper,
				seeder: seed.seeder,
				token0: seed.token0,
				token1: seed.token1,
			},
			postconditions: ['The wallet owns the bounded position at the recorded tick range'],
			steps: seed.steps,
		})
	},
	buildContinuationPlan(snapshot, options, context) {
		const cleanup = () => seederAllowanceCleanup(snapshot, context, 'universe', mintUniswapRange)
		if (context.continuationDisposition === 'cleanup-only' || context.confirmedStepIds.includes('seed-universe-uniswap-pool')) return cleanup()
		const { pool, range } = context.previousPlan.metadata
		if (typeof pool !== 'string' || typeof range !== 'string') return cleanup()
		const refreshed = mintUniswapRange.buildPlan(snapshot, { ...options, operationInputs: { ...options.operationInputs, pool, range } })
		return refreshed !== undefined && JSON.stringify(refreshed.metadata) === JSON.stringify(context.previousPlan.metadata) ? refreshed : cleanup()
	},
}
