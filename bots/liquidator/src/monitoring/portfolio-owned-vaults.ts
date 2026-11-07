import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import { loadPortfolioAuctionSnapshot, loadPortfolioCapitalSnapshot, decodeAuctionVaultBindings, verifyAuctionVaultCode, type PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { portfolioRuntimeIdentities, securityPoolPortfolioAuctionAbi as auctionAbi, securityPoolUniformPriceAuctionAbi as engineAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolPortfolioForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from './read-client.ts'

/** Only this wallet's bids are enumerated; other bidders cannot inflate the exposure accounting work. */
export async function loadOwnedPortfolioVaults(client: ReadClient, snapshot: PortfolioCapitalSnapshot, knownVaults: readonly Address[]) {
	const blockNumber = snapshot.blockNumber
	const pinnedClient = { ...client, getBlock: () => client.getBlock({ blockNumber }) }
	const vaults = new Set(knownVaults)
	let pendingPrincipal = 0n
	let pendingCommitment = 0n
	const controller = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'forkAuthority', blockNumber })
	const auctionAddress = await client.readContract({ address: controller, abi: forkAbi, functionName: 'auctions', args: [snapshot.universeId], blockNumber })
	const engine = auctionAddress === zeroAddress ? zeroAddress : await client.readContract({ address: auctionAddress, abi: auctionAbi, functionName: 'engine', blockNumber })
	const count = engine === zeroAddress ? 0n : await client.readContract({ address: engine, abi: engineAbi, functionName: 'bidderBidCount', args: [snapshot.owner], blockNumber })
	if (count > 0n) {
		for (let start = 0n; ; start += 64n) {
			const page = await loadPortfolioAuctionSnapshot({ client: pinnedClient, portfolio: snapshot.portfolio, universeId: snapshot.universeId, bidder: snapshot.owner, bidStart: start, bidCount: 64 })
			const auction = page.auction
			if (auction === undefined || auction.address !== auctionAddress) throw new Error('Managed auction binding changed')
			for (const bid of auction.bids) {
				vaults.add(bid.vault)
				if (!auction.finalized && !bid.refundSettled) {
					// Uniform clearing can award the entire inventory. Reserve that
					// ceiling once for the auction, not just a bid's minimum REP.
					pendingPrincipal = auction.inventoryAttoRep
					pendingCommitment += bid.lots * auction.lotAttoEth
				}
			}
			if (start + 64n >= auction.totalBidCount) break
		}
	}
	const accounts = []
	const chosenChildren: bigint[] = []
	for (const vault of vaults) {
		const code = await client.getCode({ address: vault, blockNumber })
		const bindings = decodeAuctionVaultBindings(code)
		if (bindings === undefined || bindings.owner !== snapshot.owner) throw new Error('Managed vault does not belong to the operator')
		verifyAuctionVaultCode(code, bindings)
		verifyRuntimeIdentity(await client.getCode({ address: bindings.implementation, blockNumber }), portfolioRuntimeIdentities.SecurityPoolAuctionVault, 'managed vault implementation')
		const [portfolio, id] = await Promise.all([client.readContract({ address: bindings.auction, abi: auctionAbi, functionName: 'portfolio', blockNumber }), client.readContract({ address: bindings.auction, abi: auctionAbi, functionName: 'bidIdForVault', args: [vault], blockNumber })])
		if (portfolio !== snapshot.portfolio || id !== bindings.bidId) throw new Error('Managed vault is outside the selected portfolio')
		const account = await loadPortfolioCapitalSnapshot({ client, portfolio: snapshot.portfolio, universeId: snapshot.universeId, owner: vault, blockNumber })
		accounts.push(account)
		if (account.exported) {
			const fork = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'forkAuthority', blockNumber })
			const choice = await client.readContract({ address: fork, abi: forkAbi, functionName: 'choices', args: [snapshot.universeId, vault], blockNumber })
			if (!choice[1]) throw new Error('Exported vault has no fork choice')
			// Child identity is read by the caller's ordinary universe discovery;
			// preserve the outcome until it is mapped through native Zoltar.
			chosenChildren.push(choice[0])
		}
	}
	return { vaults: [...vaults].map(getAddress), accounts, pendingPrincipal, pendingCommitment, chosenOutcomes: chosenChildren }
}
