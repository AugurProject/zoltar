import { encodeFunctionData, formatEther, getAddress, isAddress, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import type { SecurityPoolAuctionSnapshot } from './securityPoolAuctionRead.js'
export { loadSecurityPoolAuctionSnapshot, loadSecurityPoolAuctionClaimableBidIds, type SecurityPoolAuctionSnapshot, type SecurityPoolAuctionBid } from './securityPoolAuctionRead.js'

const abi = parseAbi([
	'function open()',
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot) returns (uint256 bidId)',
	'function settleRefund(uint256 bidId)',
	'function materializeRepairAuctionBids(uint256[] bidIds) returns (uint96[] positionIds)',
	'function withdrawRefunds(address recipient)',
	'function settleAndWithdrawRefund(uint256 bidId,address recipient) returns (uint256 amountAttoEth)',
])
const ATTO_UNITS = 10n ** 18n
const BPS = 10_000n
const secondsPerDay = 86_400n
const minimumAuctionOpeningDays = 1n
function address(value: Address, label: string) {
	if (!isAddress(value) || getAddress(value) === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}
function uint(value: bigint, label: string, bits = 256) {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} is out of range.`)
	return value
}
function requireAuction(snapshot: SecurityPoolAuctionSnapshot) {
	if (snapshot.auction === undefined) throw new Error('This branch has no repair auction.')
	return snapshot.auction
}

/** Opening requires a funded observation; it cannot guarantee later profitability. */
export function securityPoolAuctionOpeningReason(snapshot: SecurityPoolAuctionSnapshot): string | undefined {
	const auction = snapshot.auction
	if (auction === undefined) return 'Start a branch with saleable REP and a collateral shortfall first.'
	if (auction.finalized) return 'This auction is finalized.'
	if (auction.opened) return 'This auction is already open.'
	if (snapshot.timestamp >= auction.closesAt) return 'The auction window has closed.'
	if (auction.closesAt - snapshot.timestamp < minimumAuctionOpeningDays * secondsPerDay) return `Opening requires at least ${minimumAuctionOpeningDays} day for competitive bidding.`
	if (snapshot.forkTime !== 0n) return 'This auction universe has forked.'
	if (auction.targetLots === 0n || auction.inventoryAttoRep === 0n) return 'This branch has no saleable auction lots.'
	const price = auction.price
	if (price === undefined || price.lastSettlementTimestamp === 0n || price.lastSettlementTimestamp > snapshot.timestamp || price.validUntil <= snapshot.timestamp || price.conservativePrice === 0n) return 'Accept a fresh branch REP price report first.'
	if (price.exposureLimitAttoEth < price.requiredExposureAttoEth || price.exposureLimitAttoRep < auction.inventoryAttoRep) return 'The price report must cover the branch collateral exposure and auction REP inventory.'
	let targetLots = auction.targetLots
	let lot = auction.lotAttoEth
	const requiredForLot = () => ceilDiv(ceilDiv(lot * price.conservativePrice, ATTO_UNITS) * auction.securityMultiplierBps, BPS)
	let required = requiredForLot()
	while (targetLots > 1n && (ceilDiv(required, auction.repGrid) * auction.repGrid - required) * 100n >= required) {
		// Mirrors the contract: half as many equal lots that still cover the whole deficit.
		const resized = ceilDiv(auction.shortfallAttoEth, targetLots / 2n)
		lot = resized > auction.lotAttoEth ? resized : auction.lotAttoEth
		targetLots = ceilDiv(auction.shortfallAttoEth, lot)
		required = requiredForLot()
	}
	const requiredCollateral = ceilDiv(required, auction.repGrid) * auction.repGrid
	if (requiredCollateral === 0n || requiredCollateral > auction.inventoryAttoRep) return 'The auction inventory cannot back one collateral lot at the minimum health target.'
	if (price.exposureLimitAttoEth < auction.chosenCommitmentAttoEth + targetLots * lot) return 'The price report must cover the final auction collateral exposure.'
	return undefined
}
export function buildSecurityPoolAuctionOpenRequest(snapshot: SecurityPoolAuctionSnapshot) {
	const reason = securityPoolAuctionOpeningReason(snapshot)
	if (reason !== undefined) throw new Error(reason)
	return { account: snapshot.bidder, to: requireAuction(snapshot).address, value: 0n, data: encodeFunctionData({ abi, functionName: 'open' }) }
}
type SecurityPoolAuctionBidTerms = { lots: bigint; minimumAttoRepPerLot: bigint }

/**
 * Every bid funds only the exact collateral lots. Winning lots join the bidder's own
 * capital account at the protocol's minimum health; the owner chooses any higher
 * health target there after the auction.
 */
export function quoteSecurityPoolAuctionBid(snapshot: SecurityPoolAuctionSnapshot, terms: SecurityPoolAuctionBidTerms) {
	const auction = requireAuction(snapshot)
	if (!auction.opened || auction.finalized || snapshot.timestamp >= auction.closesAt || snapshot.forkTime !== 0n) throw new Error('This auction is not accepting bids.')
	const lots = uint(terms.lots, 'Bid lots')
	const minimumAttoRepPerLot = uint(terms.minimumAttoRepPerLot, 'Minimum REP per lot')
	if (lots === 0n || minimumAttoRepPerLot === 0n || minimumAttoRepPerLot % auction.repGrid !== 0n) throw new Error('Use positive whole lots and an exact REP price-grid multiple.')
	if (minimumAttoRepPerLot > auction.maximumBidAttoRepPerLot) throw new Error('The minimum REP per lot exceeds the auction inventory.')
	const requiredPrincipalPerLotAttoRep = auction.minimumCollateralAttoRepPerLot
	const bidAttoEth = uint(lots * auction.lotAttoEth, 'Bid collateral', 128)
	uint(auction.depositedAttoEth + bidAttoEth, 'Total bid collateral', 128)
	if (auction.maximumAdmissibleBidAttoRepPerLot < requiredPrincipalPerLotAttoRep) throw new Error('Better funded bids leave no admissible new limit.')
	if (minimumAttoRepPerLot < requiredPrincipalPerLotAttoRep) throw new Error(`Increase the minimum REP per lot to at least ${formatEther(requiredPrincipalPerLotAttoRep)} REP to back each lot.`)
	if (minimumAttoRepPerLot > auction.maximumAdmissibleBidAttoRepPerLot) throw new Error(auction.maximumAdmissibleBidAttoRepPerLot === 0n ? 'Better funded bids leave no admissible new limit.' : `Better funded bids exclude this limit. Use at most ${formatEther(auction.maximumAdmissibleBidAttoRepPerLot)} REP per lot.`)
	return {
		...terms,
		bidAttoEth,
		requiredPrincipalPerLotAttoRep,
		minimumPrincipalAttoRep: uint(lots * minimumAttoRepPerLot, 'Minimum winning REP'),
		maximumPrice: { attoEth: auction.lotAttoEth, attoRep: minimumAttoRepPerLot },
	}
}
export function buildSecurityPoolAuctionBidRequest(snapshot: SecurityPoolAuctionSnapshot, terms: SecurityPoolAuctionBidTerms) {
	const auction = requireAuction(snapshot)
	const quote = quoteSecurityPoolAuctionBid(snapshot, terms)
	if (snapshot.collateralAllowance < quote.bidAttoEth) throw new Error('Collateral approval required.')
	if (snapshot.walletCollateral < quote.bidAttoEth) throw new Error('Insufficient collateral for the bid.')
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'submitBid', args: [quote.lots, quote.minimumAttoRepPerLot] }) }
}
/** Why a bid cannot be claimed now, or undefined when it can. Anyone may claim any bid; the UI claims the bidder's own. */
export function securityPoolAuctionClaimReason(snapshot: SecurityPoolAuctionSnapshot, bidId: bigint): string | undefined {
	const auction = requireAuction(snapshot)
	const bid = auction.bids.find(candidate => candidate.id === uint(bidId, 'Bid ID'))
	if (bid === undefined) return 'Choose a bid from this auction page.'
	if (bid.claimed) return 'This bid is claimed.'
	if (!bid.claimable) return 'This bid can be claimed after the auction closes.'
	if (auction.capitalImporting) return 'Bids can be claimed after the branch finishes importing capital.'
	return undefined
}
/**
 * Most bids one claim transaction carries. Sixteen winning claims measured about 8.8M gas,
 * about half the 2^24 per-transaction gas limit, leaving room for larger bid trees.
 */
export const MAX_REPAIR_AUCTION_CLAIM_BATCH = 16
/** The next claim batch of `bidIds`; `completes` says no bid is left for a later transaction. */
export const securityPoolAuctionClaimBatch = (bidIds: readonly bigint[]) => ({ bidIds: bidIds.slice(0, MAX_REPAIR_AUCTION_CLAIM_BATCH), completes: bidIds.length <= MAX_REPAIR_AUCTION_CLAIM_BATCH })
/**
 * Claims the given bids, at most `MAX_REPAIR_AUCTION_CLAIM_BATCH`, in one transaction. A winning bid's lots join the
 * bidder's capital account; a bid that won nothing is only marked claimed. Every bid must be claimed before its bidder
 * can choose a branch in a later fork.
 */
export function buildSecurityPoolAuctionMaterializeRequest(snapshot: SecurityPoolAuctionSnapshot, bidIds: readonly bigint[]) {
	requireAuction(snapshot)
	if (bidIds.length === 0) throw new Error('Choose at least one bid to claim.')
	if (bidIds.length > MAX_REPAIR_AUCTION_CLAIM_BATCH) throw new Error(`Claim at most ${MAX_REPAIR_AUCTION_CLAIM_BATCH} bids per transaction.`)
	if (new Set(bidIds).size !== bidIds.length) throw new Error('Choose each bid once.')
	for (const bidId of bidIds) {
		const reason = securityPoolAuctionClaimReason(snapshot, bidId)
		if (reason !== undefined) throw new Error(reason)
	}
	return { account: snapshot.bidder, to: snapshot.capitalLedger, value: 0n, data: encodeFunctionData({ abi, functionName: 'materializeRepairAuctionBids', args: [[...bidIds]] }) }
}
/**
 * Claims the bidder's bids that can be claimed now, across all pages: the first
 * `MAX_REPAIR_AUCTION_CLAIM_BATCH` of them, so the transaction always fits in a block.
 * Repeat for the rest.
 */
export function buildSecurityPoolAuctionClaimAllRequest(snapshot: SecurityPoolAuctionSnapshot, claimableBidIds: readonly bigint[]) {
	if (requireAuction(snapshot).capitalImporting) throw new Error('Bids can be claimed after the branch finishes importing capital.')
	if (claimableBidIds.length === 0) throw new Error('No bids are waiting to be claimed.')
	if (new Set(claimableBidIds).size !== claimableBidIds.length) throw new Error('Choose each bid once.')
	const batch = securityPoolAuctionClaimBatch(claimableBidIds).bidIds
	return { account: snapshot.bidder, to: snapshot.capitalLedger, value: 0n, data: encodeFunctionData({ abi, functionName: 'materializeRepairAuctionBids', args: [batch.map(id => uint(id, 'Bid ID'))] }) }
}
export function buildSecurityPoolAuctionRefundCreditRequest(snapshot: SecurityPoolAuctionSnapshot, bidId: bigint) {
	const auction = requireAuction(snapshot)
	const bid = auction.bids.find(candidate => candidate.id === uint(bidId, 'Bid ID'))
	if (bid === undefined || bid.refundSettled) throw new Error('Choose an unsettled bid from this auction page.')
	if (!auction.finalized && bid.earlyRefundAttoEth === 0n) throw new Error('This bid may still win. Its collateral remains committed until closing.')
	if (auction.finalized && (bid.fill?.refundAttoEth ?? 0n) === 0n) throw new Error('This bid has no unused collateral to refund.')
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'settleRefund', args: [bidId] }) }
}
export function buildSecurityPoolAuctionRefundWithdrawRequest(snapshot: SecurityPoolAuctionSnapshot, recipient: Address) {
	const auction = requireAuction(snapshot)
	if (auction.refundAttoEth === 0n) throw new Error('This bidder has no credited auction refunds.')
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'withdrawRefunds', args: [address(recipient, 'Refund recipient')] }) }
}
/**
 * One bidder transaction: credit the chosen bid unless someone already did, then withdraw the bidder's whole credit.
 * The withdrawal always includes refunds already credited for the bidder's other bids in this auction.
 */
export function quoteSecurityPoolAuctionRefundClaim(snapshot: SecurityPoolAuctionSnapshot, bidId: bigint) {
	const auction = requireAuction(snapshot)
	const bid = auction.bids.find(candidate => candidate.id === uint(bidId, 'Bid ID'))
	if (bid === undefined) throw new Error('Choose a bid from this auction page.')
	let bidRefundAttoEth = 0n
	if (!bid.refundSettled) {
		if (auction.finalized) bidRefundAttoEth = bid.fill?.refundAttoEth ?? 0n
		else if (bid.earlyRefundAttoEth === 0n) throw new Error('This bid may still win. Its collateral remains committed until closing.')
		else bidRefundAttoEth = bid.earlyRefundAttoEth
	}
	const creditedAttoEth = auction.refundAttoEth
	const totalAttoEth = creditedAttoEth + bidRefundAttoEth
	if (totalAttoEth === 0n) throw new Error('No refund credit remains to withdraw.')
	return { bidId: bid.id, settles: !bid.refundSettled, bidRefundAttoEth, creditedAttoEth, totalAttoEth }
}
export function buildSecurityPoolAuctionRefundClaimRequest(snapshot: SecurityPoolAuctionSnapshot, bidId: bigint, recipient: Address) {
	const auction = requireAuction(snapshot)
	const quote = quoteSecurityPoolAuctionRefundClaim(snapshot, bidId)
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'settleAndWithdrawRefund', args: [quote.bidId, address(recipient, 'Refund recipient')] }) }
}
