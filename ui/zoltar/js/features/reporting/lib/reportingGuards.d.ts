import type { Address } from '@zoltar/shared/ethereum';
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type ReportingStatus = 'missing' | 'not-started' | 'active';
export declare function getReportingReportGuardMessage({ actualDepositAmount, accountAddress, contributionPreviewReason, isOnActiveAppChain, remainingSelectedOutcomeCapacity, reportAmount, reportingStatus, selectedOutcome, selectedAmount, viewerPoolHeldVaultRepBackingAttoRep, viewerVaultExists, }: {
    actualDepositAmount: bigint | undefined;
    accountAddress: Address | undefined;
    contributionPreviewReason: string | undefined;
    isOnActiveAppChain: boolean;
    remainingSelectedOutcomeCapacity: bigint | undefined;
    reportAmount: string;
    reportingStatus: ReportingStatus;
    selectedOutcome: ReportingOutcomeKey | undefined;
    selectedAmount: bigint | undefined;
    viewerPoolHeldVaultRepBackingAttoRep: bigint | undefined;
    viewerVaultExists: boolean;
}): string | undefined;
export declare function getReportingWithdrawGuardMessage({ accountAddress, isOnActiveAppChain, reportingStatus }: {
    accountAddress: Address | undefined;
    isOnActiveAppChain: boolean;
    reportingStatus: ReportingStatus;
}): string | undefined;
export {};
//# sourceMappingURL=reportingGuards.d.ts.map