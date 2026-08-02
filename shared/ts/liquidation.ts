export const LIQUIDATION_PRICE_PRECISION = 10n ** 18n
export const LIQUIDATION_BPS_DENOMINATOR = 10_000n
export const LIQUIDATION_REP_BONUS_BPS = 500n

export function getLiquidationRepToMove(debtToMove: bigint, repPerEthPrice: bigint, escalationRepToMove = 0n) {
	const numerator = debtToMove * repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS)
	const denominator = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	const grossRepAward = (numerator + denominator - 1n) / denominator
	return escalationRepToMove >= grossRepAward ? 0n : grossRepAward - escalationRepToMove
}
