import { type Address } from '@zoltar/shared/ethereum'
import { peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../contractArtifact.js'
import type { WriteClient } from '../types/contracts.js'
import { writeContractAndWait } from './core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { executeForkAuctionAction } from './securityPoolActions.js'

export async function startTruthAuctionForSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'startTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'startTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}
export async function submitTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) {
	return await executeForkAuctionAction(client, 'submitBid', securityPoolAddress, universeId, async () => {
		const callParams = {
			address: truthAuctionAddress,
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'submitBid',
			args: [tick],
			value: amount,
		}
		return await writeContractAndWait(client, () => callParams)
	})
}

type TruthAuctionSettlementBidIdentifier = {
	tick: bigint
	bidIndex: bigint
}
type TruthAuctionSettlementBidBatch = readonly TruthAuctionSettlementBidIdentifier[]

export async function refundTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, bidIndex: bigint, selectedBids?: readonly TruthAuctionSettlementBidIdentifier[]) {
	return await executeForkAuctionAction(
		client,
		'refundLosingBids',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: truthAuctionAddress,
				abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'refundLosingBids',
				args: selectedBids === undefined ? [{ tick, bidIndex }] : selectedBids,
			})),
	)
}

export async function settleTruthAuctionBids(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, claimTickIndices: TruthAuctionSettlementBidBatch, refundTickIndices: TruthAuctionSettlementBidBatch) {
	return await executeForkAuctionAction(
		client,
		'claimAuctionProceeds',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'settleAuctionBids',
				args: [securityPoolAddress, vaultAddress, claimTickIndices, refundTickIndices],
			})),
	)
}
export async function finalizeSecurityPoolTruthAuction(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		client,
		'finalizeTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'finalizeTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}
