import type { Address } from '@zoltar/shared/ethereum';
import { type TruthAuctionSettlementBidRow } from '../lib/truthAuctionSettlement.js';
import type { ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js';
import type { ForkAuctionActionResult } from '@zoltar/ui-core-shared/types/contracts.js';
import type { SettlementSelectedBid } from '../../types.js';
type SettlementBidKeyUpdater = string[] | ((currentKeys: string[]) => string[]);
type UseTruthAuctionSettlementActionStateParams = {
    accountAddress: Address | undefined;
    forkAuctionError: string | undefined;
    forkAuctionResult: ForkAuctionActionResult | undefined;
    onClaimAuctionProceeds: (securityPoolAddressOverride?: Address, selectedClaimBids?: readonly SettlementSelectedBid[], selectedRefundBids?: readonly SettlementSelectedBid[], universeIdOverride?: bigint) => void;
    onRefundLosingBids: (securityPoolAddressOverride?: Address, selectedBids?: readonly SettlementSelectedBid[], universeIdOverride?: bigint) => void;
    selectedAuctionPoolAddress: Address | undefined;
    selectedAuctionUniverseId?: bigint | undefined;
    selectedStage: ForkWorkflowSelectionStage;
    settlementBidRows: TruthAuctionSettlementBidRow[];
    truthAuctionFinalized: boolean;
};
export declare function useTruthAuctionSettlementActionState({ accountAddress, forkAuctionError, forkAuctionResult, onClaimAuctionProceeds, onRefundLosingBids, selectedAuctionPoolAddress, selectedAuctionUniverseId, selectedStage, settlementBidRows, truthAuctionFinalized }: UseTruthAuctionSettlementActionStateParams): {
    isSettleSelectedBidsInProgress: boolean;
    selectedSettlementBidKeys: string[];
    setSelectedSettlementBidKeys: (update: SettlementBidKeyUpdater) => void;
    settlementBidResultByKey: Record<string, "claimed" | "refunded">;
    settlementBidResultRefreshToken: number;
    settlementSelectionState: import("../lib/truthAuctionSettlement.js").TruthAuctionSettlementSelectionState;
    submitClaimBidsByKeys: (claimBidKeys: string[]) => void;
    submitRefundBidsByKeys: (refundBidKeys: string[]) => void;
    submitSelectedSettlementBids: () => void;
};
export {};
//# sourceMappingURL=useTruthAuctionSettlementActionState.d.ts.map