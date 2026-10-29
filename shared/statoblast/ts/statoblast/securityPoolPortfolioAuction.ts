import { encodeFunctionData, getAddress, isAddress, isHex, parseAbi, zeroAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { PortfolioAuctionSnapshot } from './securityPoolPortfolioAuctionRead.js'
export { loadPortfolioAuctionSnapshot, type PortfolioAuctionSnapshot, type PortfolioAuctionBid } from './securityPoolPortfolioAuctionRead.js'

const abi = parseAbi([
	'function open()',
	'function approve(address spender,uint256 amount) returns (bool)',
	'function submitBid(uint256 lots,uint256 minimumAttoRepPerLot,uint256 targetHealthFactorBps,uint256 executionReservePerLotAttoEth) payable returns (uint256 bidId,address vault)',
	'function settleRefund(uint256 bidId)',
	'function materializeAuctionBid(uint256 bidId) returns (address vault,uint96 positionId)',
	'function withdrawRefunds(address recipient)',
	'function execute(address target,uint256 value,bytes data) payable returns (bytes)',
	'function executeAndSweep(address target,uint256 value,bytes data,address token,address recipient) payable returns (bytes)',
	'function depositPrincipal(address ledger,uint256 amount,uint256 targetHealthFactorBps)',
])
const ATTO_UNITS = 10n ** 18n
const BPS = 10_000n
function address(value: Address, label: string) {
	if (!isAddress(value) || getAddress(value) === zeroAddress) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}
function uint(value: bigint, label: string, bits = 256) {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return value
}
function ceilDiv(value: bigint, denominator: bigint) {
	return value === 0n ? 0n : (value - 1n) / denominator + 1n
}
function requireAuction(snapshot: PortfolioAuctionSnapshot) {
	if (snapshot.auction === undefined) throw new Error('This branch has no truth auction.')
	return snapshot.auction
}

/** The reserve protects a funded price observation; it cannot guarantee later profitability. */
export function portfolioAuctionOpeningReason(snapshot: PortfolioAuctionSnapshot): string | undefined {
	const auction = snapshot.auction
	if (auction === undefined) return 'Start a branch with saleable REP and an ETH shortfall first.'
	if (auction.finalized) return 'This auction is finalized.'
	if (auction.opened) return 'This auction is already open.'
	if (snapshot.timestamp >= auction.closesAt) return 'The auction window has closed.'
	if (snapshot.forkTime !== 0n) return 'This auction universe has forked.'
	if (auction.targetLots === 0n || auction.inventoryAttoRep === 0n) return 'This branch has no saleable auction lots.'
	const price = auction.price
	if (price === undefined || price.lastSettlementTimestamp === 0n || price.lastSettlementTimestamp > snapshot.timestamp || price.validUntil <= snapshot.timestamp || price.conservativePrice === 0n || price.liquidationPrice === 0n) return 'Accept a fresh branch REP price report first.'
	if (price.exposureLimitAttoEth < price.requiredExposureAttoEth || price.exposureLimitAttoRep < auction.inventoryAttoRep) return 'The price report must cover the branch ETH exposure and auction REP inventory.'
	const oracleReserve = (auction.lotAttoEth * price.liquidationPrice) / (10n ** 14n * snapshot.auctionReserveFactorBps)
	const inventoryReserve = auction.inventoryAttoRep / auction.targetLots
	if ((oracleReserve < inventoryReserve ? oracleReserve : inventoryReserve) < auction.repGrid) return 'The auction reserve cannot fund one REP price unit per lot.'
	return undefined
}
export function buildPortfolioAuctionOpenRequest(snapshot: PortfolioAuctionSnapshot) {
	const reason = portfolioAuctionOpeningReason(snapshot)
	if (reason !== undefined) throw new Error(reason)
	return { account: snapshot.bidder, to: requireAuction(snapshot).address, value: 0n, data: encodeFunctionData({ abi, functionName: 'open' }) }
}
export function buildPortfolioAuctionApprovalRequest(snapshot: PortfolioAuctionSnapshot, allowanceAttoRep: bigint) {
	const auction = requireAuction(snapshot)
	return { account: snapshot.bidder, to: snapshot.repToken, value: 0n, data: encodeFunctionData({ abi, functionName: 'approve', args: [auction.address, uint(allowanceAttoRep, 'REP allowance')] }) }
}
type PortfolioAuctionBidTerms = { lots: bigint; minimumAttoRepPerLot: bigint; targetHealthFactorBps: bigint; executionReservePerLotAttoEth: bigint }
/** Every bid is an exact ETH lot, plus full REP top-up and its explicitly signed reserve. */
export function quotePortfolioAuctionBid(snapshot: PortfolioAuctionSnapshot, terms: PortfolioAuctionBidTerms) {
	const auction = requireAuction(snapshot)
	if (!auction.opened || auction.finalized || snapshot.timestamp >= auction.closesAt || snapshot.forkTime !== 0n) throw new Error('This auction is not accepting bids.')
	const lots = uint(terms.lots, 'Bid lots')
	const minimumAttoRepPerLot = uint(terms.minimumAttoRepPerLot, 'Minimum REP per lot')
	const targetHealthFactorBps = uint(terms.targetHealthFactorBps, 'Health target')
	const executionReservePerLotAttoEth = uint(terms.executionReservePerLotAttoEth, 'Execution reserve per lot')
	if (lots === 0n || minimumAttoRepPerLot === 0n || minimumAttoRepPerLot % auction.repGrid !== 0n) throw new Error('Use positive whole lots and an exact REP price-grid multiple.')
	if (minimumAttoRepPerLot > auction.maximumAttoRepPerLot) throw new Error('The bid price is below the auction reserve.')
	if (targetHealthFactorBps < BPS) throw new Error('The chosen health target must be at least 100%.')
	if (executionReservePerLotAttoEth < auction.minimumExecutionReservePerLotAttoEth) throw new Error('The execution reserve budget is below the current minimum. Review the updated funding amount.')
	const requiredBase = ceilDiv(auction.lotAttoEth * auction.openingConservativePrice, ATTO_UNITS)
	const requiredSecurity = ceilDiv(requiredBase * auction.securityMultiplierBps, BPS)
	const requiredPrincipalPerLotAttoRep = uint(ceilDiv(requiredSecurity * targetHealthFactorBps, BPS), 'Required REP per lot')
	if (minimumAttoRepPerLot + auction.topUpPerLotAttoRep < requiredPrincipalPerLotAttoRep) throw new Error('The bid does not provide enough REP for the chosen health target.')
	const bidAttoEth = uint(lots * auction.lotAttoEth, 'Bid ETH', 128)
	uint(auction.depositedAttoEth + bidAttoEth, 'Total auction bid escrow', 128)
	const topUpAttoRep = uint(lots * auction.topUpPerLotAttoRep, 'REP top-up')
	const executionReserveAttoEth = uint(lots * executionReservePerLotAttoEth, 'Execution reserve')
	const totalAttoEth = uint(bidAttoEth + executionReserveAttoEth, 'Total ETH funding')
	return {
		...terms,
		bidAttoEth,
		topUpAttoRep,
		executionReserveAttoEth,
		totalAttoEth,
		requiredPrincipalPerLotAttoRep,
		minimumPurchasedAttoRep: uint(lots * minimumAttoRepPerLot, 'Minimum purchased REP'),
		minimumPrincipalAttoRep: uint(lots * (minimumAttoRepPerLot + auction.topUpPerLotAttoRep), 'Minimum winning REP'),
		maximumPrice: { attoEth: auction.lotAttoEth, attoRep: minimumAttoRepPerLot },
	}
}
export function buildPortfolioAuctionBidRequest(snapshot: PortfolioAuctionSnapshot, terms: PortfolioAuctionBidTerms) {
	const auction = requireAuction(snapshot)
	const quote = quotePortfolioAuctionBid(snapshot, terms)
	if (auction.walletAttoRep < quote.topUpAttoRep) throw new Error('Insufficient REP for the bid top-up.')
	if (auction.allowanceAttoRep < quote.topUpAttoRep) throw new Error('Approve the auction to spend the bid REP top-up first.')
	if (snapshot.walletAttoEth < quote.totalAttoEth) throw new Error('Insufficient ETH for the bid and execution reserve.')
	return { account: snapshot.bidder, to: auction.address, value: quote.totalAttoEth, data: encodeFunctionData({ abi, functionName: 'submitBid', args: [quote.lots, quote.minimumAttoRepPerLot, quote.targetHealthFactorBps, quote.executionReservePerLotAttoEth] }) }
}
export function buildPortfolioAuctionMaterializeRequest(snapshot: PortfolioAuctionSnapshot, bidId: bigint) {
	const auction = requireAuction(snapshot)
	const bid = auction.bids.find(candidate => candidate.id === uint(bidId, 'Bid ID'))
	if (!auction.finalized || bid === undefined || bid.fill === undefined || bid.fill.filledLots === 0n || bid.materialized) throw new Error('Choose a funded winning bid whose individual vault controls are not active.')
	return { account: snapshot.bidder, to: snapshot.capitalLedger, value: 0n, data: encodeFunctionData({ abi, functionName: 'materializeAuctionBid', args: [bidId] }) }
}
export function buildPortfolioAuctionRefundCreditRequest(snapshot: PortfolioAuctionSnapshot, bidId: bigint) {
	const auction = requireAuction(snapshot)
	const bid = auction.bids.find(candidate => candidate.id === uint(bidId, 'Bid ID'))
	if (!auction.finalized || bid === undefined || bid.refundSettled) throw new Error('Choose an unsettled bid from this finalized auction page.')
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'settleRefund', args: [bidId] }) }
}
export function buildPortfolioAuctionRefundWithdrawRequest(snapshot: PortfolioAuctionSnapshot, recipient: Address) {
	const auction = requireAuction(snapshot)
	if (auction.refundAttoEth === 0n && auction.refundAttoRep === 0n) throw new Error('This bidder has no credited auction refunds.')
	return { account: snapshot.bidder, to: auction.address, value: 0n, data: encodeFunctionData({ abi, functionName: 'withdrawRefunds', args: [address(recipient, 'Refund recipient')] }) }
}
/** Call only after authenticating the vault owner and its original auction binding. */
export function buildPortfolioAuctionVaultExecuteRequest(parameters: { bidder: Address; vault: Address; request: { account: Address; to: Address; value: bigint; data: Hex }; fundingAttoEth?: bigint; sweep?: { repToken: Address; recipient: Address } }) {
	const vault = address(parameters.vault, 'Auction vault')
	if (address(parameters.request.account, 'Capital account') !== vault) throw new Error('The capital transaction must belong to the selected auction vault.')
	if (!isHex(parameters.request.data, { strict: true }) || parameters.request.data.length % 2 !== 0) throw new Error('Vault call data must contain whole hexadecimal bytes.')
	const value = uint(parameters.request.value, 'Forwarded ETH')
	const target = address(parameters.request.to, 'Vault target')
	const data =
		parameters.sweep === undefined
			? encodeFunctionData({ abi, functionName: 'execute', args: [target, value, parameters.request.data] })
			: encodeFunctionData({ abi, functionName: 'executeAndSweep', args: [target, value, parameters.request.data, address(parameters.sweep.repToken, 'Sweep REP token'), address(parameters.sweep.recipient, 'Sweep recipient')] })
	return { account: address(parameters.bidder, 'Vault owner'), to: vault, value: uint(parameters.fundingAttoEth ?? value, 'Wallet ETH funding'), data }
}
/** The vault pulls the exact approved REP amount from its owner before depositing. */
export function buildPortfolioAuctionVaultDepositRequest(parameters: { bidder: Address; vault: Address; capitalLedger: Address; amountAttoRep: bigint; targetHealthFactorBps: bigint }) {
	if (uint(parameters.amountAttoRep, 'REP deposit') === 0n || uint(parameters.targetHealthFactorBps, 'Health target') < BPS) throw new Error('Choose a positive REP deposit and a health target of at least 100%.')
	return { account: address(parameters.bidder, 'Vault owner'), to: address(parameters.vault, 'Auction vault'), value: 0n, data: encodeFunctionData({ abi, functionName: 'depositPrincipal', args: [address(parameters.capitalLedger, 'Capital ledger'), parameters.amountAttoRep, parameters.targetHealthFactorBps] }) }
}
