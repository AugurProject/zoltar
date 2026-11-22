import type { Address } from '@zoltar/bot-shared/ethereum'
import { STANDARD_UNISWAP_FEES, type StandardUniswapFee } from '#core/uniswap-v4'

/**
 * A report collateral (`token1`) other than WETH that the operator allowlisted. Its WETH value comes from the canonical
 * Uniswap V3 factory's collateral/WETH pool at `wethPoolFee`, read at the evaluated block under the same spot/TWAP limit
 * as the hedge pools, so profit, capital caps, and the market-consensus check stay denominated in WETH.
 */
export type CollateralToken = {
	address: Address
	wethPoolFee: StandardUniswapFee
}

/** `attoWeth` WETH base units are worth `units` collateral base units. WETH itself is valued one to one. */
export type CollateralValuation = {
	attoWeth: bigint
	units: bigint
}

export const WETH_VALUATION: CollateralValuation = { attoWeth: 1n, units: 1n }

/** Rounds toward negative infinity for `down` and toward positive infinity for `up`, so signed profits stay conservative. */
function divide(numerator: bigint, denominator: bigint, rounding: 'down' | 'up') {
	const quotient = numerator / denominator
	const remainder = numerator % denominator
	if (remainder === 0n) return quotient
	if (rounding === 'down') return numerator < 0n ? quotient - 1n : quotient
	return numerator > 0n ? quotient + 1n : quotient
}

/** Values a collateral amount in atto-WETH; proceeds and profits round down, costs and capital at risk round up. */
export function attoWethValue(valuation: CollateralValuation, amount: bigint, rounding: 'down' | 'up') {
	if (valuation.attoWeth <= 0n || valuation.units <= 0n) throw new Error('Collateral valuation must be positive')
	return divide(amount * valuation.attoWeth, valuation.units, rounding)
}

/** Converts the collateral/WETH pool's marginal price into a valuation; Uniswap orders the pool's tokens by address. */
export function valuationFromSqrtPrice(collateral: Address, weth: Address, sqrtPriceX96: bigint): CollateralValuation {
	if (sqrtPriceX96 <= 0n) throw new Error('Collateral/WETH marginal price is unavailable')
	const squared = sqrtPriceX96 * sqrtPriceX96
	// With collateral as token0 the pool price is WETH per collateral; otherwise it is collateral per WETH.
	return BigInt(collateral) < BigInt(weth) ? { attoWeth: squared, units: 2n ** 192n } : { attoWeth: 2n ** 192n, units: squared }
}

export function isStandardUniswapFee(value: number): value is StandardUniswapFee {
	return STANDARD_UNISWAP_FEES.some(fee => fee === value)
}

export function allowlistedCollateral(collateralTokens: readonly CollateralToken[], token: Address) {
	return collateralTokens.find(collateral => collateral.address.toLowerCase() === token.toLowerCase())
}

export function unlistedCollateralReason(token: Address) {
	return `Report token1 ${token} is neither WETH nor an allowlisted collateral token`
}
