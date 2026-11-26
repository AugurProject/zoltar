import { minimumSecurityPoolHealthFactorBps } from '@zoltar/statoblast-shared/statoblast/securityPool'

import { formatEther, formatUnits } from '@zoltar/core-shared/evm/ethereum'
export const title = 'Repair auction'
export const description = 'Lowest REP asks fill first. Every winning lot gets the higher of the highest winning ask and the minimum REP needed to back a lot at closing.'
export const ownership = 'If the REP price rises before closing, fewer lots may fill and the position may start below your health target.'
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
export const health = 'Target health (%)'
export const healthInvalid = `Enter a health target of at least ${formatUnits(minimumSecurityPoolHealthFactorBps, 2)}%, with up to two decimal places.`
export const clearingRep = 'Clearing REP per winning lot'
export const purchasedPrincipal = 'REP pledged at closing'
export const bid = 'Submit funded bid'
export const bidding = 'Submitting funded bid…'
export const yourBids = 'Your auction bids'
export const noBids = 'No bids from this wallet'
export const bidLabel = (id: bigint) => `Bid ${id}`
export const vault = 'Position address'
export const principal = 'Current pledged REP'
export const commitment = 'Current collateral commitment'
export const earnedEth = 'Unclaimed collateral fees'
export const earnedRep = 'Unclaimed REP fees'
export const funded = 'Funded position'
export const noFill = 'No winning lots'
export const closedWithShortfall = 'No lots sold. Bid collateral is refundable. The branch activates with its collateral shortfall.'
export const credit = 'Credit this bid’s refunds'
export const crediting = 'Crediting bid refunds…'
export const credited = 'This bid’s refunds are already credited.'
export const bidMayStillWin = 'This bid may still win. Its collateral remains committed until closing.'
export const earlyRefundCredited = 'This bid cannot win. Its collateral refund has been credited for withdrawal.'
export const claim = 'Credit and withdraw refunds'
export const claiming = 'Withdrawing bid refunds…'
export const refundChanged = 'Your refund credit changed. Refresh and review the new amount.'
export const earlyRefundWithdrawn = 'This bid cannot win. Its collateral refund has been credited and withdrawn.'
export const claimReview = (quote: { settles: boolean; bidRefundAttoEth: bigint; creditedAttoEth: bigint; totalAttoEth: bigint }, decimals = 18, symbol = 'collateral') => {
	if (quote.creditedAttoEth === 0n) return `Credit this bid’s ${formatUnits(quote.bidRefundAttoEth, decimals)} ${symbol} refund and withdraw it to your wallet.`
	if (!quote.settles) return `This bid’s refund is already credited. Withdraw your entire ${formatUnits(quote.totalAttoEth, decimals)} ${symbol} auction refund credit, possibly including your other bids, to your wallet.`
	return `Credit this bid’s ${formatUnits(quote.bidRefundAttoEth, decimals)} ${symbol} refund and withdraw your entire ${formatUnits(quote.totalAttoEth, decimals)} ${symbol} auction refund credit to your wallet, including ${formatUnits(quote.creditedAttoEth, decimals)} ${symbol} already credited, possibly from your other bids.`
}
export const refundEth = 'Credited collateral refund'
export const withdraw = 'Withdraw credited refunds'
export const withdrawing = 'Withdrawing auction refunds…'
export const noRefund = 'No credited auction refunds are available.'
export const manage = 'Manage position'
export const activate = 'Activate position controls'
export const activating = 'Activating position controls…'
export const activated = 'Position controls are active.'
export const activateFirst = 'Activate the position controls first.'
export const activateHint = 'Activation separates this position’s accounting and keeps its commitment.'
export const managePending = 'Position controls are available for winning bids.'
export const manageUnavailable = 'Open this position address on Capital to manage it.'
export const refresh = 'Refresh auction'
export const refreshing = 'Refreshing auction…'
export const busy = 'Wait for the current transaction.'
export const pages = (start: bigint, count: number, total: bigint) => `${start + (count === 0 ? 0n : 1n)}–${start + BigInt(count)} of ${total} bids`
export const bidReview = (lots: bigint, bidAttoEth: bigint, minimumAttoRepPerLot: bigint, decimals = 18, symbol = 'collateral') =>
	`Bid ${formatUnits(bidAttoEth, decimals)} ${symbol} for ${lots} lots with at least ${formatEther(minimumAttoRepPerLot)} REP per winning lot. At closing, that REP backs the position’s commitment. If your bid is outbid, you can get your collateral back early. Otherwise, unused collateral is refundable after closing.`

export const noAdmissibleLimit = 'No admissible new limit'

export const inContention = 'In contention'
export const outbid = 'Outbid'
export const winning = 'Winning'
export const readTimeout = 'Auction read timed out. Try again.'
export const savedBids = 'Saved auction details'
export const recapitalizationDeadline = 'Recapitalization deadline'
export const ask = 'Ask'
export const lotsWonAndBid = 'Lots won / bid'
export const details = 'Position controls'
export const yourAsk = 'Your ask'
export const lowestAsk = 'Your lowest'
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
export const lowestAtTarget = (amount: string) => `Lowest ask at this target · ${amount}`
export const askRange = (minimum: string, maximum: string) => `Allowed now · ${minimum} to ${maximum} REP`
export const noAskAtTarget = 'No new bids fit this health target.'
export const approveCollateral = 'Adjust approval amount'
export const collateralUsed = (symbol: string) => `${symbol} used`
export const collateralRefundable = (symbol: string) => `${symbol} refundable`

export const approvalTitle = 'Approve auction collateral'
export const approvalNeedsAuction = 'Auction is unavailable. Refresh before approving collateral.'
