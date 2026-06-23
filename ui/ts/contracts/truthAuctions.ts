import type { Address } from 'viem'
import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../contractArtifact.js'
import type { ReadClient, TruthAuctionBidView, TruthAuctionBidderBidPage, TruthAuctionTickBidPage, TruthAuctionTickPage, TruthAuctionTickSummary } from '../types/contracts.js'
import { requireAddressValue, requireArrayValue, requireBigintValue, requireObjectValue } from './decoders.js'

function getTruthAuctionPageOffset(pageIndex: number, pageSize: number) {
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Page index must be a non-negative integer')
	if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Page size must be a positive integer')
	return BigInt(pageIndex) * BigInt(pageSize)
}

function requireTruthAuctionTickSummary(value: unknown, context: string): TruthAuctionTickSummary {
	const summary = requireObjectValue(value, context)
	if ('tick' in summary && 'price' in summary && 'currentTotalEth' in summary && 'submissionCount' in summary && 'active' in summary && typeof summary.active === 'boolean') {
		return {
			tick: requireBigintValue(summary.tick, context),
			price: requireBigintValue(summary.price, context),
			currentTotalEth: requireBigintValue(summary.currentTotalEth, context),
			submissionCount: requireBigintValue(summary.submissionCount, context),
			active: summary.active,
		}
	}
	throw new Error(`Unexpected ${context} response`)
}

function requireTruthAuctionTickSummaryArray(value: unknown, context: string): TruthAuctionTickSummary[] {
	return requireArrayValue(value, context).map(summary => requireTruthAuctionTickSummary(summary, context))
}

function requireTruthAuctionBidView(value: unknown, context: string): TruthAuctionBidView {
	const bid = requireObjectValue(value, context)
	if ('tick' in bid && 'bidIndex' in bid && 'bidder' in bid && 'ethAmount' in bid && 'cumulativeEth' in bid && 'activeCumulativeEthBeforeBid' in bid && 'claimed' in bid && typeof bid.claimed === 'boolean' && 'refunded' in bid && typeof bid.refunded === 'boolean') {
		return {
			tick: requireBigintValue(bid.tick, context),
			bidIndex: requireBigintValue(bid.bidIndex, context),
			bidder: requireAddressValue(bid.bidder, context),
			ethAmount: requireBigintValue(bid.ethAmount, context),
			cumulativeEth: requireBigintValue(bid.cumulativeEth, context),
			activeCumulativeEthBeforeBid: requireBigintValue(bid.activeCumulativeEthBeforeBid, context),
			claimed: bid.claimed,
			refunded: bid.refunded,
		}
	}
	throw new Error(`Unexpected ${context} response`)
}

function requireTruthAuctionBidViewArray(value: unknown, context: string): TruthAuctionBidView[] {
	return requireArrayValue(value, context).map(bid => requireTruthAuctionBidView(bid, context))
}

export async function loadTruthAuctionTickSummary(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint): Promise<TruthAuctionTickSummary> {
	const summary = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getTickSummary',
		address: truthAuctionAddress,
		args: [tick],
	})
	return requireTruthAuctionTickSummary(summary, 'truth auction tick summary')
}

export async function loadTruthAuctionTickPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionTickPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const tickCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getTickCount',
		address: truthAuctionAddress,
		args: [],
	})
	const tickPage = requireTruthAuctionTickSummaryArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getTickPage',
			address: truthAuctionAddress,
			args: [offset, BigInt(pageSize)],
		}),
		'truth auction tick page',
	)
	return {
		pageIndex,
		pageSize,
		tickCount,
		ticks: tickPage,
	}
}

export async function loadTruthAuctionActiveTickPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionTickPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const tickCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'activeTickCount',
		address: truthAuctionAddress,
		args: [],
	})
	const tickPage = requireTruthAuctionTickSummaryArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getActiveTickPage',
			address: truthAuctionAddress,
			args: [offset, BigInt(pageSize)],
		}),
		'truth auction active tick page',
	)
	return {
		pageIndex,
		pageSize,
		tickCount,
		ticks: tickPage,
	}
}

export async function loadTruthAuctionTickBidPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint, pageIndex: number, pageSize: number): Promise<TruthAuctionTickBidPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const bidCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidCountAtTick',
		address: truthAuctionAddress,
		args: [tick],
	})
	const bidPage = requireTruthAuctionBidViewArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidPageAtTick',
			address: truthAuctionAddress,
			args: [tick, offset, BigInt(pageSize)],
		}),
		'truth auction tick bid page',
	)
	return {
		tick,
		pageIndex,
		pageSize,
		bidCount,
		bids: bidPage,
	}
}

export async function loadTruthAuctionBidderBidPage(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, bidder: Address, pageIndex: number, pageSize: number): Promise<TruthAuctionBidderBidPage> {
	const offset = getTruthAuctionPageOffset(pageIndex, pageSize)
	const bidCount = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidderBidCount',
		address: truthAuctionAddress,
		args: [bidder],
	})
	const bidPage = requireTruthAuctionBidViewArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidderBidPage',
			address: truthAuctionAddress,
			args: [bidder, offset, BigInt(pageSize)],
		}),
		'truth auction bidder bid page',
	)
	return {
		bidder,
		pageIndex,
		pageSize,
		bidCount,
		bids: bidPage,
	}
}
