type LocalSettlementBidStatus = 'claimed' | 'refunded';
export type TruthAuctionSettlementAction = 'claimAuctionProceeds' | 'refundLosingBids';
export declare function getTruthAuctionSettlementAction({ selectionHasClaims, selectionHasRefunds, truthAuctionFinalized }: {
    selectionHasClaims: boolean;
    selectionHasRefunds: boolean;
    truthAuctionFinalized: boolean;
}): TruthAuctionSettlementAction | undefined;
type TruthAuctionSettlementPendingAction = {
    action: TruthAuctionSettlementAction;
    claimKeys: string[];
    ignoredResultHash: string | undefined;
    refundKeys: string[];
};
export type TruthAuctionSettlementActionState = {
    pendingAction: TruthAuctionSettlementPendingAction | undefined;
    refreshToken: number;
    resultByKey: Record<string, LocalSettlementBidStatus>;
    selectedBidKeys: string[];
};
export type TruthAuctionSettlementActionStateEvent = {
    type: 'reset';
} | {
    type: 'selectBidKeys';
    selectedBidKeys: string[];
} | {
    type: 'submit';
    action: TruthAuctionSettlementAction;
    claimKeys: string[];
    ignoredResultHash: string | undefined;
    refundKeys: string[];
} | {
    type: 'transactionFailed';
} | {
    type: 'transactionSucceeded';
    action: TruthAuctionSettlementAction;
} | {
    type: 'pruneUnavailableBids';
    availableBidKeys: string[];
};
export declare function createTruthAuctionSettlementActionState(): TruthAuctionSettlementActionState;
export declare function reduceTruthAuctionSettlementActionState(state: TruthAuctionSettlementActionState, event: TruthAuctionSettlementActionStateEvent): TruthAuctionSettlementActionState;
export {};
//# sourceMappingURL=truthAuctionSettlementActionState.d.ts.map