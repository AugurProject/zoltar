import type { Address } from '@zoltar/shared/ethereum';
import { buildForkCarriedEscalationProofs } from '../../../protocol/index.js';
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import type { ForkAuctionFormState, WriteOperationsParameters } from '../../../types/app.js';
import type { ForkAuctionActionResult, ForkAuctionDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
import type { SettlementSelectedBid } from '../../types.js';
type UseForkAuctionOperationsParameters = WriteOperationsParameters & {
    selectedSecurityPoolAddress?: string;
};
type ForkAuctionReadClient = {
    getBalance: (parameters: {
        address: Address;
    }) => Promise<bigint>;
};
type ForkAuctionProductionWriteClient = ReturnType<typeof createWalletWriteClient>;
type ForkCarriedEscalationProofs = Awaited<ReturnType<typeof buildForkCarriedEscalationProofs>>;
export type UseForkAuctionOperationsDependencies<TWriteClient = ForkAuctionProductionWriteClient> = {
    buildForkCarriedEscalationProofs: (securityPoolAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]) => Promise<ForkCarriedEscalationProofs>;
    createChildUniverseFromSecurityPool: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) => Promise<ForkAuctionActionResult>;
    createConnectedReadClient: () => ForkAuctionReadClient;
    createWalletWriteClient: (walletAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient;
    finalizeSecurityPoolTruthAuction: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>;
    forkUniverseDirectly: (client: TWriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address) => Promise<ForkAuctionActionResult>;
    forkZoltarWithOwnEscalation: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>;
    initiateSecurityPoolFork: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>;
    loadForkAuctionDetails: (securityPoolAddress: Address) => Promise<ForkAuctionDetails>;
    claimParentEscalationDeposits: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]) => Promise<ForkAuctionActionResult>;
    migrateRepToZoltarFromSecurityPool: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]) => Promise<ForkAuctionActionResult>;
    migrateSecurityVault: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) => Promise<ForkAuctionActionResult>;
    migrateVaultWithUnresolvedEscalation: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey) => Promise<ForkAuctionActionResult>;
    refundTruthAuctionBid: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, selectedBids?: readonly SettlementSelectedBid[]) => Promise<ForkAuctionActionResult>;
    settleTruthAuctionBids: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, claimTickIndices: readonly SettlementSelectedBid[], refundTickIndices: readonly SettlementSelectedBid[]) => Promise<ForkAuctionActionResult>;
    startTruthAuctionForSecurityPool: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint) => Promise<ForkAuctionActionResult>;
    submitTruthAuctionBid: (client: TWriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) => Promise<ForkAuctionActionResult>;
    withdrawForkedEscalationDeposits: (client: TWriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, proofs: ForkCarriedEscalationProofs) => Promise<ForkAuctionActionResult>;
};
declare function useForkAuctionOperationsWithDependencies<TWriteClient>({ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseForkAuctionOperationsParameters, dependencies: UseForkAuctionOperationsDependencies<TWriteClient>): {
    claimAuctionProceeds: (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[], universeIdOverride?: bigint) => Promise<void>;
    createChildUniverse: (outcome: ReportingOutcomeKey | bigint) => Promise<void>;
    forkAuctionActiveAction: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction | undefined;
    forkAuctionDetails: ForkAuctionDetails | undefined;
    forkAuctionError: string | undefined;
    forkAuctionFeedback: ActionFeedback<import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction> | undefined;
    forkAuctionForm: ForkAuctionFormState;
    forkAuctionResult: ForkAuctionActionResult | undefined;
    forkUniverse: () => Promise<void>;
    forkWithOwnEscalation: () => Promise<void>;
    initiateFork: () => Promise<void>;
    loadForkAuction: (securityPoolAddressOverride?: Address) => Promise<void>;
    loadingForkAuctionDetails: boolean;
    claimParentEscalation: ({ depositIndexes, outcome, vaultAddress }?: {
        depositIndexes?: bigint[];
        outcome?: ReportingOutcomeKey;
        vaultAddress?: Address;
    }) => Promise<void>;
    migrateUnresolvedEscalation: (selectedChildOutcome: ReportingOutcomeKey) => Promise<void>;
    migrateRepToZoltar: (outcomesOverride?: ReportingOutcomeKey[]) => Promise<void>;
    migrateVault: () => Promise<void>;
    refundLosingBids: (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[], universeIdOverride?: bigint) => Promise<void>;
    setForkAuctionForm: (updater: (current: ForkAuctionFormState) => ForkAuctionFormState) => void;
    settleForkedEscalation: (outcome: ReportingOutcomeKey, parentDepositIndexes: bigint[]) => Promise<void>;
    startTruthAuction: (securityPoolAddressOverride?: Address, universeIdOverride?: bigint) => Promise<void>;
    submitBid: (securityPoolAddressOverride?: Address, universeIdOverride?: bigint) => Promise<void>;
    finalizeTruthAuction: (securityPoolAddressOverride?: Address, universeIdOverride?: bigint) => Promise<void>;
};
export declare function useForkAuctionOperations(parameters: UseForkAuctionOperationsParameters): ReturnType<typeof useForkAuctionOperationsWithDependencies<ForkAuctionProductionWriteClient>>;
export declare function useForkAuctionOperations<TWriteClient>(parameters: UseForkAuctionOperationsParameters, dependencies: UseForkAuctionOperationsDependencies<TWriteClient>): ReturnType<typeof useForkAuctionOperationsWithDependencies<TWriteClient>>;
export {};
//# sourceMappingURL=useForkAuctionOperations.d.ts.map