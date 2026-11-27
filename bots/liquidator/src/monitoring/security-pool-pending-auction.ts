import { loadSecurityPoolAuctionSnapshot, type SecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { securityPoolRepairAuctionAbi as auctionAbi, securityPoolUniformPriceRepairAuctionAbi as engineAbi, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolForkCoordinatorAbi as forkAbi } from '@zoltar/bot-shared/contracts/abi'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from './read-client.ts'

/**
 * Exposure of this wallet's repair auction bids. Winning lots join the wallet's own capital account only when their
 * bid is claimed, and the capital snapshot counts only the account's own position, so each unclaimed winning bid adds
 * its lots here, and bids that may still win need a reserve. Only this wallet's bids are enumerated; other bidders
 * cannot inflate the exposure accounting work.
 */
export async function loadPendingSecurityPoolAuctionExposure(client: ReadClient, snapshot: SecurityPoolCapitalSnapshot) {
	const blockNumber = snapshot.blockNumber
	const pinnedClient = { ...client, getBlock: () => client.getBlock({ blockNumber }) }
	let reservedPrincipal = 0n
	let pendingCommitment = 0n
	let unclaimedPrincipal = 0n
	const controller = await client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'forkAuthority', blockNumber })
	const auctionAddress = await client.readContract({ address: controller, abi: forkAbi, functionName: 'repairAuctions', args: [snapshot.universeId], blockNumber })
	const engine = auctionAddress === zeroAddress ? zeroAddress : await client.readContract({ address: auctionAddress, abi: auctionAbi, functionName: 'engine', blockNumber })
	const count = engine === zeroAddress ? 0n : await client.readContract({ address: engine, abi: engineAbi, functionName: 'bidderBidCount', args: [snapshot.owner], blockNumber })
	if (count > 0n) {
		for (let start = 0n; ; start += 64n) {
			const page = await loadSecurityPoolAuctionSnapshot({ client: pinnedClient, securityPool: snapshot.securityPool, universeId: snapshot.universeId, bidder: snapshot.owner, bidStart: start, bidCount: 64 })
			const auction = page.auction
			if (auction === undefined || auction.address !== auctionAddress) throw new Error('Managed auction binding changed')
			for (const bid of auction.bids) {
				if (!bid.claimed && bid.position !== undefined) {
					// Unclaimed winning lots back claims but are outside the account view.
					unclaimedPrincipal += bid.position.principalAttoRep
					pendingCommitment += bid.position.commitmentAttoEth
				}
				if (auction.finalized || bid.refundSettled) continue
				// Uniform clearing can award the entire inventory. Reserve that
				// ceiling once for the auction, not just a bid's minimum REP.
				reservedPrincipal = auction.inventoryAttoRep
				pendingCommitment += bid.lots * auction.lotAttoEth
			}
			if (start + 64n >= auction.totalBidCount) break
		}
	}
	return { pendingPrincipal: reservedPrincipal + unclaimedPrincipal, pendingAuction: reservedPrincipal > 0n ? { address: auctionAddress, principal: reservedPrincipal } : undefined, pendingCommitment }
}
