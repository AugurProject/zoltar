import { getTruthAuctionSettlementBidKey } from './truthAuctionSettlement.js';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { getTruthAuctionBidDisposition, getTruthAuctionDispositionClassName, getTruthAuctionPriceAtTick } from './truthAuctionBook.js';
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
export function buildTruthAuctionBidRows({ bids, truthAuction }) {
    if (truthAuction === undefined)
        return [];
    return bids.map(bid => {
        const disposition = getTruthAuctionBidDisposition(bid, truthAuction);
        return {
            bidder: bid.bidder,
            cumulativeBidAttoEth: bid.cumulativeBidAttoEth,
            bidAmountAttoEth: bid.bidAmountAttoEth,
            key: `aggregate:${bid.tick.toString()}:${bid.bidIndex.toString()}`,
            price: getTruthAuctionPriceAtTick(bid.tick),
            statusLabel: disposition.label,
            statusToneClassName: getTruthAuctionDispositionClassName(disposition.tone),
        };
    });
}
export function buildViewerTruthAuctionBidRows({ accountAddress, isSettlementInProgress, selectedBidKeys, selectedStage, settlementResultByKey, truthAuction, viewerBids, }) {
    if (truthAuction === undefined) {
        return {
            rows: [],
            showSettlementActionColumn: false,
        };
    }
    const bidsWithDisposition = viewerBids.map(bid => ({
        bid,
        disposition: getTruthAuctionBidDisposition(bid, truthAuction),
    }));
    const showSettlementActionColumn = selectedStage === 'settlement' && bidsWithDisposition.some(({ bid, disposition }) => sameAddress(bid.bidder, accountAddress) && (disposition.canPrefillRefund || disposition.canPrefillSettle));
    const rows = bidsWithDisposition.map(({ bid, disposition }) => {
        const isSettlementBid = sameAddress(bid.bidder, accountAddress) && (disposition.canPrefillRefund || disposition.canPrefillSettle);
        const settlementBidKey = getTruthAuctionSettlementBidKey(bid);
        const inSessionSettlementResult = settlementResultByKey[settlementBidKey];
        const isSettlementBidActions = selectedStage === 'settlement' && isSettlementBid && inSessionSettlementResult === undefined && !isSettlementInProgress;
        const isSettlementBidSelectable = inSessionSettlementResult === undefined && !isSettlementInProgress;
        const settlementControlLabel = `Select ${disposition.label.toLowerCase()} bid ${bid.bidIndex.toString()}: ${formatCurrencyInputBalance(bid.bidAmountAttoEth)} ETH at ${formatCurrencyInputBalance(getTruthAuctionPriceAtTick(bid.tick))} ETH/REP`;
        const statusLabel = (() => {
            if (inSessionSettlementResult === 'claimed')
                return 'Claimed';
            if (inSessionSettlementResult === 'refunded')
                return 'Refunded';
            return disposition.label;
        })();
        const statusToneClassName = (() => {
            if (inSessionSettlementResult === 'claimed')
                return 'is-success';
            if (inSessionSettlementResult === 'refunded')
                return 'is-default';
            return getTruthAuctionDispositionClassName(disposition.tone);
        })();
        return {
            bidAmountAttoEth: bid.bidAmountAttoEth,
            key: `viewer:${bid.tick.toString()}:${bid.bidIndex.toString()}`,
            price: getTruthAuctionPriceAtTick(bid.tick),
            settlementControl: showSettlementActionColumn
                ? {
                    ariaLabel: isSettlementBidActions ? settlementControlLabel : 'Bid is not settlement-eligible',
                    bidKey: settlementBidKey,
                    checked: isSettlementBidActions ? selectedBidKeys.includes(settlementBidKey) : false,
                    disabled: !isSettlementBidActions || !isSettlementBidSelectable,
                    title: isSettlementBidActions ? settlementControlLabel : 'This bid is not settlement-eligible',
                }
                : undefined,
            statusLabel,
            statusToneClassName,
        };
    });
    return {
        rows,
        showSettlementActionColumn,
    };
}
export function updateTruthAuctionSettlementBidSelection(currentKeys, bidKey, checked) {
    if (checked) {
        if (currentKeys.includes(bidKey))
            return currentKeys;
        return [...currentKeys, bidKey];
    }
    return currentKeys.filter(currentKey => currentKey !== bidKey);
}
//# sourceMappingURL=truthAuctionBidViewModels.js.map