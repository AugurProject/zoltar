import { securityPoolRuntimeIdentities, securityPoolCapitalLedgerAbi as capitalAbi, securityPoolCommitmentIndexAbi as indexAbi, securityPoolRepairAuctionAbi as auctionAbi, securityPoolUniformPriceRepairAuctionAbi as engineAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, parseAbiItem, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { verifyRuntimeIdentity } from '@zoltar/bot-shared/monitoring/runtime-identity'
import type { SecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'
import { record } from '@zoltar/bot-shared/infrastructure/json-validation'
import type { ReadClient } from './read-client.ts'
import type { SecurityPoolPosition } from './security-pool-monitor.ts'

/** A winning bid whose lots have not been claimed into its bidder's account. A takeover first claims this one bid into the bidder's position. */
export type SecurityPoolAuctionTarget = { auction: Address; bidId: bigint; bidder: Address }
export type SecurityPoolTarget = bigint | SecurityPoolAuctionTarget
export const securityPoolTarget = (position: SecurityPoolPosition): SecurityPoolTarget => position.auctionTarget ?? position.id
export function sameSecurityPoolTarget(first: SecurityPoolTarget, second: SecurityPoolTarget) {
	return typeof first === 'bigint' || typeof second === 'bigint' ? first === second : first.auction === second.auction && first.bidId === second.bidId && first.bidder === second.bidder
}
function uint(value: unknown): bigint {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
	if (typeof value !== 'bigint' || value < 0n || value >= 2n ** 256n) throw new Error('Invalid auction position integer response')
	return value
}
function address(value: unknown): Address {
	if (typeof value !== 'string') throw new Error('Invalid auction position address response')
	return getAddress(value)
}
const links = [parseAbiItem('function forkController() view returns (address)'), parseAbiItem('function repairAuctions(uint248 universeId) view returns (address)')] as const

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
	const [fork, securityPool, capital, universe, token, authority, engine, finalized] = await Promise.all([
		client.readContract({ address: snapshot.securityPool, abi: links, functionName: 'forkController', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'securityPool', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'capital', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'universeId', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'repToken', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'forkAuthority', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'engine', blockNumber }),
		client.readContract({ address: auction, abi: auctionAbi, functionName: 'finalized', blockNumber }),
	])
	if (typeof fork !== 'string') throw new Error('Security pool fork authority is invalid')
	verifyRuntimeIdentity(await client.getCode({ address: auction, blockNumber }), securityPoolRuntimeIdentities.SecurityPoolRepairAuction, 'security pool auction')
	verifyRuntimeIdentity(await client.getCode({ address: engine, blockNumber }), securityPoolRuntimeIdentities.SecurityPoolUniformPriceRepairAuction, 'auction engine')
	const [registered, controller, count, closed] = await Promise.all([
		client.readContract({ address: getAddress(fork), abi: links, functionName: 'repairAuctions', args: [snapshot.universeId], blockNumber }),
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
	return { address: auction, engine: getAddress(engine), bidCount: count }
}

/**
 * A takeover of a winning bid first claims that one bid, moving its lots into the bidder's own position (merging into
 * any position the bidder already held), so the target is that resulting position, not the bid's lots alone. The claim
 * is simulated at the pinned block to read the exact position the takeover would act on.
 */
export async function loadSecurityPoolAuctionPosition(client: ReadClient, multicall3: Address, snapshot: SecurityPoolCapitalSnapshot, auction: Awaited<ReturnType<typeof authenticateSecurityPoolAuction>>, bidId: bigint): Promise<SecurityPoolPosition | undefined> {
	if (bidId <= 0n || bidId > auction.bidCount) throw new Error('Auction bid is outside the authenticated registry')
	const blockNumber = snapshot.blockNumber
	const [positions, fill] = await Promise.all([client.readContract({ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'repairAuctionPositions', args: [[bidId]], blockNumber }), client.readContract({ address: auction.engine, abi: engineAbi, functionName: 'previewBid', args: [bidId], blockNumber })])
	const [position] = positions
	if (position === undefined || positions.length !== 1) throw new Error('Auction bid position response is invalid')
	// A claimed bid belongs exclusively to the ordinary position registry.
	if (position.claimed || fill.filledLots === 0n) return undefined
	const bidder = getAddress(position.bidder)
	if (bidder === zeroAddress || getAddress(fill.bidder) !== bidder) throw new Error('Auction bid identity changed')
	const materialize = { address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'materializeRepairAuctionBids', args: [[bidId]] } as const
	const [joined] = await client.multicall({ contracts: [materialize], allowFailure: false, blockNumber, multicallAddress: multicall3 })
	const id = joined?.[0]
	if (joined === undefined || joined.length !== 1 || id === undefined || id === 0n) throw new Error('Auction bid did not join its bidder position')
	const merged = await client.multicall({
		contracts: [
			materialize,
			{ address: snapshot.commitmentIndex, abi: indexAbi, functionName: 'accountOf', args: [id] },
			{ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'liquidationStarted', args: [id] },
			{ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'liquidationPenaltyPaid', args: [id] },
			{ address: snapshot.capitalLedger, abi: capitalAbi, functionName: 'liquidationElapsed', args: [id] },
		],
		allowFailure: false,
		blockNumber,
		multicallAddress: multicall3,
	})
	const account = record(merged[1], 'Merged auction position')
	if (address(account['owner']) !== bidder) throw new Error('Merged auction position belongs to another owner')
	const batch = uint(account['batch'])
	return {
		id: bidId,
		auctionTarget: { auction: auction.address, bidId, bidder },
		owner: bidder,
		batch,
		rep: uint(account['rep']),
		commitment: uint(account['commitment']),
		maxHealthyPrice: uint(account['maxHealthyPrice']),
		remainingCommitment: uint(account['remainingCommitment']),
		liquidationStarted: uint(merged[2]),
		liquidationElapsed: uint(merged[4]),
		liquidationPenaltyPaid: uint(merged[3]),
		retirementStatus: batch === 0n ? 'No pending reduction' : 'Bidder position is retiring',
		stalledRetirement: false,
	}
}
