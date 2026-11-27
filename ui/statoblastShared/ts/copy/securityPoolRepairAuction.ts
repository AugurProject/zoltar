import { minimumSecurityPoolHealthFactorBps } from '@zoltar/statoblast-shared/statoblast/securityPool'

import { formatEther, formatUnits } from '@zoltar/core-shared/evm/ethereum'
export const title = 'Repair auction'
export const description = 'Lowest REP asks fill first. Every winning lot gets the higher of the highest winning ask and the minimum REP needed to back a lot at closing.'
export const ownership = 'Claiming a winning bid adds its lots to this wallet’s position on this branch at the minimum health. If the wallet already has a position there, the lots merge into it and share its health target, losses and pending reductions. Bid from a fresh address to keep them separate.'
export const fairness = 'Equal asks fill in submission order. Unfilled lots are refunded. Bids cannot be cancelled or changed.'
export const connect = 'Connect a wallet to view and fund your auction bids.'
export const selectBranch = 'Select a fork branch first.'
export const noAuction = 'Start branch migration with a collateral shortfall and saleable REP first.'
export const loading = 'Checking auction funding…'
export const loadError = 'Unable to load this branch auction.'
export const contextChanged = 'Auction, wallet or network changed. Refresh and review again.'
export const fundingChanged = 'Auction funding changed. Refresh and review the new amounts.'
export const quoteError = 'Invalid auction bid funding.'
export const open = 'Open repair auction'
export const opening = 'Opening repair auction…'
export const closed = 'The auction bidding window is closed.'
export const openFirst = 'Open the auction after accepting a funded branch price report.'
export const status = 'Auction state'
export const states = { unopened: 'Awaiting opening', bidding: 'Accepting bids', waiting: 'Awaiting branch activation', finalized: 'Finalized' }
export const inventory = 'REP available for sale'
export const shortfall = 'Branch collateral shortfall'
export const lotCount = 'Number of lots'
export const lotHint = 'Positive whole lots only. Each winning lot becomes one commitment at the displayed collateral amount.'
export const lotsInvalid = 'Enter a positive whole number of lots.'
export const minimumRep = 'REP you want per lot, at least'
export const priceHint = (grid: bigint | undefined) => (grid === undefined ? 'Checking REP price step.' : `Use multiples of ${formatEther(grid)} REP.`)
export const repInvalid = 'Enter a positive REP amount with up to 18 decimal places.'
export const clearingRep = 'Clearing REP per winning lot'
export const purchasedPrincipal = 'REP pledged at closing'
export const bid = 'Submit funded bid'
export const bidding = 'Submitting funded bid…'
export const yourBids = 'Your auction bids'
export const noBids = 'No bids from this wallet'
export const bidLabel = (id: bigint) => `Bid ${id}`
export const principal = 'REP pledged by this bid'
export const commitment = 'Current collateral commitment'
export const earnedEth = 'Unclaimed collateral fees'
export const earnedRep = 'Unclaimed REP fees'
export const funded = 'Winning lots'
export const noFill = 'No winning lots'
export const closedWithShortfall = 'No lots sold. Bid collateral is refundable. The branch activates with its collateral shortfall.'
export const credit = 'Credit this bid’s refunds'
export const crediting = 'Crediting bid refunds…'
export const credited = 'This bid’s refunds are already credited.'
export const bidMayStillWin = 'This bid may still win. Its collateral remains committed until closing.'
export const earlyRefundSettled = 'This bid’s refund was settled. Check your wallet’s total refund credit below.'
export const claim = 'Credit and withdraw refunds'
export const claiming = 'Withdrawing bid refunds…'
export const refundChanged = 'Your refund credit changed. Refresh and review the new amount.'
export const claimReview = (quote: { settles: boolean; bidRefundAttoEth: bigint; creditedAttoEth: bigint; totalAttoEth: bigint }, decimals = 18, symbol = 'collateral') => {
	if (quote.creditedAttoEth === 0n) return `Credit this bid’s ${formatUnits(quote.bidRefundAttoEth, decimals)} ${symbol} refund and withdraw it to your wallet.`
	if (!quote.settles) return `This bid’s refund is already credited. Withdraw your entire ${formatUnits(quote.totalAttoEth, decimals)} ${symbol} auction refund credit, possibly including your other bids, to your wallet.`
	return `Credit this bid’s ${formatUnits(quote.bidRefundAttoEth, decimals)} ${symbol} refund and withdraw your entire ${formatUnits(quote.totalAttoEth, decimals)} ${symbol} auction refund credit to your wallet, including ${formatUnits(quote.creditedAttoEth, decimals)} ${symbol} already credited, possibly from your other bids.`
}
export const refundEth = 'Credited collateral refund'
export const withdraw = 'Withdraw credited refunds'
export const withdrawing = 'Withdrawing auction refunds…'
export const noRefund = 'No credited auction refunds are available.'
export const unclaimedBids = 'Bids to claim'
export const claimBid = 'Claim bid'
export const claimingBid = 'Claiming bid…'
export const claimAllBids = 'Claim all bids'
export const claimingAllBids = 'Claiming bids…'
export const claimHint = 'Claim every bid, including bids that won nothing, before choosing a branch in a later fork. Anyone can claim any bid.'
export const allBidsClaimed = 'All your bids are claimed.'
export const claimAfterClose = 'Bids can be claimed after the auction closes.'
export const claimedStatus = 'Claimed'
export const claimBidReview = (id: bigint, winning: boolean) => (winning ? `Claim bid ${id}. Its winning lots join this wallet’s position on this branch, merging into any existing one.` : `Claim bid ${id}. It won nothing, so this only marks it claimed.`)
export const claimAllReview = (batch: number, total: number) => {
	let scope = batch === 1 ? 'your unclaimed bid' : `all ${batch} of your unclaimed bids`
	if (batch < total) scope = `${batch} of your ${total} unclaimed bids now; claim again for the rest`
	return `Claim ${scope}. Winning lots join this wallet’s position on this branch, merging into any existing one.`
}
export const refresh = 'Refresh auction'
export const refreshing = 'Refreshing auction…'
export const busy = 'Wait for the current transaction.'
export const pages = (start: bigint, count: number, total: bigint) => `${start + (count === 0 ? 0n : 1n)}–${start + BigInt(count)} of ${total} bids`
export const bidReview = (lots: bigint, bidAttoEth: bigint, minimumAttoRepPerLot: bigint, decimals = 18, symbol = 'collateral') =>
	`Bid ${formatUnits(bidAttoEth, decimals)} ${symbol} for ${lots} lots with at least ${formatEther(minimumAttoRepPerLot)} REP per winning lot. At closing, that REP backs the commitment of your winning lots; claim the bid to add them to your position. If your bid is outbid, you can get your collateral back early. Otherwise, unused collateral is refundable after closing.`

export const noAdmissibleLimit = 'No admissible new limit'

export const inContention = 'In contention'
export const outbid = 'Outbid'
export const winning = 'Winning'
export const readTimeout = 'Auction read timed out. Try again.'
export const savedBids = 'Saved auction details'
export const recapitalizationDeadline = 'Recapitalization deadline'
export const ask = 'Ask'
export const lotsWonAndBid = 'Lots won / bid'
export const details = 'Bid details'
export const yourAsk = 'Your ask'
export const highestAsk = 'Highest now'
export const baseAsk = `${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}% health`
export const askScale = 'Your ask, REP per lot'
export const askAmount = (amount: string) => `${amount} REP per lot`
export const lotsForShortfall = (lots: bigint, value: string) => `${lots} ${lots === 1n ? 'lot' : 'lots'} of ${value} cover the shortfall`
export const bidLots = (lots: bigint) => `Your bid · ${lots} ${lots === 1n ? 'lot' : 'lots'}`
export const lotsAriaLabel = (summary: string, bid: string | undefined) => (bid === undefined ? summary : `${summary}. ${bid}`)
export const lowerAsksFill = 'Lower asks already fill the auction.'
export const earlierBidsFill = 'Better asks or earlier bids at the same ask take the available lots.'
export const lockedCollateral = (amount: string) => `${amount} locked until closing.`
export const collateralLocked = 'You lock until the auction closes'
export const repIfFilled = 'REP you get if fully filled'
export const askRange = (minimum: string, maximum: string) => `Allowed now · ${minimum} to ${maximum} REP`
export const approveCollateral = 'Adjust approval amount'
export const collateralUsed = (symbol: string) => `${symbol} used`
export const collateralRefundable = (symbol: string) => `${symbol} refundable`

export const approvalTitle = 'Approve auction collateral'
export const approvalNeedsAuction = 'Auction is unavailable. Refresh before approving collateral.'
