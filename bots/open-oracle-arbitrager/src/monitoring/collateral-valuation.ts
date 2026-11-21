import type { Configuration } from '#config/configuration'
import { poolAbi } from '#contracts/abi'
import { batchRead, batchValue, type BatchReader } from '#core/batch-read'
import { allowlistedCollateral, unlistedCollateralReason, valuationFromSqrtPrice, WETH_VALUATION, type CollateralValuation } from '#core/collateral-valuation'
import { requiredBigint, requiredBigintArray, requiredRpcAddress, requiredTuple } from '#core/rpc-validation'
import { spotTwapDeviationWithinLimit } from '#core/strategy'
import { meanTick } from '#monitoring/execution-pools'
import { zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { uniswapV3FactoryAbi } from '@zoltar/core-shared/evm/uniswapAbis'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'

export type CollateralValuationConfiguration = Pick<Configuration, 'collateralTokens' | 'maxSpotTwapTicks' | 'network' | 'twapSeconds'>

/**
 * `unlisted` collateral is never priced; `unavailable` names the failed valuation-pool check for an allowlisted one.
 * `pool` is the authenticated collateral/WETH pool, absent for WETH itself.
 */
export type CollateralResolution = { kind: 'valued'; pool: Address | undefined; valuation: CollateralValuation } | { kind: 'unlisted' | 'unavailable'; reason: string }

/**
 * Values a report's `token1` in WETH at `blockNumber`. WETH is valued one to one. An allowlisted collateral uses the
 * canonical V3 factory's collateral/WETH pool at the configured fee; the pool must hold liquidity and its spot tick must
 * stay within the strategy's spot/TWAP limit, so a manipulated valuation pool cannot inflate profit or shrink capital at risk.
 */
export async function resolveCollateralValuation(client: BatchReader, config: CollateralValuationConfiguration, token1: Address, blockNumber: bigint): Promise<CollateralResolution> {
	if (token1.toLowerCase() === config.network.weth.toLowerCase()) return { kind: 'valued', pool: undefined, valuation: WETH_VALUATION }
	const collateral = allowlistedCollateral(config.collateralTokens, token1)
	if (collateral === undefined) return { kind: 'unlisted', reason: unlistedCollateralReason(token1) }
	try {
		const [poolResult] = await batchRead(client, config.network.multicall3, [{ address: config.network.factory, abi: uniswapV3FactoryAbi, functionName: 'getPool', args: [collateral.address, config.network.weth, collateral.wethPoolFee] }], blockNumber)
		const pool = requiredRpcAddress(batchValue(poolResult, 'Collateral/WETH pool'), 'Collateral/WETH pool')
		if (pool === zeroAddress) return { kind: 'unavailable', reason: `No Uniswap V3 collateral/WETH pool exists for ${collateral.address} at fee ${collateral.wethPoolFee.toString()}` }
		const results = await batchRead(
			client,
			config.network.multicall3,
			[
				{ address: pool, abi: poolAbi, functionName: 'liquidity' },
				{ address: pool, abi: poolAbi, functionName: 'slot0' },
				{ address: pool, abi: poolAbi, functionName: 'observe', args: [[config.twapSeconds, 0]] },
			],
			blockNumber,
		)
		if (requiredBigint(batchValue(results[0], 'Collateral/WETH liquidity'), 'Collateral/WETH liquidity') === 0n) return { kind: 'unavailable', reason: `Collateral/WETH pool ${pool} has no liquidity` }
		const slot0 = requiredTuple(batchValue(results[1], 'Collateral/WETH slot0'), 2, 'Collateral/WETH slot0')
		const spotTick = requiredBigint(slot0[1], 'Collateral/WETH tick')
		const observation = requiredTuple(batchValue(results[2], 'Collateral/WETH observation'), 1, 'Collateral/WETH observation')
		const twapTick = meanTick(requiredBigintArray(observation[0], 'Collateral/WETH tick cumulatives'), BigInt(config.twapSeconds))
		if (!spotTwapDeviationWithinLimit(spotTick, twapTick, config.maxSpotTwapTicks)) return { kind: 'unavailable', reason: `Collateral/WETH pool ${pool} exceeds the ${config.maxSpotTwapTicks.toString()} tick spot/TWAP limit` }
		return { kind: 'valued', pool, valuation: valuationFromSqrtPrice(collateral.address, config.network.weth, requiredBigint(slot0[0], 'Collateral/WETH sqrtPriceX96')) }
	} catch (error) {
		if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
		return { kind: 'unavailable', reason: `Collateral/WETH valuation failed: ${errorMessage(error)}` }
	}
}
