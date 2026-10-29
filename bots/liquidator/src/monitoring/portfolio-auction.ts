import { portfolioRuntimeIdentities, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolPortfolioAuctionAbi as auctionAbi, securityPoolUniformPriceAuctionAbi as engineAbi, securityPoolAuctionVaultAbi as vaultAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, parseAbiItem, type Address } from '@zoltar/bot-shared/ethereum'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import type { PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import type { ReadClient } from './vault-positions.ts'
import type { PortfolioPosition, PortfolioScope } from './portfolio-monitor.ts'

export type PortfolioAuctionTarget = { auction: Address; bidId: bigint; vault: Address }
export type PortfolioTarget = bigint | PortfolioAuctionTarget
export const portfolioTarget = (position: PortfolioPosition): PortfolioTarget => position.auctionTarget ?? position.id
export function samePortfolioTarget(first: PortfolioTarget, second: PortfolioTarget) {
	return typeof first === 'bigint' || typeof second === 'bigint' ? first === second : first.auction === second.auction && first.bidId === second.bidId && first.vault === second.vault
}
const links = [parseAbiItem('function forkController() view returns (address)'), parseAbiItem('function auctions(uint248 universeId) view returns (address)')] as const

/** The frozen bid registry is paged separately from materialized index positions. */
export function portfolioAuctionPage(scope: PortfolioScope, count: bigint, maximum: number) {
	const end = scope.auctionSweepEnd === undefined || scope.auctionSweepEnd === 0n || scope.auctionSweepEnd > count ? count : scope.auctionSweepEnd
	const cursor = scope.nextAuctionBidId ?? 1n
	const start = cursor > end ? 1n : cursor
	const ids: bigint[] = []
	for (let id = start; id <= end && ids.length < maximum; id++) ids.push(id)
	const next = (ids.at(-1) ?? 0n) + 1n
	return { ids, nextAuctionBidId: next > end ? 1n : next, auctionSweepEnd: next > end ? 0n : end }
}

export async function authenticatePortfolioAuction(client: ReadClient, snapshot: PortfolioCapitalSnapshot, auction: Address) {
	const blockNumber = snapshot.blockNumber
	const [fork, portfolio, capital, universe, token, authority, engine, finalized] = await Promise.all([
		client.readContract({ address: snapshot.portfolio, abi: links, functionName: 'forkController', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'portfolio', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'capital', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'repToken', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'forkAuthority', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'engine', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'finalized', blockNumber }),
	])
	if (typeof fork !== 'string') throw new Error('Portfolio fork authority is invalid')
	verifyRuntimeIdentity(await client.getCode({ address: auction, blockNumber }), portfolioRuntimeIdentities.SecurityPoolPortfolioAuction, 'portfolio auction')
	verifyRuntimeIdentity(await client.getCode({ address: engine, blockNumber }), portfolioRuntimeIdentities.SecurityPoolUniformPriceAuction, 'auction engine')
	const [registered, controller, count, closed] = await Promise.all([
		client.readContract({ address: getAddress(fork), abi: links, functionName: 'auctions', args: [snapshot.universeId], blockNumber }),
		client.readContract({ address: engine, abi: engineAbi, functionName: 'controller', blockNumber }),
		client.readContract({ address: engine, abi: engineAbi, functionName: 'bidCount', blockNumber }),
		client.readContract({ address: engine, abi: engineAbi, functionName: 'finalized', blockNumber }),
	])
	if (typeof registered !== 'string') throw new Error('Portfolio auction registration is invalid')
	if (
		getAddress(portfolio) !== snapshot.portfolio ||
		getAddress(capital) !== snapshot.capitalLedger ||
		universe !== snapshot.universeId ||
		getAddress(token) !== snapshot.repToken ||
		getAddress(authority) !== getAddress(fork) ||
		getAddress(registered) !== auction ||
		getAddress(controller) !== auction ||
		!closed ||
		!finalized
	)
		throw new Error('Auction custody identity does not match finalized portfolio capital')
	return { address: auction, engine: getAddress(engine), bidCount: count }
}

export async function loadPortfolioAuctionPosition(client: ReadClient, snapshot: PortfolioCapitalSnapshot, auction: Awaited<ReturnType<typeof authenticatePortfolioAuction>>, bidId: bigint, threshold: bigint): Promise<PortfolioPosition | undefined> {
	if (bidId <= 0n || bidId > auction.bidCount) throw new Error('Auction bid is outside the authenticated registry')
	const blockNumber = snapshot.blockNumber
	const [position, fill] = await Promise.all([client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'auctionPosition', args: [bidId], blockNumber }), client.readContract({ address: auction.engine, abi: engineAbi, functionName: 'previewBid', args: [bidId], blockNumber })])
	// A materialized bid belongs exclusively to the ordinary position registry.
	if (position.materialized || fill.filledLots === 0n) return undefined
	const vault = getAddress(position.vault)
	verifyRuntimeIdentity(await client.getCode({ address: vault, blockNumber }), portfolioRuntimeIdentities.SecurityPoolAuctionVault, 'auction vault')
	const [owner, initialCapital, controller, id, mappedId, reserve, required] = await Promise.all([
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'owner', blockNumber }),
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'initialCapital', blockNumber }),
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'auction', blockNumber }),
		client.readContract({ address: vault, abi: vaultAbi, functionName: 'bidId', blockNumber }),
		client.readContract({ address: auction.address, abi: auctionAbi, functionName: 'bidIdForVault', args: [vault], blockNumber }),
		client.readContract({ address: auction.address, abi: auctionAbi, functionName: 'bidExecutionReserve', args: [bidId], blockNumber }),
		client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'requiredExecutionReserve', args: [position.commitment], blockNumber }),
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
		executionReserveAttoEth: reserve,
		requiredExecutionReserveAttoEth: required,
		liquidationStarted: BigInt(position.liquidationStarted),
		retirementStatus: 'Not retiring',
		stalledRetirement: false,
	}
}
