import * as abis from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { securityPoolAuctionClaimBatch } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { AuctionSnapshot, PoolSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { requireGraphEdge } from './discovery-graph.ts'
import { contractSimulationReverted } from './discovery-client.ts'

export async function discoverAuctions(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint): Promise<AuctionSnapshot[]> {
	const { client, wallet } = context
	const scopes = new Map(pools.map(pool => [`${pool.securityPool.toLowerCase()}:${pool.universeId}`, pool]))
	const auctions: AuctionSnapshot[] = []
	for (const pool of scopes.values()) {
		const controller = getAddress(await client.readContract({ abi: abis.securityPoolAbi, address: pool.securityPool, functionName: 'forkController', blockNumber }))
		const address = getAddress(await client.readContract({ abi: abis.securityPoolForkCoordinatorAbi, address: controller, functionName: 'repairAuctions', args: [BigInt(pool.universeId)], blockNumber }))
		if (address === zeroAddress) continue
		const [securityPool, authority, universeId, engineAddress, opened, finalized, closesAt, lotAttoEth, repGrid] = await Promise.all([
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'securityPool', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'forkAuthority', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'universeId', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'engine', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'opened', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'finalized', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'closesAt', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'lotAttoEth', blockNumber }),
			client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'repGrid', blockNumber }),
		])
		requireGraphEdge(getAddress(securityPool), pool.securityPool, 'Auction security pool binding')
		requireGraphEdge(getAddress(authority), controller, 'Auction fork authority binding')
		if (universeId.toString() !== pool.universeId) throw new Error('Auction universe binding mismatch')
		let openingExpectedSuccess = false
		if (!opened && !finalized) {
			try {
				await client.simulateContract({ abi: abis.securityPoolRepairAuctionAbi, address, ...(wallet === undefined ? {} : { account: wallet }), functionName: 'open', blockNumber })
				openingExpectedSuccess = true
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
			}
		}
		const collateralToken = getAddress(await client.readContract({ abi: abis.securityPoolAbi, address: pool.securityPool, functionName: 'collateralToken', blockNumber }))
		const [walletCollateral, collateralAllowance] =
			wallet === undefined
				? [0n, 0n]
				: await Promise.all([client.readContract({ abi: abis.erc20Abi, address: collateralToken, functionName: 'balanceOf', args: [wallet], blockNumber }), client.readContract({ abi: abis.erc20Abi, address: collateralToken, functionName: 'allowance', args: [wallet, address], blockNumber })])
		const capital = getAddress(await client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'capital', blockNumber }))
		const openingPrice = await client.readContract({ abi: abis.securityPoolRepairAuctionAbi, address, functionName: 'openingConservativePrice', blockNumber })
		const multiplier = await client.readContract({ abi: abis.securityPoolCapitalLedgerAbi, address: capital, functionName: 'securityMultiplierBps', blockNumber })
		const base = (lotAttoEth * openingPrice + 10n ** 18n - 1n) / 10n ** 18n
		const unroundedCollateral = (base * multiplier + 9_999n) / 10_000n
		const engine = getAddress(engineAddress)
		const engineController = await client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'controller', blockNumber })
		requireGraphEdge(getAddress(engineController), address, 'Auction engine controller binding')
		const [opensAt, maximumBid, admissibleBid, pendingRefund] = await Promise.all([
			client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'opensAt', blockNumber }),
			client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'maximumBidAttoRepPerLot', blockNumber }),
			client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'maximumAdmissibleBidAttoRepPerLot', blockNumber }),
			wallet === undefined ? Promise.resolve(0n) : client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'refundCreditAttoEth', args: [wallet], blockNumber }),
		])
		const bids = (context.indexedAuctionBids?.[engine.toLowerCase()] ?? []).map(bid => ({ ...bid }))
		const refundableBidIds: string[] = []
		for (const bid of bids) {
			const stored = await client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'bids', args: [BigInt(bid.bidId)], blockNumber })
			if (wallet === undefined || stored[0].toLowerCase() !== wallet.toLowerCase() || stored[3].toString() !== bid.lots || stored[4].toString() !== bid.minimumAttoRepPerLot) throw new Error('Indexed auction bid differs from anchored engine state')
			bid.settled = stored[1]
			if (bid.settled) continue
			if (finalized) {
				const fill = await client.readContract({ abi: abis.securityPoolUniformPriceRepairAuctionAbi, address: engine, functionName: 'previewBid', args: [BigInt(bid.bidId)], blockNumber })
				if (fill.refundAttoEth === 0n) continue
			}
			try {
				await client.simulateContract({ abi: abis.securityPoolRepairAuctionAbi, address, account: wallet, functionName: 'settleRefund', args: [BigInt(bid.bidId)], blockNumber })
				refundableBidIds.push(bid.bidId)
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
			}
		}
		// Every bid must be claimed, winning or not, before its bidder can choose a branch in a later fork. A bid can be
		// claimed once the auction is finalized, or earlier once it was excluded and refunded.
		const claimableBidIds: string[] = []
		for (const bid of bids) {
			if (!finalized && !bid.settled) continue
			if (!(await client.readContract({ abi: abis.securityPoolCapitalLedgerAbi, address: capital, functionName: 'repairAuctionBidClaimed', args: [BigInt(bid.bidId)], blockNumber }))) claimableBidIds.push(bid.bidId)
		}
		if (claimableBidIds.length > 0) {
			try {
				// Simulate the batch the claim operation sends next.
				await client.simulateContract({ abi: abis.securityPoolCapitalLedgerAbi, address: capital, ...(wallet === undefined ? {} : { account: wallet }), functionName: 'materializeRepairAuctionBids', args: [securityPoolAuctionClaimBatch(claimableBidIds.map(BigInt)).bidIds], blockNumber })
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				claimableBidIds.length = 0
			}
		}
		const indexedRefund = context.indexedAuctionRefunds?.[engine.toLowerCase()]
		const generation = pendingRefund > 0n && indexedRefund !== undefined && BigInt(indexedRefund.pendingAttoEth) === pendingRefund ? indexedRefund.generation : undefined
		auctions.push({
			openingExpectedSuccess,
			address,
			engine,
			securityPool: pool.securityPool,
			universeId: pool.universeId,
			forkController: controller,
			startTime: opensAt.toString(),
			endTime: closesAt.toString(),
			opened,
			finalized,
			collateralToken,
			walletCollateral: walletCollateral.toString(),
			collateralAllowance: collateralAllowance.toString(),
			lotAttoEth: lotAttoEth.toString(),
			repGrid: repGrid.toString(),
			unroundedCollateralAttoRepPerLot: unroundedCollateral.toString(),
			maximumBidAttoRepPerLot: maximumBid.toString(),
			maximumAdmissibleBidAttoRepPerLot: admissibleBid.toString(),
			pendingEthRefund: pendingRefund.toString(),
			...(generation === undefined ? {} : { pendingEthRefundGeneration: generation }),
			bids,
			refundableBidIds,
			capital,
			claimableBidIds,
		})
	}
	return auctions
}
