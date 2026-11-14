import * as abis from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { AuctionSnapshot, PoolSnapshot } from '../operations/types.ts'
import type { EcosystemDiscoveryContext } from './discovery-context.ts'
import { requireGraphEdge } from './discovery-graph.ts'
import { contractSimulationReverted } from './discovery-client.ts'

export async function discoverAuctions(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint): Promise<AuctionSnapshot[]> {
	const { client, wallet } = context
	const scopes = new Map(pools.map(pool => [`${pool.portfolio.toLowerCase()}:${pool.universeId}`, pool]))
	const auctions: AuctionSnapshot[] = []
	for (const pool of scopes.values()) {
		const controller = getAddress(await client.readContract({ abi: abis.securityPoolPortfolioAbi, address: pool.portfolio, functionName: 'forkController', blockNumber }))
		const address = getAddress(await client.readContract({ abi: abis.securityPoolPortfolioForkCoordinatorAbi, address: controller, functionName: 'auctions', args: [BigInt(pool.universeId)], blockNumber }))
		if (address === zeroAddress) continue
		const [portfolio, authority, universeId, engineAddress, opened, finalized, closesAt, lotAttoEth, repGrid, minimumCollateral] = await Promise.all([
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'portfolio', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'forkAuthority', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'universeId', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'engine', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'opened', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'finalized', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'closesAt', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'lotAttoEth', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'repGrid', blockNumber }),
			client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'minimumCollateralAttoRepPerLot', blockNumber }),
		])
		requireGraphEdge(getAddress(portfolio), pool.portfolio, 'Auction portfolio binding')
		requireGraphEdge(getAddress(authority), controller, 'Auction fork authority binding')
		if (universeId.toString() !== pool.universeId) throw new Error('Auction universe binding mismatch')
		const collateralToken = getAddress(await client.readContract({ abi: abis.securityPoolPortfolioAbi, address: pool.portfolio, functionName: 'collateralToken', blockNumber }))
		const [walletCollateral, collateralAllowance] =
			wallet === undefined
				? [0n, 0n]
				: await Promise.all([client.readContract({ abi: abis.erc20Abi, address: collateralToken, functionName: 'balanceOf', args: [wallet], blockNumber }), client.readContract({ abi: abis.erc20Abi, address: collateralToken, functionName: 'allowance', args: [wallet, address], blockNumber })])
		const capital = getAddress(await client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'capital', blockNumber }))
		const openingPrice = await client.readContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, functionName: 'openingConservativePrice', blockNumber })
		const multiplier = await client.readContract({ abi: abis.securityPoolCapitalLedgerAbi, address: capital, functionName: 'securityMultiplierBps', blockNumber })
		const base = (lotAttoEth * openingPrice + 10n ** 18n - 1n) / 10n ** 18n
		const unroundedCollateral = (base * multiplier + 9_999n) / 10_000n
		const engine = getAddress(engineAddress)
		const engineController = await client.readContract({ abi: abis.securityPoolUniformPriceAuctionAbi, address: engine, functionName: 'controller', blockNumber })
		requireGraphEdge(getAddress(engineController), address, 'Auction engine controller binding')
		const [opensAt, maximumBid, pendingRefund] = await Promise.all([
			client.readContract({ abi: abis.securityPoolUniformPriceAuctionAbi, address: engine, functionName: 'opensAt', blockNumber }),
			client.readContract({ abi: abis.securityPoolUniformPriceAuctionAbi, address: engine, functionName: 'maximumBidAttoRepPerLot', blockNumber }),
			wallet === undefined ? Promise.resolve(0n) : client.readContract({ abi: abis.securityPoolUniformPriceAuctionAbi, address: engine, functionName: 'refundCreditAttoEth', args: [wallet], blockNumber }),
		])
		const bids = (context.indexedAuctionBids?.[engine.toLowerCase()] ?? []).map(bid => ({ ...bid }))
		const refundableBidIds: string[] = []
		for (const bid of bids) {
			const stored = await client.readContract({ abi: abis.securityPoolUniformPriceAuctionAbi, address: engine, functionName: 'bids', args: [BigInt(bid.bidId)], blockNumber })
			if (wallet === undefined || stored[0].toLowerCase() !== wallet.toLowerCase() || stored[1].toLowerCase() !== bid.vault.toLowerCase() || stored[2].toString() !== bid.targetHealthBps || stored[3].toString() !== bid.lots || stored[4].toString() !== bid.minimumAttoRepPerLot)
				throw new Error('Indexed auction bid differs from anchored engine state')
			bid.settled = stored[5]
			if (bid.settled) continue
			try {
				await client.simulateContract({ abi: abis.securityPoolPortfolioAuctionAbi, address, account: wallet, functionName: 'settleRefund', args: [BigInt(bid.bidId)], blockNumber })
				refundableBidIds.push(bid.bidId)
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
			}
		}
		const indexedRefund = context.indexedAuctionRefunds?.[engine.toLowerCase()]
		const generation = pendingRefund > 0n && indexedRefund !== undefined && BigInt(indexedRefund.pendingAttoEth) === pendingRefund ? indexedRefund.generation : undefined
		auctions.push({
			address,
			engine,
			portfolio: pool.portfolio,
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
			minimumCollateralAttoRepPerLot: minimumCollateral.toString(),
			maximumBidAttoRepPerLot: maximumBid.toString(),
			pendingEthRefund: pendingRefund.toString(),
			...(generation === undefined ? {} : { pendingEthRefundGeneration: generation }),
			bids,
			refundableBidIds,
		})
	}
	return auctions
}
