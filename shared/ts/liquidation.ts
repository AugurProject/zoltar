export const LIQUIDATION_PRICE_PRECISION = 10n ** 18n
export const LIQUIDATION_BPS_DENOMINATOR = 10_000n
export const LIQUIDATION_REP_BONUS_BPS = 500n

export function getLiquidationRepToMove(debtToMove: bigint, repPerEthPrice: bigint) {
	const numerator = debtToMove * repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS)
	const denominator = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	return (numerator + denominator - 1n) / denominator
}

export function getMaxFundedLiquidationDebt(freeRepAvailable: bigint, repPerEthPrice: bigint) {
	if (freeRepAvailable <= 0n || repPerEthPrice <= 0n) return 0n
	return (freeRepAvailable * LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR) / (repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS))
}
