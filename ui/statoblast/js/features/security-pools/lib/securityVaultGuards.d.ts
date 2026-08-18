import type { Address } from '@zoltar/shared/ethereum';
export declare function getTargetHealthFactorGuardMessage(targetHealthFactor: string): string | undefined;
export declare function getVaultDepositGuardMessage({ approvalSatisfied, depositAmount, isDepositBelowMinimum, minimumVaultRepDepositAttoRep, targetHealthFactor, walletRepShortfallAttoRep, }: {
    approvalSatisfied: boolean;
    depositAmount: bigint | undefined;
    isDepositBelowMinimum: boolean;
    minimumVaultRepDepositAttoRep?: bigint | undefined;
    targetHealthFactor?: string | undefined;
    walletRepShortfallAttoRep: bigint | undefined;
}): string | undefined;
export declare function getVaultWithdrawGuardMessage({ bufferRequiredEthCost, disputeStakedAttoRep, requiredCostAttoEth, stagedOperationTimeoutMinutes, withdrawAmount, withdrawableRepAmountAttoRep, walletBalanceAttoEth, }: {
    bufferRequiredEthCost?: boolean | undefined;
    disputeStakedAttoRep?: bigint | undefined;
    requiredCostAttoEth: bigint | undefined;
    stagedOperationTimeoutMinutes: bigint | undefined;
    withdrawAmount: bigint | undefined;
    withdrawableRepAmountAttoRep: bigint | undefined;
    walletBalanceAttoEth: bigint | undefined;
}): string | undefined;
export declare function getVaultRedeemRepGuardMessage({ disputeStakedAttoRep, redeemableRepAmountAttoRep }: {
    disputeStakedAttoRep: bigint | undefined;
    redeemableRepAmountAttoRep: bigint | undefined;
}): "Settle escalation deposits before redeeming REP." | "No redeemable REP is available for this vault." | undefined;
export declare function getVaultRequestPriceGuardMessage({ accountAddress, hasLoadedSelectedPool, bufferRequiredEthCost, isOnActiveAppChain, isPriceValid, pendingReportId, requiredCostAttoEth, walletBalanceAttoEth, }: {
    accountAddress: Address | undefined;
    hasLoadedSelectedPool: boolean;
    bufferRequiredEthCost?: boolean | undefined;
    isOnActiveAppChain: boolean;
    isPriceValid: boolean | undefined;
    pendingReportId: bigint | undefined;
    requiredCostAttoEth: bigint | undefined;
    walletBalanceAttoEth: bigint | undefined;
}): string | undefined;
export declare function getVaultExecutePendingOperationGuardMessage({ accountAddress, hasLoadedOracleManager, isOnActiveAppChain, isPriceValid, resolvedPendingOperationId, }: {
    accountAddress: Address | undefined;
    hasLoadedOracleManager: boolean;
    isOnActiveAppChain: boolean;
    isPriceValid: boolean | undefined;
    resolvedPendingOperationId: bigint | undefined;
}): string | undefined;
//# sourceMappingURL=securityVaultGuards.d.ts.map