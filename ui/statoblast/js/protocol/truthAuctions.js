import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '@zoltar/ui-core-shared/contractArtifact.js';
import { requireAddressValue, requireArrayValue, requireBigintValue, requireBooleanValue, requireObjectValue } from '@zoltar/ui-zoltar/protocol/decoders.js';
import { getProtocolPageOffset } from '@zoltar/ui-zoltar/protocol/helpers.js';
function requireTruthAuctionTickSummary(value, context) {
    const summary = requireObjectValue(value, context);
    if ('tick' in summary && 'price' in summary && 'currentTotalBidAttoEth' in summary && 'submissionCount' in summary && 'active' in summary) {
        return {
            tick: requireBigintValue(summary.tick, `${context} tick`),
            price: requireBigintValue(summary.price, `${context} price`),
            currentTotalBidAttoEth: requireBigintValue(summary.currentTotalBidAttoEth, `${context} current total ETH`),
            submissionCount: requireBigintValue(summary.submissionCount, `${context} submission count`),
            active: requireBooleanValue(summary.active, `${context} active flag`),
        };
    }
    throw new Error(`Unexpected ${context} response`);
}
function requireTruthAuctionTickSummaryArray(value, context) {
    return requireArrayValue(value, context).map(summary => requireTruthAuctionTickSummary(summary, context));
}
function requireTruthAuctionBidView(value, context) {
    const bid = requireObjectValue(value, context);
    if ('tick' in bid && 'bidIndex' in bid && 'bidder' in bid && 'bidAmountAttoEth' in bid && 'cumulativeBidAttoEth' in bid && 'activeCumulativeBidBeforeAttoEth' in bid && 'claimed' in bid && 'refunded' in bid) {
        return {
            tick: requireBigintValue(bid.tick, `${context} tick`),
            bidIndex: requireBigintValue(bid.bidIndex, `${context} bid index`),
            bidder: requireAddressValue(bid.bidder, `${context} bidder`),
            bidAmountAttoEth: requireBigintValue(bid.bidAmountAttoEth, `${context} ETH amount`),
            cumulativeBidAttoEth: requireBigintValue(bid.cumulativeBidAttoEth, `${context} cumulative ETH`),
            activeCumulativeBidBeforeAttoEth: requireBigintValue(bid.activeCumulativeBidBeforeAttoEth, `${context} active cumulative ETH before bid`),
            claimed: requireBooleanValue(bid.claimed, `${context} claimed flag`),
            refunded: requireBooleanValue(bid.refunded, `${context} refunded flag`),
        };
    }
    throw new Error(`Unexpected ${context} response`);
}
function requireTruthAuctionBidViewArray(value, context) {
    return requireArrayValue(value, context).map(bid => requireTruthAuctionBidView(bid, context));
}
export async function loadTruthAuctionTickSummary(client, truthAuctionAddress, tick) {
    const summary = await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getTickSummary',
        address: truthAuctionAddress,
        args: [tick],
    });
    return requireTruthAuctionTickSummary(summary, 'truth auction tick summary');
}
export async function loadTruthAuctionTickPage(client, truthAuctionAddress, pageIndex, pageSize) {
    const offset = getProtocolPageOffset(pageIndex, pageSize);
    const tickCount = await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getTickCount',
        address: truthAuctionAddress,
        args: [],
    });
    const tickPage = requireTruthAuctionTickSummaryArray(await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getTickPage',
        address: truthAuctionAddress,
        args: [offset, BigInt(pageSize)],
    }), 'truth auction tick page');
    return {
        pageIndex,
        pageSize,
        tickCount,
        ticks: tickPage,
    };
}
export async function loadTruthAuctionActiveTickPage(client, truthAuctionAddress, pageIndex, pageSize) {
    const offset = getProtocolPageOffset(pageIndex, pageSize);
    const tickCount = await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'activeTickCount',
        address: truthAuctionAddress,
        args: [],
    });
    const tickPage = requireTruthAuctionTickSummaryArray(await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getActiveTickPage',
        address: truthAuctionAddress,
        args: [offset, BigInt(pageSize)],
    }), 'truth auction active tick page');
    return {
        pageIndex,
        pageSize,
        tickCount,
        ticks: tickPage,
    };
}
export async function loadTruthAuctionTickBidPage(client, truthAuctionAddress, tick, pageIndex, pageSize) {
    const offset = getProtocolPageOffset(pageIndex, pageSize);
    const bidCount = await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getBidCountAtTick',
        address: truthAuctionAddress,
        args: [tick],
    });
    const bidPage = requireTruthAuctionBidViewArray(await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getBidPageAtTick',
        address: truthAuctionAddress,
        args: [tick, offset, BigInt(pageSize)],
    }), 'truth auction tick bid page');
    return {
        tick,
        pageIndex,
        pageSize,
        bidCount,
        bids: bidPage,
    };
}
export async function loadTruthAuctionBidderBidPage(client, truthAuctionAddress, bidder, pageIndex, pageSize) {
    const offset = getProtocolPageOffset(pageIndex, pageSize);
    const bidCount = await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getBidderBidCount',
        address: truthAuctionAddress,
        args: [bidder],
    });
    const bidPage = requireTruthAuctionBidViewArray(await client.readContract({
        abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
        functionName: 'getBidderBidPage',
        address: truthAuctionAddress,
        args: [bidder, offset, BigInt(pageSize)],
    }), 'truth auction bidder bid page');
    return {
        bidder,
        pageIndex,
        pageSize,
        bidCount,
        bids: bidPage,
    };
}
//# sourceMappingURL=truthAuctions.js.map