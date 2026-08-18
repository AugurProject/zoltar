import { type ForkAuctionStageView } from '../../truth-auctions/lib/forkAuction.js';
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js';
import type { UserMessagePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
import type { ListedSecurityPool, OracleManagerDetails, ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js';
declare const FORK_WORKFLOW_SELECTION_STAGES: readonly ["fork-triggered", "migration", "auction", "settlement"];
export type ForkWorkflowSelectionStage = (typeof FORK_WORKFLOW_SELECTION_STAGES)[number];
export type SelectedPoolView = 'vaults' | 'trading' | 'reporting' | 'fork-workflow' | 'staged-operations' | 'price-oracle';
export declare const SELECTED_POOL_PRIMARY_VIEWS: readonly SelectedPoolView[];
export declare const SELECTED_POOL_SECONDARY_VIEWS: readonly SelectedPoolView[];
export declare const SELECTED_POOL_VIEWS: readonly SelectedPoolView[];
export declare function getSelectedPoolViewLabel(view: SelectedPoolView): "Vaults" | "Shares" | "Reporting" | "Fork & Migration" | "Staged Operations" | "Price Oracle";
export declare function resolveSelectedPoolView(value: string | undefined): SelectedPoolView;
export declare function isSelectedPoolForkWorkflowView(view: SelectedPoolView): view is "fork-workflow";
export declare function getSelectedPoolViewForForkStage(stage: ForkAuctionStageView): SelectedPoolView;
export declare function resolveForkWorkflowSelectionStage(value: string | undefined): ForkWorkflowSelectionStage | undefined;
export declare function getSelectedPoolViewForForkWorkflowSelectionStage(stage: ForkWorkflowSelectionStage): "fork-workflow" | "fork-migration" | "fork-auction" | "fork-settlement";
export declare function normalizeForkWorkflowSelectionStage(stage: ForkAuctionStageView): ForkWorkflowSelectionStage;
export declare function getCurrentForkWorkflowSelectionStage({ claimingAvailable, currentForkStage, hasForkActivity, systemState, truthAuctionFinalized, }: {
    claimingAvailable?: boolean;
    currentForkStage: ForkAuctionStageView;
    hasForkActivity: boolean;
    systemState: SecurityPoolSystemState | undefined;
    truthAuctionFinalized?: boolean;
}): ForkWorkflowSelectionStage;
export declare function getForkWorkflowStageSelection({ currentStageView, forkAuctionDetails, forkOutcome, previewPool, selectedStageView, stageView, systemState, }: {
    currentStageView: ForkAuctionStageView | undefined;
    forkAuctionDetails: {
        claimingAvailable: boolean;
        hasForkActivity: boolean;
        migratedAttoRep: bigint;
        truthAuction: Pick<TruthAuctionMetrics, 'finalized'> | undefined;
        truthAuctionStartedAt: bigint;
    } | undefined;
    forkOutcome: ListedSecurityPool['forkOutcome'] | undefined;
    previewPool: Pick<ListedSecurityPool, 'hasForkActivity' | 'migratedAttoRep' | 'truthAuctionStartedAt'> | undefined;
    selectedStageView: ForkWorkflowSelectionStage | undefined;
    stageView: ForkAuctionStageView | undefined;
    systemState: SecurityPoolSystemState | undefined;
}): {
    currentStage: ForkAuctionStageView;
    currentWorkflowStage: "migration" | "auction" | "settlement" | "fork-triggered";
    selectedStage: "migration" | "auction" | "settlement" | "fork-triggered";
};
export declare function getSelectedPoolForkWorkflowView({ forkAuctionDetails, selectedPool, }: {
    forkAuctionDetails: {
        claimingAvailable: boolean;
        forkOutcome: ListedSecurityPool['forkOutcome'];
        migratedAttoRep: bigint;
        systemState: SecurityPoolSystemState;
        truthAuction: Pick<TruthAuctionMetrics, 'finalized'> | undefined;
        truthAuctionStartedAt: bigint;
    } | undefined;
    selectedPool: (Pick<ListedSecurityPool, 'forkOutcome' | 'migratedAttoRep' | 'systemState' | 'truthAuctionStartedAt'> & {
        hasForkActivity?: boolean;
    }) | undefined;
}): SelectedPoolView;
export declare function getCurrentSelectedPoolForkStage({ forkAuctionDetails, selectedPool, }: {
    forkAuctionDetails: {
        claimingAvailable: boolean;
        forkOutcome: ListedSecurityPool['forkOutcome'];
        migratedAttoRep: bigint;
        systemState: SecurityPoolSystemState;
        truthAuction: Pick<TruthAuctionMetrics, 'finalized'> | undefined;
        truthAuctionStartedAt: bigint;
    } | undefined;
    selectedPool: (Pick<ListedSecurityPool, 'forkOutcome' | 'migratedAttoRep' | 'systemState' | 'truthAuctionStartedAt'> & {
        hasForkActivity?: boolean;
    }) | undefined;
}): ForkAuctionStageView;
export declare function hasCurrentSelectedPoolForkActivity({ forkAuctionDetails, selectedPool, }: {
    forkAuctionDetails: {
        forkOutcome: ListedSecurityPool['forkOutcome'];
        migratedAttoRep: bigint;
        systemState: SecurityPoolSystemState;
        truthAuctionStartedAt: bigint;
    } | undefined;
    selectedPool: Pick<ListedSecurityPool, 'forkOutcome' | 'hasForkActivity' | 'migratedAttoRep' | 'systemState' | 'truthAuctionStartedAt'> | undefined;
}): boolean;
export declare function getCurrentSelectedPoolForkAuctionDetails<T extends {
    systemState: SecurityPoolSystemState;
}>({ forkAuctionDetails, selectedPool }: {
    forkAuctionDetails: T | undefined;
    selectedPool: {
        hasForkActivity?: boolean;
        systemState: SecurityPoolSystemState;
    } | undefined;
}): T | undefined;
export declare function shouldReloadSelectedPoolDetails({ currentDetailsAvailable, lastHandledRefreshNonce, loadedDetailsAddress, refreshNonce, selectedPoolAddress, }: {
    currentDetailsAvailable: boolean;
    lastHandledRefreshNonce: number;
    loadedDetailsAddress: string | undefined;
    refreshNonce: number;
    selectedPoolAddress: string | undefined;
}): boolean;
export declare function getCurrentSelectedPoolReportingDetails({ reportingDetails, selectedPool }: {
    reportingDetails: ReportingDetails | undefined;
    selectedPool: Pick<ListedSecurityPool, 'hasForkActivity' | 'questionOutcome' | 'systemState'> | undefined;
}): ReportingDetails | undefined;
export declare function shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists, selectedPoolUniverseMismatch }: {
    hasSelectedPoolAddress: boolean;
    selectedPoolExists: boolean;
    selectedPoolUniverseMismatch: boolean;
}): boolean;
export declare function getSelectedPoolCardTitle(questionTitle?: string): string;
export declare function applySelectedPoolWorkflowState(pool: ListedSecurityPool | undefined, { questionOutcome, systemState, }: {
    questionOutcome: ReportingOutcomeKey | 'none' | undefined;
    systemState: SecurityPoolSystemState | undefined;
}): ListedSecurityPool | undefined;
export declare function getSelectedPoolWorkflowGuardMessage({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: {
    hasSelectedPoolAddress: boolean;
    selectedPoolLookupState: LoadableValueState;
    selectedPoolUniverseMismatch: boolean;
}): "Loading pool…" | "Select a valid pool before using pool actions." | "Select a pool before using pool actions." | undefined;
export declare function getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }: {
    hasSelectedPoolAddress: boolean;
    selectedPoolLookupState: LoadableValueState;
    selectedPoolUniverseMismatch: boolean;
}): UserMessagePresentation;
export declare function isForkWorkflowDisabled(selectedPoolState: SecurityPoolSystemState | undefined, selectedPoolHasForkActivity?: boolean): boolean;
export declare function getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails, selectedPoolManagerAddress }: {
    poolOracleManagerDetails: OracleManagerDetails | undefined;
    selectedPoolManagerAddress: string | undefined;
}): OracleManagerDetails | undefined;
export declare function getSelectedPoolOracleMetricValues({ lastOraclePrice, lastOracleSettlementTimestamp }: Pick<ListedSecurityPool, 'lastOraclePrice' | 'lastOracleSettlementTimestamp'>): {
    lastPrice: bigint;
    lastSettlementTimestamp: bigint;
};
export {};
//# sourceMappingURL=securityPoolWorkflow.d.ts.map