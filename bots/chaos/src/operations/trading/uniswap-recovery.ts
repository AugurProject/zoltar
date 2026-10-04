import type { UniswapPositionSnapshot, UniverseUniswapPoolSnapshot } from '../uniswap-types.ts'
import { retirementUniswapV3PositionAbi } from '../../contracts/retirement-abi.ts'
import { inputMatches } from '../input-values.ts'
import { amount, choose, eligible, encodeStep, eventEvidence, mixSeed, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationDefinition, OperationPlan, PlanningOptions } from '../types.ts'

function candidates(snapshot: EcosystemSnapshot, options: PlanningOptions, mode: 'remove' | 'collect') {
	return (
		snapshot.universeUniswap?.pools.flatMap(pool => {
			if (pool.pool === undefined || !pool.initialized || !inputMatches(options, 'universeId', pool.universeId)) return []
			return (pool.positions ?? []).filter(position => (mode === 'remove' ? amount(position.liquidity) > 1n : amount(position.collectable0) + amount(position.collectable1) > 0n)).map(position => ({ pool, position }))
		}) ?? []
	)
}

function recoveryPlan(snapshot: EcosystemSnapshot, definition: OperationDefinition, pool: UniverseUniswapPoolSnapshot, position: UniswapPositionSnapshot, liquidity: bigint, metadata: OperationPlan['metadata'], collectOnly = false) {
	if (pool.pool === undefined) return undefined
	const steps = []
	if (!collectOnly && (liquidity > 0n || amount(position.liquidity) > 0n))
		steps.push(
			encodeStep({
				abi: retirementUniswapV3PositionAbi,
				args: [position.tickLower, position.tickUpper, liquidity],
				functionName: 'burn',
				id: 'update-uniswap-position',
				label: liquidity > 0n ? 'Remove part of Uniswap liquidity' : 'Update accrued Uniswap fees',
				to: pool.pool,
				evidence: [eventEvidence(pool.pool, 'Burn(address,int24,int24,uint128,uint256,uint256)')],
				walletAssetDebits: [],
			}),
		)
	steps.push(
		encodeStep({
			abi: retirementUniswapV3PositionAbi,
			args: [snapshot.wallet.address, position.tickLower, position.tickUpper, (1n << 128n) - 1n, (1n << 128n) - 1n],
			functionName: 'collect',
			id: 'collect-uniswap-position',
			label: 'Collect Uniswap tokens',
			to: pool.pool,
			evidence: [eventEvidence(pool.pool, 'Collect(address,address,int24,int24,uint128,uint128)')],
			walletAssetDebits: [],
		}),
	)
	return planBase({ definitionId: definition.id, ecosystem: 'trading', label: definition.label, risk: 'medium', snapshot, metadata, postconditions: ['Collected tokens return to the signer and the remaining position stays wallet-owned'], steps })
}

export function uniswapRecoveryDefinition(mode: 'remove' | 'collect'): OperationDefinition {
	const definition: OperationDefinition = {
		id: mode === 'remove' ? 'trading.uniswap.remove-liquidity' : 'trading.uniswap.collect-fees',
		label: mode === 'remove' ? 'Remove partial REP/WETH liquidity' : 'Collect REP/WETH fees',
		classification: 'selectable',
		contract: 'UniswapV3Pool',
		method: mode === 'remove' ? 'burn' : 'collect',
		ecosystem: 'trading',
		risk: 'medium',
		description: mode === 'remove' ? 'Removes one quarter of a wallet-owned Uniswap position and collects its tokens, preserving remaining liquidity.' : 'Updates and collects accrued Uniswap fees without reducing wallet-owned liquidity.',
		discoveryInputs: ['authenticated wallet positions, current liquidity and modular fee growth'],
		evaluate: (snapshot, options) => eligible(candidates(snapshot, options, mode).length > 0 ? undefined : 'No wallet-owned Uniswap position is eligible'),
		buildPlan(snapshot, options) {
			const target = choose(candidates(snapshot, options, mode), mixSeed(options.seed, definition.id))
			if (target === undefined || target.pool.pool === undefined) return undefined
			const current = amount(target.position.liquidity)
			const removed = mode === 'collect' ? 0n : current / 4n || 1n
			return recoveryPlan(snapshot, definition, target.pool, target.position, removed, { pool: target.pool.pool, universeId: target.pool.universeId, tickLower: target.position.tickLower, tickUpper: target.position.tickUpper, removedLiquidity: removed.toString(), originalLiquidity: current.toString() })
		},
		buildContinuationPlan(snapshot, _options, context) {
			if (context.confirmedStepIds.includes('collect-uniswap-position')) return undefined
			const metadata = context.previousPlan.metadata
			const pool = snapshot.universeUniswap?.pools.find(candidate => candidate.pool === metadata['pool'] && candidate.universeId === metadata['universeId'])
			const position = pool?.positions?.find(candidate => candidate.tickLower === metadata['tickLower'] && candidate.tickUpper === metadata['tickUpper'])
			if (pool === undefined || position === undefined || typeof metadata['removedLiquidity'] !== 'string') return undefined
			const updated = context.confirmedStepIds.includes('update-uniswap-position')
			if (context.continuationDisposition === 'cleanup-only' && !updated) return undefined
			const removed = amount(metadata['removedLiquidity'])
			if (!updated && removed >= amount(position.liquidity) && removed > 0n) return undefined
			const plan = recoveryPlan(snapshot, definition, pool, position, removed, metadata, updated)
			return plan === undefined ? undefined : { ...plan, ...(updated ? { continuationDisposition: 'cleanup-only' as const } : {}) }
		},
	}
	return definition
}
