export const LIQUIDATION_PRICE_PRECISION = 10n ** 18n
export const LIQUIDATION_BPS_DENOMINATOR = 10_000n
const LIQUIDATION_REP_BONUS_BPS = 500n

export function getLiquidationVaultRepBackingToTransfer(debtMovedAttoEth: bigint, repPerEthPrice: bigint) {
	const numerator = debtMovedAttoEth * repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS)
	const denominator = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR
	return (numerator + denominator - 1n) / denominator
}

/**
 * Mirrors the migration security multiplier in `SecurityPoolUtils`: half of the pool
 * multiplier's excess over 100%, floored at the liquidation REP reserve.
 */
export function getLiquidationMigrationSecurityMultiplierBps(poolSecurityMultiplierBps: bigint) {
	const configuredMultiplierBps = LIQUIDATION_BPS_DENOMINATOR + (poolSecurityMultiplierBps - LIQUIDATION_BPS_DENOMINATOR) / 2n
	const liquidationReserveMultiplierBps = LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS
	return configuredMultiplierBps < liquidationReserveMultiplierBps ? liquidationReserveMultiplierBps : configuredMultiplierBps
}
