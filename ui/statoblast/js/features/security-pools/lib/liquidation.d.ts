import type { SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function isVaultHealthyAtFactor({ disputeStakedAttoRep, healthFactorBps, openInterestAttoEth, poolHeldVaultRepBackingAttoRep, poolSecurityMultiplierBps, repPerEthPrice, }: {
    disputeStakedAttoRep?: bigint | undefined;
    healthFactorBps: bigint;
    openInterestAttoEth: bigint;
    poolHeldVaultRepBackingAttoRep: bigint;
    poolSecurityMultiplierBps: bigint;
    repPerEthPrice: bigint;
}): boolean;
export declare function getLiquidationExecutionFailureDetail(errorMessage: string | undefined): string | undefined;
export declare function getMaxLiquidationAmount({ repPerEthPrice, statoblastSecurityMultiplierBps, targetVaultSummary }: {
    repPerEthPrice: bigint | undefined;
    statoblastSecurityMultiplierBps: bigint | undefined;
    targetVaultSummary: SecurityPoolVaultSummary | undefined;
}): bigint | undefined;
type LiquidationSimulation = {
    callerAfter: {
        disputeStakedAttoRep: bigint;
        vaultAttoRepBacking: bigint;
        capacityOwnershipAttoRep: bigint;
    };
    callerBefore: {
        disputeStakedAttoRep: bigint;
        vaultAttoRepBacking: bigint;
        capacityOwnershipAttoRep: bigint;
    };
    debtMovedAttoEth: bigint;
    capacityOwnershipMovedAttoRep: bigint;
    badDebtAttoEth: bigint;
    grossRepAwardAttoRep: bigint;
    vaultAttoRepBackingToTransfer: bigint;
    targetAccruedFeesRetained: bigint;
    targetAfter: {
        disputeStakedAttoRep: bigint;
        vaultAttoRepBacking: bigint;
        capacityOwnershipAttoRep: bigint;
    };
    targetBefore: {
        disputeStakedAttoRep: bigint;
        vaultAttoRepBacking: bigint;
        capacityOwnershipAttoRep: bigint;
    };
};
export declare function simulateLiquidation({ callerVaultSummary, requestedDebtAttoEth, totalCapacityOwnershipAttoRep, minimumVaultRepDepositAttoRep, repPerEthPrice, settlementCollateralAttoEth, statoblastSecurityMultiplierBps, targetVaultSummary, }: {
    callerVaultSummary: SecurityPoolVaultSummary | undefined;
    requestedDebtAttoEth: bigint;
    totalCapacityOwnershipAttoRep: bigint;
    minimumVaultRepDepositAttoRep?: bigint | undefined;
    repPerEthPrice: bigint;
    settlementCollateralAttoEth: bigint;
    statoblastSecurityMultiplierBps: bigint;
    targetVaultSummary: SecurityPoolVaultSummary;
}): LiquidationSimulation;
export declare function getDeterministicLiquidationFailureReason({ callerVaultSummary, requestedDebtAttoEth, totalCapacityOwnershipAttoRep, maxLiquidationDebtAttoEth, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, repPerEthPrice, settlementCollateralAttoEth, statoblastSecurityMultiplierBps, targetVaultSummary, }: {
    callerVaultSummary: SecurityPoolVaultSummary | undefined;
    requestedDebtAttoEth: bigint | undefined;
    totalCapacityOwnershipAttoRep?: bigint | undefined;
    maxLiquidationDebtAttoEth?: bigint | undefined;
    minimumSecurityBondDebtAttoEth?: bigint | undefined;
    minimumVaultRepDepositAttoRep?: bigint | undefined;
    repPerEthPrice?: bigint | undefined;
    settlementCollateralAttoEth?: bigint | undefined;
    statoblastSecurityMultiplierBps?: bigint | undefined;
    targetVaultSummary: SecurityPoolVaultSummary | undefined;
}): "No capacity ownership is transferable at the current target-side bounds." | "The target vault would fall below the minimum REP backing after liquidation." | "The target vault would fall below the minimum security-bond debt after liquidation." | "The receiver vault would remain below the minimum REP backing after liquidation." | "Enter a valid liquidation amount." | "Enter a liquidation amount greater than zero." | "Target vault details are still loading." | "Target vault live open interest is still loading." | "This vault has no open interest to liquidate." | "This vault is not undercollateralized at the current Open Oracle price." | "Receiver vault live open interest is still loading." | "The selected receiver would remain below the minimum security-bond debt after liquidation." | "No capacity ownership would move with the liquidation debt." | undefined;
export declare function getLiquidationFailureReason({ callerVaultSummary, requestedDebtAttoEth, totalCapacityOwnershipAttoRep, minimumReceiverHealthFactorBps, minimumSecurityBondDebtAttoEth, minimumVaultRepDepositAttoRep, repPerEthPrice, settlementCollateralAttoEth, statoblastSecurityMultiplierBps, targetVaultSummary, }: {
    callerVaultSummary: SecurityPoolVaultSummary | undefined;
    requestedDebtAttoEth: bigint | undefined;
    totalCapacityOwnershipAttoRep: bigint;
    minimumReceiverHealthFactorBps?: bigint | undefined;
    minimumSecurityBondDebtAttoEth?: bigint | undefined;
    minimumVaultRepDepositAttoRep?: bigint | undefined;
    repPerEthPrice: bigint | undefined;
    settlementCollateralAttoEth: bigint;
    statoblastSecurityMultiplierBps: bigint | undefined;
    targetVaultSummary: SecurityPoolVaultSummary | undefined;
}): "No capacity ownership is transferable at the current target-side bounds." | "The target vault would fall below the minimum REP backing after liquidation." | "The target vault would fall below the minimum security-bond debt after liquidation." | "The receiver vault would remain below the minimum REP backing after liquidation." | "Enter a valid liquidation amount." | "Enter a liquidation amount greater than zero." | "Target vault details are still loading." | "Target vault live open interest is still loading." | "This vault has no open interest to liquidate." | "This vault is not undercollateralized at the current Open Oracle price." | "Receiver vault live open interest is still loading." | "The selected receiver would remain below the minimum security-bond debt after liquidation." | "No capacity ownership would move with the liquidation debt." | "Refresh the Open Oracle before executing liquidation." | "The receiver vault would fall below the approved minimum post-liquidation health factor." | "The receiver vault would remain liquidatable after this liquidation." | "The receiver vault would become liquidatable after this liquidation." | undefined;
export {};
//# sourceMappingURL=liquidation.d.ts.map