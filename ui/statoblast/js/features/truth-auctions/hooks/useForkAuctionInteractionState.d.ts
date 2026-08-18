import type { Address } from '@zoltar/shared/ethereum';
import type { ForkAuctionSectionProps } from '../../types.js';
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type PendingParentEscalationClaimSelection = {
    depositIndexes: bigint[];
    outcome: ReportingOutcomeKey;
};
type UseForkAuctionInteractionStateParameters = {
    accountAddress: Address | undefined;
    connectedWalletDisputeStakedAttoRep: bigint | undefined;
    forkAuctionActiveAction: ForkAuctionSectionProps['forkAuctionActiveAction'];
    forkAuctionError: string | undefined;
    forkAuctionResult: ForkAuctionSectionProps['forkAuctionResult'];
    hasStartedTruthAuction: boolean;
    reportingDetails: ForkAuctionSectionProps['reportingDetails'];
    securityPoolAddress: Address | undefined;
    startTruthAuctionSecurityPoolAddress: Address | undefined;
};
export declare function useForkAuctionInteractionState({ accountAddress, connectedWalletDisputeStakedAttoRep, forkAuctionActiveAction, forkAuctionError, forkAuctionResult, hasStartedTruthAuction, reportingDetails, securityPoolAddress, startTruthAuctionSecurityPoolAddress }: UseForkAuctionInteractionStateParameters): {
    beginStartTruthAuctionProgress: () => void;
    beginVaultMigrationProgress: () => void;
    hasCompletedVaultMigration: boolean;
    isStartTruthAuctionInProgressState: boolean;
    isVaultMigrationPending: boolean;
    optimisticClaimedParentDisputeStakedRep: bigint;
    setPendingParentEscalationClaimSelection: import("preact/hooks").Dispatch<import("preact/hooks").StateUpdater<PendingParentEscalationClaimSelection | undefined>>;
};
export {};
//# sourceMappingURL=useForkAuctionInteractionState.d.ts.map