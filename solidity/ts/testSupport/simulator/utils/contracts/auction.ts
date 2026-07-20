import { peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory } from '../../../../types/contractArtifact'
import type { Address, Hex } from '@zoltar/shared/ethereum'
import { bytes32String } from '../bigint'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { requireAddress, requireArray, requireBigInt, requireBoolean } from '../utilities'
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
	bidder: Address
	ethAmount: bigint
	cumulativeEth: bigint
	activeCumulativeEthBeforeBid: bigint
	claimed: boolean
	refunded: boolean
}

function getTupleField(value: unknown, index: number, key: string, context: string) {
	if (Array.isArray(value)) return value[index]
	if (typeof value !== 'object' || value === null) throw new Error(`${context} must be a tuple`)
	return Reflect.get(value, key)
}

function mapAuctionTickSummary(summary: unknown): AuctionTickSummary {
	return {
		tick: requireBigInt(getTupleField(summary, 0, 'tick', 'Auction tick summary'), 'Auction tick summary tick'),
		price: requireBigInt(getTupleField(summary, 1, 'price', 'Auction tick summary'), 'Auction tick summary price'),
		currentTotalEth: requireBigInt(getTupleField(summary, 2, 'currentTotalEth', 'Auction tick summary'), 'Auction tick summary current total ETH'),
		submissionCount: requireBigInt(getTupleField(summary, 3, 'submissionCount', 'Auction tick summary'), 'Auction tick summary submission count'),
		active: requireBoolean(getTupleField(summary, 4, 'active', 'Auction tick summary'), 'Auction tick summary active flag'),
	}
}

function mapAuctionBidView(bid: unknown): AuctionBidView {
	return {
		tick: requireBigInt(getTupleField(bid, 0, 'tick', 'Auction bid view'), 'Auction bid tick'),
		bidIndex: requireBigInt(getTupleField(bid, 1, 'bidIndex', 'Auction bid view'), 'Auction bid index'),
		bidder: requireAddress(getTupleField(bid, 2, 'bidder', 'Auction bid view'), 'Auction bidder'),
		ethAmount: requireBigInt(getTupleField(bid, 3, 'ethAmount', 'Auction bid view'), 'Auction bid ETH amount'),
		cumulativeEth: requireBigInt(getTupleField(bid, 4, 'cumulativeEth', 'Auction bid view'), 'Auction bid cumulative ETH'),
		activeCumulativeEthBeforeBid: requireBigInt(getTupleField(bid, 5, 'activeCumulativeEthBeforeBid', 'Auction bid view'), 'Auction bid active cumulative ETH before bid'),
		claimed: requireBoolean(getTupleField(bid, 6, 'claimed', 'Auction bid view'), 'Auction bid claimed flag'),
		refunded: requireBoolean(getTupleField(bid, 7, 'refunded', 'Auction bid view'), 'Auction bid refunded flag'),
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
	const result = requireArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'computeClearing',
			address: auctionAddress,
			args: [],
		}),
		'Auction clearing result',
	)
	return {
		hitCap: requireBoolean(result[0], 'Auction clearing hitCap'),
		foundTick: requireBigInt(result[1], 'Auction clearing found tick'),
		accumulatedEth: requireBigInt(result[2], 'Auction clearing accumulated ETH'),
		ethAtClearingTick: requireBigInt(result[3], 'Auction clearing ETH at tick'),
	}
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

export const withdrawBids = async (client: WriteClient, auctionAddress: Address, withdrawFor: Address, tickIndex: readonly { tick: bigint; bidIndex: bigint }[], proRataTotal = 0n) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'withdrawBids',
			address: auctionAddress,
			args: [withdrawFor, tickIndex, proRataTotal],
		}),
	)

export const simulateWithdrawBids = async (client: ReadClient, auctionAddress: Address, withdrawFor: Address, tickIndex: readonly { tick: bigint; bidIndex: bigint }[], proRataTotal = 0n) => {
	const result = requireArray(
		(
			await client.simulateContract({
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'withdrawBids',
				address: auctionAddress,
				args: [withdrawFor, tickIndex, proRataTotal],
			})
		).result,
		'Auction withdraw simulation',
	)
	return {
		totalFilledRep: requireBigInt(result[0], 'Auction withdraw simulation filled REP'),
		totalEthRefund: requireBigInt(result[1], 'Auction withdraw simulation ETH refund'),
		totalProRataAllocation: requireBigInt(result[2], 'Auction withdraw simulation pro-rata allocation'),
	}
}

export const isFinalized = async (client: ReadClient, auctionAddress: Address): Promise<boolean> =>
	requireBoolean(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'finalized',
			address: auctionAddress,
			args: [],
		}),
		'Auction finalized flag',
	)

export const deployUniformPriceDualCapBatchAuction = async (client: WriteClient, owner: Address, salt: Hex = bytes32String(0n)) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.abi,
			functionName: 'deployUniformPriceDualCapBatchAuction',
			address: getInfraContractAddresses().uniformPriceDualCapBatchAuctionFactory,
			args: [owner, salt],
		}),
	)

export const getClearingTick = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'clearingTick',
			address: auctionAddress,
			args: [],
		}),
		'Auction clearing tick',
	)

export const getMinBidSize = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'minBidSize',
			address: auctionAddress,
			args: [],
		}),
		'Auction min bid size',
	)

export const getMaxRepBeingSold = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'maxRepBeingSold',
			address: auctionAddress,
			args: [],
		}),
		'Auction max REP being sold',
	)

export const getEthRaiseCap = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'ethRaiseCap',
			address: auctionAddress,
			args: [],
		}),
		'Auction ETH raise cap',
	)

export const getEthRaised = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'ethRaised',
			address: auctionAddress,
			args: [],
		}),
		'Auction ETH raised',
	)

export const getTotalRepPurchased = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'totalRepPurchased',
			address: auctionAddress,
			args: [],
		}),
		'Auction total REP purchased',
	)

export const getTickCount = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getTickCount',
			address: auctionAddress,
			args: [],
		}),
		'Auction tick count',
	)

export const getTickSummary = async (client: ReadClient, auctionAddress: Address, tick: bigint): Promise<AuctionTickSummary> =>
	mapAuctionTickSummary(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getTickSummary',
			address: auctionAddress,
			args: [tick],
		}),
	)

export const getTickPage = async (client: ReadClient, auctionAddress: Address, offset: bigint, limit: bigint): Promise<AuctionTickSummary[]> =>
	requireArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getTickPage',
			address: auctionAddress,
			args: [offset, limit],
		}),
		'Auction tick page',
	).map((summary: unknown) => mapAuctionTickSummary(summary))

export const activeTickCount = async (client: ReadClient, auctionAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'activeTickCount',
			address: auctionAddress,
			args: [],
		}),
		'Active auction tick count',
	)

export const getActiveTickPage = async (client: ReadClient, auctionAddress: Address, offset: bigint, limit: bigint): Promise<AuctionTickSummary[]> =>
	requireArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getActiveTickPage',
			address: auctionAddress,
			args: [offset, limit],
		}),
		'Active auction tick page',
	).map((summary: unknown) => mapAuctionTickSummary(summary))

export const getBidCountAtTick = async (client: ReadClient, auctionAddress: Address, tick: bigint): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidCountAtTick',
			address: auctionAddress,
			args: [tick],
		}),
		'Auction bid count at tick',
	)

export const getBidPageAtTick = async (client: ReadClient, auctionAddress: Address, tick: bigint, offset: bigint, limit: bigint): Promise<AuctionBidView[]> =>
	requireArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidPageAtTick',
			address: auctionAddress,
			args: [tick, offset, limit],
		}),
		'Auction bid page at tick',
	).map((summary: unknown) => mapAuctionBidView(summary))

export const getBidderBidCount = async (client: ReadClient, auctionAddress: Address, bidder: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidderBidCount',
			address: auctionAddress,
			args: [bidder],
		}),
		'Auction bidder bid count',
	)

export const getBidderBidPage = async (client: ReadClient, auctionAddress: Address, bidder: Address, offset: bigint, limit: bigint): Promise<AuctionBidView[]> =>
	requireArray(
		await client.readContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'getBidderBidPage',
			address: auctionAddress,
			args: [bidder, offset, limit],
		}),
		'Auction bidder bid page',
	).map((summary: unknown) => mapAuctionBidView(summary))
