import { ReadClient, WriteClient } from '../viem.js'


export const startAuction = async (client: WriteClient, auctionAddress: `0x${ string }`, ethRaiseCap: bigint, maxRepBeingSold: bigint) => {
	return await client.writeContract({
		abi:
		functionName: 'startAuction',
		address: auctionAddress,
		args: [ethRaiseCap, maxRepBeingSold],
	})
}

export const submitBid = async (client: WriteClient, auctionAddress: `0x${ string }`, tick: bigint, ethAmount: bigint) => {
	return await client.writeContract({
		abi:
		functionName: 'submitBid',
		address: auctionAddress,
		args: [tick],
		amount: ethAmount,
	})
}

export const finalize = async (client: WriteClient, auctionAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi:
		functionName: 'finalize',
		address: auctionAddress,
		args: [],
	})
}

export const computeClearing = async (client: ReadClient, auctionAddress: `0x${ string }`) => {
	[priceFound, foundTick, repAbove, ethAbove] = await client.readContract({
		abi: ,
		functionName: 'computeClearing',
		address: auctionAddress,
		args: [],
	})
	return { priceFound, foundTick, repAbove, ethAbove }
}

export const refundLosingBid = async (client: WriteClient, auctionAddress: `0x${ string }`, tick: bigint, index: bigint) => {
	return await client.writeContract({
		abi:
		functionName: 'refundLosingBid',
		address: auctionAddress,
		args: [tick, index],
	})
}

export const withdrawBids = async (client: WriteClient, auctionAddress: `0x${ string }`, withdrawFor: `0x${ string }`, tick: bigint, bidIndices: bigint[]) => {
	return await client.writeContract({
		abi:
		functionName: 'withdrawBids',
		address: auctionAddress,
		args: [withdrawFor, tick, bidIndices],
	})
}

export const getWithdrawRepAndEthAmount = async (client: WriteClient, auctionAddress: `0x${ string }`, withdrawFor: `0x${ string }`, tick: bigint, bidIndices: bigint[]) => {
	return await client.readContract({
		abi:
		functionName: 'withdrawBids',
		address: auctionAddress,
		args: [withdrawFor, tick, bidIndices],
	})
}

export const isFinalized = async (client: ReadClient, auctionAddress: `0x${ string }`) {
	return await client.readContract({
		abi: ,
		functionName: 'finalized',
		address: auctionAddress,
		args: [],
	})
}

export const setOwner = async (client: WriteClient, auctionAddress: `0x${ string }`, owner: `0x${ string }`) => {
	return await client.writeContract({
		abi:
		functionName: 'setOwner',
		address: auctionAddress,
		args: [owner],
	})
}
