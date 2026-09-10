export declare const LIQUIDATION_PRICE_PRECISION: bigint;
export declare const LIQUIDATION_BPS_DENOMINATOR = 10000n;
export declare const LIQUIDATION_REP_BONUS_BPS = 500n;
export declare function getLiquidationVaultRepBackingToTransfer(debtMovedAttoEth: bigint, repPerEthPrice: bigint): bigint;
export declare function getMaximumFundedDebtAttoEth(transferableVaultRepBackingAttoRep: bigint, repPerEthPrice: bigint): bigint;
