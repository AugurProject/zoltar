import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolForker_SecurityPoolForker, statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../contractArtifact.js'
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { writeContractAndWait } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { executeForkAuctionAction } from './securityPoolActions.js'

export async function startTruthAuctionForSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		'startTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'startTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}
export async function submitTruthAuctionBid(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address, tick: bigint, amount: bigint) {
	return await executeForkAuctionAction('submitBid', securityPoolAddress, universeId, async () => {
		const callParams = {
			address: truthAuctionAddress,
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
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
		'refundLosingBids',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: truthAuctionAddress,
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'refundLosingBids',
				args: [selectedBids ?? [{ tick, bidIndex }]],
			})),
	)
}

export async function settleTruthAuctionBids(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, claimTickIndices: TruthAuctionSettlementBidBatch, refundTickIndices: TruthAuctionSettlementBidBatch) {
	return await executeForkAuctionAction(
		'claimAuctionProceeds',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'settleAuctionBids',
				args: [securityPoolAddress, vaultAddress, claimTickIndices, refundTickIndices],
			})),
	)
}
export async function withdrawTruthAuctionRefund(client: WriteClient, securityPoolAddress: Address, universeId: bigint, truthAuctionAddress: Address) {
	return await executeForkAuctionAction(
		'withdrawAuctionRefund',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: truthAuctionAddress,
				abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
				functionName: 'withdrawPendingEthRefund',
			})),
	)
}
export async function finalizeSecurityPoolTruthAuction(client: WriteClient, securityPoolAddress: Address, universeId: bigint) {
	return await executeForkAuctionAction(
		'finalizeTruthAuction',
		securityPoolAddress,
		universeId,
		async () =>
			await writeContractAndWait(client, () => ({
				address: getInfraContractAddresses().securityPoolForker,
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'finalizeTruthAuction',
				args: [securityPoolAddress],
			})),
	)
}
