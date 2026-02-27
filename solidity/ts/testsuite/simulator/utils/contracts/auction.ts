import { peripherals_DualCapBatchAuction_DualCapBatchAuction, peripherals_factories_DualCapBatchAuctionFactory_DualCapBatchAuctionFactory } from '../../../../types/contractArtifact.js'
import { bytes32String } from '../bigint.js'
import { ReadClient, WriteClient } from '../viem.js'
import { getInfraContractAddresses } from './deployPeripherals.js'


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
	const [priceFound, foundTick, repAbove] = await client.readContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'computeClearing',
		address: auctionAddress,
		args: [],
	})
	return { priceFound, foundTick, repAbove }
}

export const refundLosingBids = async (client: WriteClient, auctionAddress: `0x${ string }`, tickIndex: readonly { tick: bigint, bidIndex: bigint }[]) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'refundLosingBids',
		address: auctionAddress,
		args: [tickIndex],
	})
}

export const withdrawBids = async (client: WriteClient, auctionAddress: `0x${ string }`, withdrawFor: `0x${ string }`, tickIndex: readonly { tick: bigint, bidIndex: bigint }[]) => {
	return await client.writeContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'withdrawBids',
		address: auctionAddress,
		args: [withdrawFor, tickIndex],
	})
}

export const getWithdrawRepAndEthAmount = async (client: WriteClient, auctionAddress: `0x${ string }`, withdrawFor: `0x${ string }`, tickIndex: readonly { tick: bigint, bidIndex: bigint }[]) => {
	const [totalFilledRep, totalEthRefund] = (await client.simulateContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'withdrawBids',
		address: auctionAddress,
		args: [withdrawFor, tickIndex],
	})).result
	return { totalFilledRep, totalEthRefund }
}

export const isFinalized = async (client: ReadClient, auctionAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'finalized',
		address: auctionAddress,
		args: [],
	})
}

export const deployDualCapBatchAuction = async (client: WriteClient, owner: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_factories_DualCapBatchAuctionFactory_DualCapBatchAuctionFactory.abi,
		functionName: 'deployDualCapBatchAuction',
		address: getInfraContractAddresses().dualCapBatchAuctionFactory,
		args: [owner, bytes32String(0n)],
	})
}

export const getClearingTick = async (client: ReadClient, auctionAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
		functionName: 'clearingTick',
		address: auctionAddress,
		args: [],
	})
}
