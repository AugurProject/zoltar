import type { Address } from '@zoltar/shared/ethereum';
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function getStatoblastSecurityMultiplierValidationMessage(statoblastSecurityMultiplier: string): "Enter a Statoblast security multiplier of at least 1.0002x." | "Enter a multiplier in x with at most 4 decimal places." | "Statoblast security multiplier must be at least 1.0002x." | undefined;
export declare function getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeGwei: string): "Enter an initial-report priority fee in gwei." | "Enter a gwei value with at most 9 decimal places." | "Initial-report priority fee must be greater than 0 gwei." | "Initial-report priority fee is too large for Open Oracle report limits." | undefined;
export declare function getSecurityPoolCreateDisabledReason({ accountAddress, checkingDuplicateOriginPool, duplicateOriginPoolExists, initialReportPriorityFeeGwei, isOnActiveAppChain, marketDetails, securityPoolCreating, statoblastSecurityMultiplier, zoltarUniverseHasForked, }: {
    accountAddress: Address | undefined;
    checkingDuplicateOriginPool: boolean;
    duplicateOriginPoolExists: boolean;
    initialReportPriorityFeeGwei: string;
    isOnActiveAppChain: boolean;
    marketDetails: MarketDetails | undefined;
    securityPoolCreating: boolean;
    statoblastSecurityMultiplier: string;
    zoltarUniverseHasForked: boolean;
}): string | undefined;
//# sourceMappingURL=securityPoolCreationGuards.d.ts.map