import { encodeFunctionData, formatEther, formatUnits, getAddress, isAddress, isHex, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { minimumSecurityPoolHealthFactorBps } from './securityPoolCapital.js'
import type { SecurityPoolAuctionSnapshot } from './securityPoolAuctionRead.js'
export { loadSecurityPoolAuctionSnapshot, type SecurityPoolAuctionSnapshot, type SecurityPoolAuctionBid } from './securityPoolAuctionRead.js'

const abi = parseAbi([
	'function open()',
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot,uint256 targetHealthFactorBps) returns (uint256 bidId,address vault)',
	'function settleRefund(uint256 bidId)',
	'function materializeRepairAuctionBid(uint256 bidId) returns (address vault,uint96 positionId)',
	'function withdrawRefunds(address recipient)',
	'function settleAndWithdrawRefund(uint256 bidId,address recipient) returns (uint256 amountAttoEth)',
	'function execute(address target,uint256 value,bytes data) payable returns (bytes)',
	'function executeAndSweep(address target,uint256 value,bytes data,address token,address recipient) payable returns (bytes)',
	'function depositPrincipal(address ledger,uint256 amount,uint256 targetHealthFactorBps)',
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
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
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
	if (requiredCollateral > auction.inventoryAttoRep) return 'The auction inventory cannot back one collateral lot at the minimum health target.'
	return undefined
}
export function buildSecurityPoolAuctionOpenRequest(snapshot: SecurityPoolAuctionSnapshot) {
	const reason = securityPoolAuctionOpeningReason(snapshot)
	if (reason !== undefined) throw new Error(reason)
	return { account: snapshot.bidder, to: requireAuction(snapshot).address, value: 0n, data: encodeFunctionData({ abi, functionName: 'open' }) }
}
type SecurityPoolAuctionBidTerms = { lots: bigint; minimumAttoRepPerLot: bigint; targetHealthFactorBps: bigint }

/** Minimum grid-aligned ask for the chosen health target, using the price fixed when bidding opened. */
export function minimumSecurityPoolAuctionRepPerLot(auction: Pick<NonNullable<SecurityPoolAuctionSnapshot['auction']>, 'lotAttoEth' | 'openingConservativePrice' | 'securityMultiplierBps' | 'repGrid'>, targetHealthFactorBps: bigint) {
	const requiredBase = ceilDiv(auction.lotAttoEth * auction.openingConservativePrice, ATTO_UNITS)
	const requiredSecurity = ceilDiv(requiredBase * auction.securityMultiplierBps, BPS)
	return ceilDiv(ceilDiv(requiredSecurity * targetHealthFactorBps, BPS), auction.repGrid) * auction.repGrid
}

/** Every bid funds only the exact collateral lots. */
export function quoteSecurityPoolAuctionBid(snapshot: SecurityPoolAuctionSnapshot, terms: SecurityPoolAuctionBidTerms) {
	const auction = requireAuction(snapshot)
	if (!auction.opened || auction.finalized || snapshot.timestamp >= auction.closesAt || snapshot.forkTime !== 0n) throw new Error('This auction is not accepting bids.')
	const lots = uint(terms.lots, 'Bid lots')
	const minimumAttoRepPerLot = uint(terms.minimumAttoRepPerLot, 'Minimum REP per lot')
	const targetHealthFactorBps = uint(terms.targetHealthFactorBps, 'Health target')
	if (lots === 0n || minimumAttoRepPerLot === 0n || minimumAttoRepPerLot % auction.repGrid !== 0n) throw new Error('Use positive whole lots and an exact REP price-grid multiple.')
	if (minimumAttoRepPerLot > auction.maximumBidAttoRepPerLot) throw new Error('The minimum REP per lot exceeds the auction inventory.')
	if (targetHealthFactorBps < minimumSecurityPoolHealthFactorBps) throw new Error(`Choose a health target of at least ${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}%.`)
	const requiredPrincipalPerLotAttoRep = uint(minimumSecurityPoolAuctionRepPerLot(auction, targetHealthFactorBps), 'Required REP per lot')
	if (auction.maximumAdmissibleBidAttoRepPerLot < auction.minimumCollateralAttoRepPerLot) throw new Error('Better funded bids leave no admissible new limit.')
	if (minimumAttoRepPerLot < requiredPrincipalPerLotAttoRep) throw new Error(`Increase the minimum REP per lot to at least ${formatEther(requiredPrincipalPerLotAttoRep)} REP for the chosen health target.`)
	if (minimumAttoRepPerLot > auction.maximumAdmissibleBidAttoRepPerLot) throw new Error(auction.maximumAdmissibleBidAttoRepPerLot === 0n ? 'Better funded bids leave no admissible new limit.' : `Better funded bids exclude this limit. Use at most ${formatEther(auction.maximumAdmissibleBidAttoRepPerLot)} REP per lot.`)
	const bidAttoEth = uint(lots * auction.lotAttoEth, 'Bid collateral', 128)
	uint(auction.depositedAttoEth + bidAttoEth, 'Total bid collateral', 128)
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
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'submitBid', args: [quote.lots, quote.minimumAttoRepPerLot, quote.targetHealthFactorBps] }) }
}
export function buildSecurityPoolAuctionMaterializeRequest(snapshot: SecurityPoolAuctionSnapshot, bidId: bigint) {
	const auction = requireAuction(snapshot)
	const bid = auction.bids.find(candidate => candidate.id === uint(bidId, 'Bid ID'))
	if (!auction.finalized || bid === undefined || bid.fill === undefined || bid.fill.filledLots === 0n || bid.materialized) throw new Error('Choose a funded winning bid with an inactive auction position.')
	return { account: snapshot.bidder, to: snapshot.capitalLedger, value: 0n, data: encodeFunctionData({ abi, functionName: 'materializeRepairAuctionBid', args: [bidId] }) }
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
/** Call only after authenticating the vault owner and its original auction binding. */
export function buildSecurityPoolAuctionVaultExecuteRequest(parameters: { bidder: Address; vault: Address; request: { account: Address; to: Address; value: bigint; data: Hex }; fundingAttoEth?: bigint; sweep?: { repToken: Address; recipient: Address } }) {
	const vault = address(parameters.vault, 'Auction position')
	if (address(parameters.request.account, 'Capital position') !== vault) throw new Error('The capital transaction must belong to the selected auction position.')
	if (!isHex(parameters.request.data, { strict: true }) || parameters.request.data.length % 2 !== 0) throw new Error('Auction position call data must contain whole hexadecimal bytes.')
	const value = uint(parameters.request.value, 'Forwarded ETH')
	const target = address(parameters.request.to, 'Auction position target')
	const data =
		parameters.sweep === undefined
			? encodeFunctionData({ abi, functionName: 'execute', args: [target, value, parameters.request.data] })
			: encodeFunctionData({ abi, functionName: 'executeAndSweep', args: [target, value, parameters.request.data, address(parameters.sweep.repToken, 'Sweep REP token'), address(parameters.sweep.recipient, 'Sweep recipient')] })
	return { account: address(parameters.bidder, 'Position owner'), to: vault, value: uint(parameters.fundingAttoEth ?? value, 'Wallet ETH funding'), data }
}
/** The vault pulls the exact approved REP amount from its owner before depositing. */
export function buildSecurityPoolAuctionVaultDepositRequest(parameters: { bidder: Address; vault: Address; capitalLedger: Address; amountAttoRep: bigint; targetHealthFactorBps: bigint }) {
	if (uint(parameters.amountAttoRep, 'REP deposit') === 0n || uint(parameters.targetHealthFactorBps, 'Health target') < minimumSecurityPoolHealthFactorBps) throw new Error(`Choose a positive REP deposit and a health target of at least ${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}%.`)
	return { account: address(parameters.bidder, 'Position owner'), to: address(parameters.vault, 'Auction position'), value: 0n, data: encodeFunctionData({ abi, functionName: 'depositPrincipal', args: [address(parameters.capitalLedger, 'Capital contract'), parameters.amountAttoRep, parameters.targetHealthFactorBps] }) }
}
