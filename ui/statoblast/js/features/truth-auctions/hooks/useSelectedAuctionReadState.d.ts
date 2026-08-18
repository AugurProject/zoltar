import type { Address } from '@zoltar/shared/ethereum';
import { type ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js';
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type UseSelectedAuctionReadStateParameters = {
    accountAddress: Address | undefined;
    currentSelectedOutcomePool: ListedSecurityPool | undefined;
    forkAuctionResultHash: string | undefined;
    forkMigrationReadClient: Pick<ReadClient, 'readContract'> | undefined;
    fullTruthAuctionReadClient: ReadClient | undefined;
    securityPoolAddress: Address | undefined;
    selectedAuctionLabel: string;
    selectedOutcome: ReportingOutcomeKey;
    selectedOutcomeMigrationChildPool: ListedSecurityPool | undefined;
    selectedPoolRefreshNonce: number;
    selectedStage: ForkWorkflowSelectionStage;
    universeId: bigint | undefined;
};
export declare function useSelectedAuctionReadState({ accountAddress, currentSelectedOutcomePool, forkAuctionResultHash, forkMigrationReadClient, fullTruthAuctionReadClient, securityPoolAddress, selectedAuctionLabel, selectedOutcome, selectedOutcomeMigrationChildPool, selectedPoolRefreshNonce, selectedStage, universeId, }: UseSelectedAuctionReadStateParameters): {
    loadingSelectedAuctionChildPoolRecovery: boolean;
    loadingSelectedAuctionDetails: boolean;
    loadingSelectedOutcomeMigrationSeedStatus: boolean;
    retryingSelectedAuctionDetails: boolean;
    retrySelectedAuctionChildPoolRecovery: () => void;
    retrySelectedAuctionDetails: () => void;
    retrySelectedOutcomeMigrationSeedStatus: () => void;
    selectedAuctionChildPoolRecoveryError: string | undefined;
    selectedAuctionChildPool: ListedSecurityPool | undefined;
    selectedAuctionPoolAddress: `0x${string}` | undefined;
    selectedAuctionDetails: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionDetails | undefined;
    selectedAuctionError: string | undefined;
    selectedOutcomeMigrationSeedStatus: {
        childPoolRepBalanceAttoRep: bigint;
        childRepToken: undefined;
        childUniverseId: bigint;
        migrationProxyAddress: `0x${string}`;
        pendingProxyRepBalanceAttoRep: bigint;
        seeded: boolean;
    } | {
        childPoolRepBalanceAttoRep: bigint;
        childRepToken: `0x${string}`;
        childUniverseId: bigint;
        migrationProxyAddress: `0x${string}`;
        pendingProxyRepBalanceAttoRep: bigint;
        seeded: boolean;
    } | undefined;
    selectedOutcomeMigrationSeedStatusError: string | undefined;
};
export {};
//# sourceMappingURL=useSelectedAuctionReadState.d.ts.map