export const LIQUIDATION_PRICE_PRECISION = 10n ** 18n
export const LIQUIDATION_BPS_DENOMINATOR = 10_000n

export function getBundledLiquidationRepToMove(debtToMove: bigint, targetAllowance: bigint, targetFreeRep: bigint) {
	if (targetAllowance === 0n) return 0n
	return debtToMove === targetAllowance ? targetFreeRep : (targetFreeRep * debtToMove) / targetAllowance
}
