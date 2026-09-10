export const LIQUIDATION_PRICE_PRECISION = 10n ** 18n;
export const LIQUIDATION_BPS_DENOMINATOR = 10000n;
export const LIQUIDATION_REP_BONUS_BPS = 500n;
export function getLiquidationVaultRepBackingToTransfer(debtMovedAttoEth, repPerEthPrice) {
    const numerator = debtMovedAttoEth * repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS);
    const denominator = LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR;
    return (numerator + denominator - 1n) / denominator;
}
export function getMaximumFundedDebtAttoEth(transferableVaultRepBackingAttoRep, repPerEthPrice) {
    if (transferableVaultRepBackingAttoRep <= 0n || repPerEthPrice <= 0n)
        return 0n;
    return (transferableVaultRepBackingAttoRep * LIQUIDATION_PRICE_PRECISION * LIQUIDATION_BPS_DENOMINATOR) / (repPerEthPrice * (LIQUIDATION_BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS));
}
