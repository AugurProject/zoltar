import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory } from '../../../../types/contractArtifact'
import type { Address } from 'viem'
import { bytes32String } from '../bigint'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { getInfraContractAddresses } from './deployPeripherals'

type AuctionTickSummary = {
	tick: bigint
	price: bigint
	currentTotalEth: bigint
	submissionCount: bigint
	active: boolean
}

type AuctionBidView = {
	tick: bigint
	bidIndex: bigint
	price: bigint
	bidder: Address
	ethAmount: bigint
	cumulativeEth: bigint
	claimed: boolean
	refunded: boolean
}

function mapAuctionTickSummary(summary: AuctionTickSummary): AuctionTickSummary {
	return {
		tick: summary.tick,
		price: summary.price,
		currentTotalEth: summary.currentTotalEth,
		submissionCount: summary.submissionCount,
		active: summary.active,
	}
}

function mapAuctionBidView(bid: AuctionBidView): AuctionBidView {
	return {
		tick: bid.tick,
		bidIndex: bid.bidIndex,
		price: bid.price,
		bidder: bid.bidder,
		ethAmount: bid.ethAmount,
		cumulativeEth: bid.cumulativeEth,
		claimed: bid.claimed,
		refunded: bid.refunded,
	}
}

export const startAuction = async (client: WriteClient, auctionAddress: Address, ethRaiseCap: bigint, maxRepBeingSold: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'startAuction',
			address: auctionAddress,
			args: [ethRaiseCap, maxRepBeingSold],
		}),
	)

export const submitBid = async (client: WriteClient, auctionAddress: Address, tick: bigint, ethAmount: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'submitBid',
			address: auctionAddress,
			args: [tick],
			value: ethAmount,
		}),
	)

export const finalize = async (client: WriteClient, auctionAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'finalize',
			address: auctionAddress,
			args: [],
		}),
	)

export const computeClearing = async (client: ReadClient, auctionAddress: Address) => {
	const [hitCap, foundTick, accumulatedEth, ethAtClearingTick] = await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'computeClearing',
		address: auctionAddress,
		args: [],
	})
	return { hitCap, foundTick, accumulatedEth, ethAtClearingTick }
}

export const refundLosingBids = async (client: WriteClient, auctionAddress: Address, tickIndex: readonly { tick: bigint; bidIndex: bigint }[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'refundLosingBids',
			address: auctionAddress,
			args: [tickIndex],
		}),
	)

export const withdrawBids = async (client: WriteClient, auctionAddress: Address, withdrawFor: Address, tickIndex: readonly { tick: bigint; bidIndex: bigint }[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'withdrawBids',
			address: auctionAddress,
			args: [withdrawFor, tickIndex],
		}),
	)

export const simulateWithdrawBids = async (client: ReadClient, auctionAddress: Address, withdrawFor: Address, tickIndex: readonly { tick: bigint; bidIndex: bigint }[]) => {
	const [totalFilledRep, totalEthRefund] = (
		await client.simulateContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'withdrawBids',
			address: auctionAddress,
			args: [withdrawFor, tickIndex],
		})
	).result
	return { totalFilledRep, totalEthRefund }
}

export const isFinalized = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'finalized',
		address: auctionAddress,
		args: [],
	})

export const deployUniformPriceDualCapBatchAuction = async (client: WriteClient, owner: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.abi,
			functionName: 'deployUniformPriceDualCapBatchAuction',
			address: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
			args: [owner, bytes32String(0n)],
		}),
	)

export const getClearingTick = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'clearingTick',
		address: auctionAddress,
		args: [],
	})

export const getMinBidSize = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'minBidSize',
		address: auctionAddress,
		args: [],
	})

export const getEthRaiseCap = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'ethRaiseCap',
		address: auctionAddress,
		args: [],
	})

export const getEthRaised = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'ethRaised',
		address: auctionAddress,
		args: [],
	})

export const getTotalRepPurchased = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'totalRepPurchased',
		address: auctionAddress,
		args: [],
	})

export const getTickCount = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getTickCount',
		address: auctionAddress,
		args: [],
	})

export const getTickPage = async (client: ReadClient, auctionAddress: Address, offset: bigint, limit: bigint) =>
	(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getTickPage',
			address: auctionAddress,
			args: [offset, limit],
		})
	).map(summary => mapAuctionTickSummary(summary))

export const getBidCountAtTick = async (client: ReadClient, auctionAddress: Address, tick: bigint) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidCountAtTick',
		address: auctionAddress,
		args: [tick],
	})

export const getBidPageAtTick = async (client: ReadClient, auctionAddress: Address, tick: bigint, offset: bigint, limit: bigint) =>
	(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidPageAtTick',
			address: auctionAddress,
			args: [tick, offset, limit],
		})
	).map(summary => mapAuctionBidView(summary))

export const getBidderBidCount = async (client: ReadClient, auctionAddress: Address, bidder: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'getBidderBidCount',
		address: auctionAddress,
		args: [bidder],
	})

export const getBidderBidPage = async (client: ReadClient, auctionAddress: Address, bidder: Address, offset: bigint, limit: bigint) =>
	(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidderBidPage',
			address: auctionAddress,
			args: [bidder, offset, limit],
		})
	).map(summary => mapAuctionBidView(summary))
