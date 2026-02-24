import { peripherals_DualCapBatchAuction_DualCapBatchAuction } from '../../../../types/contractArtifact.js'
import { ReadClient, WriteClient } from '../viem.js'


export const startAuction = async (client: WriteClient, auctionAddress: `0x${ string }`, ethRaiseCap: bigint, maxRepBeingSold: bigint) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'startAuction',
		address: auctionAddress,
		args: [ethRaiseCap, maxRepBeingSold],
	})
}

export const submitBid = async (client: WriteClient, auctionAddress: `0x${ string }`, tick: bigint, ethAmount: bigint) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'submitBid',
		address: auctionAddress,
		args: [tick],
		value: ethAmount,
	})
}

export const finalize = async (client: WriteClient, auctionAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'finalize',
		address: auctionAddress,
		args: [],
	})
}

export const computeClearing = async (client: ReadClient, auctionAddress: `0x${ string }`) => {
	const [priceFound, foundTick, repAbove, ethAbove] = await client.readContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'computeClearing',
		address: auctionAddress,
		args: [],
	})
	return { priceFound, foundTick, repAbove, ethAbove }
}

export const refundLosingBids = async (client: WriteClient, auctionAddress: `0x${ string }`, tickIndex: { tick: bigint, index: bigint }[]) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'refundLosingBids',
		address: auctionAddress,
		args: [tickIndex],
	})
}

export const withdrawBids = async (client: WriteClient, auctionAddress: `0x${ string }`, withdrawFor: `0x${ string }`, tickIndex: { tick: bigint, index: bigint }[]) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'withdrawBids',
		address: auctionAddress,
		args: [withdrawFor, tickIndex],
	})
}

export const getWithdrawRepAndEthAmount = async (client: WriteClient, auctionAddress: `0x${ string }`, withdrawFor: `0x${ string }`, tickIndex: { tick: bigint, index: bigint }[]) => {
	return await client.simulateContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'withdrawBids',
		address: auctionAddress,
		args: [withdrawFor, tickIndex],
	})
}

export const isFinalized = async (client: ReadClient, auctionAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'finalized',
		address: auctionAddress,
		args: [],
	})
}

export const setOwner = async (client: WriteClient, auctionAddress: `0x${ string }`, owner: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'setOwner',
		address: auctionAddress,
		args: [owner],
	})
}
