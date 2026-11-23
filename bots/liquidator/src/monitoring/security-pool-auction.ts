import { securityPoolRuntimeIdentities, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolAuctionAbi as auctionAbi, securityPoolUniformPriceAuctionAbi as engineAbi, securityPoolAuctionVaultAbi as vaultAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, parseAbiItem, type Address } from '@zoltar/bot-shared/ethereum'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import { verifyAuctionVaultCode, type SecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import type { ReadClient } from './read-client.ts'
import type { SecurityPoolPosition } from './security-pool-monitor.ts'

export type SecurityPoolAuctionTarget = { auction: Address; bidId: bigint; vault: Address }
export type SecurityPoolTarget = bigint | SecurityPoolAuctionTarget
export const securityPoolTarget = (position: SecurityPoolPosition): SecurityPoolTarget => position.auctionTarget ?? position.id
export function sameSecurityPoolTarget(first: SecurityPoolTarget, second: SecurityPoolTarget) {
	return typeof first === 'bigint' || typeof second === 'bigint' ? first === second : first.auction === second.auction && first.bidId === second.bidId && first.vault === second.vault
}
const links = [parseAbiItem('function forkController() view returns (address)'), parseAbiItem('function auctions(uint248 universeId) view returns (address)')] as const

/** Follow only remaining winners at the same confirmed block; no losing-history scan. */
export async function securityPoolAuctionPage(client: ReadClient, engine: Address, blockNumber: bigint, afterBidId: bigint, count: bigint, maximum: number) {
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 256) throw new Error('Invalid auction page size')
	let cursor = afterBidId > count ? 0n : afterBidId
	const ids: bigint[] = []
	for (let index = 0; index < maximum; index++) {
		const next = await client.readContract({ address: engine, abi: engineAbi, functionName: 'nextUnmaterializedBid', args: [cursor], blockNumber })
		if (next === 0n) return { ids, auctionAfterBidId: 0n }
		if (next > count || next === cursor || ids.includes(next)) throw new Error('Invalid auction winner cursor')
		ids.push(next)
		cursor = next
	}
	return { ids, auctionAfterBidId: cursor }
}

export async function authenticateSecurityPoolAuction(client: ReadClient, snapshot: SecurityPoolCapitalSnapshot, auction: Address) {
	const blockNumber = snapshot.blockNumber
	const [fork, securityPool, capital, universe, token, authority, engine, finalized, implementation] = await Promise.all([
		client.readContract({ address: snapshot.securityPool, abi: links, functionName: 'forkController', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'securityPool', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'capital', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'repToken', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'forkAuthority', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'engine', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'finalized', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'vaultImplementation', blockNumber }),
	])
	if (typeof fork !== 'string') throw new Error('Security pool fork authority is invalid')
	verifyRuntimeIdentity(await client.getCode({ address: auction, blockNumber }), securityPoolRuntimeIdentities.SecurityPoolAuction, 'security pool auction')
	verifyRuntimeIdentity(await client.getCode({ address: engine, blockNumber }), securityPoolRuntimeIdentities.SecurityPoolUniformPriceAuction, 'auction engine')
	verifyRuntimeIdentity(await client.getCode({ address: implementation, blockNumber }), securityPoolRuntimeIdentities.SecurityPoolAuctionVault, 'auction vault implementation')
	const [registered, controller, count, closed] = await Promise.all([
		client.readContract({ address: getAddress(fork), abi: links, functionName: 'auctions', args: [snapshot.universeId], blockNumber }),
		client.readContract({ address: engine, abi: engineAbi, functionName: 'controller', blockNumber }),
		client.readContract({ address: engine, abi: engineAbi, functionName: 'bidCount', blockNumber }),
		client.readContract({ address: engine, abi: engineAbi, functionName: 'finalized', blockNumber }),
	])
	if (typeof registered !== 'string') throw new Error('Security pool auction registration is invalid')
	if (
		getAddress(securityPool) !== snapshot.securityPool ||
		getAddress(capital) !== snapshot.capitalLedger ||
		universe !== snapshot.universeId ||
		getAddress(token) !== snapshot.repToken ||
		getAddress(authority) !== getAddress(fork) ||
		getAddress(registered) !== auction ||
		getAddress(controller) !== auction ||
		!closed ||
		!finalized
	)
		throw new Error('Auction custody identity does not match finalized security pool capital')
	return { address: auction, engine: getAddress(engine), vaultImplementation: getAddress(implementation), bidCount: count }
}

export async function loadSecurityPoolAuctionPosition(client: ReadClient, snapshot: SecurityPoolCapitalSnapshot, auction: Awaited<ReturnType<typeof authenticateSecurityPoolAuction>>, bidId: bigint, threshold: bigint): Promise<SecurityPoolPosition | undefined> {
	if (bidId <= 0n || bidId > auction.bidCount) throw new Error('Auction bid is outside the authenticated registry')
	const blockNumber = snapshot.blockNumber
	const [position, fill] = await Promise.all([client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'auctionPosition', args: [bidId], blockNumber }), client.readContract({ address: auction.engine, abi: engineAbi, functionName: 'previewBid', args: [bidId], blockNumber })])
	// A materialized bid belongs exclusively to the ordinary position registry.
	if (position.materialized || fill.filledLots === 0n) return undefined
	const vault = getAddress(position.vault)
	// The vault must be the exact clone the auction created for this bidder, ledger and bid.
	verifyAuctionVaultCode(await client.getCode({ address: vault, blockNumber }), { implementation: auction.vaultImplementation, owner: getAddress(fill.bidder), capital: snapshot.capitalLedger, auction: auction.address, bidId })
	const [owner, initialCapital, controller, id, mappedId] = await Promise.all([
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'owner', blockNumber }),
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'initialCapital', blockNumber }),
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'auction', blockNumber }),
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'bidId', blockNumber }),
		client.readContract({ address: auction.address, abi: auctionAbi, functionName: 'bidIdForVault', args: [vault], blockNumber }),
	])
	if (getAddress(fill.vault) !== vault || getAddress(owner) !== getAddress(fill.bidder) || getAddress(initialCapital) !== snapshot.capitalLedger || getAddress(controller) !== auction.address || id !== bidId || mappedId !== bidId || position.positionId !== 0n) throw new Error('Auction bid vault identity changed')
	return {
		id: bidId,
		auctionTarget: { auction: auction.address, bidId, vault },
		owner: vault,
		controllingOwner: getAddress(owner),
		batch: 0n,
		rep: position.principal,
		commitment: position.commitment,
		maxHealthyPrice: threshold,
		remainingCommitment: 0n,
		liquidationStarted: BigInt(position.liquidationStarted),
		retirementStatus: 'Not retiring',
		stalledRetirement: false,
	}
}
