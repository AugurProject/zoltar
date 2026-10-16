import type { MarketSettlementPath } from '../protocol/liveMarket.js'
import { outcomeLabel } from './outcomes.js'
import { recheckedBeforeWallet } from './workflows.js'
export { max } from '@zoltar/ui-core-shared/copy/common.js'
export const buy = 'Buy'
export const sell = 'Sell'
export const tradeDirection = 'Trade direction'
export const outcomeWithOdds = 'Outcome, with price if not Invalid'
export const youPay = 'You pay'
export const sharesToSell = 'Shares to sell'
export const quarter = '25%'
export const half = '50%'
export const sellShortcutsLabel = 'Sell amount shortcuts'
export const buyShortcutsLabel = 'Buy amount shortcuts'
export const estimateHeading = 'Estimate'
export const estimateNote = `Estimate from the current trading pool reserves. ${recheckedBeforeWallet}`
export const youReceiveEstimate = 'You receive ≈'
export const youSellEstimate = 'You sell'
export const minimumReceived = 'Minimum received'
export const maximumSold = 'Maximum sold'
export const priceImpact = 'Price impact'
export const averagePrice = 'Average price'
export const invalidInsurance = 'Invalid insurance'
export const invalidUsed = 'Invalid used'
export const tradingFee = 'Trading fee'
export const completeSets = 'Complete sets'
export const moreDetails = 'Trade details'
export const invalidInsuranceNote = 'Buying mints complete sets; you keep their Invalid shares. Selling for ETH later uses 1 per set.'
export const invalidUsedNote = 'Selling redeems complete sets for ETH, using 1 Invalid share per set.'
export const updatingEstimate = 'Updating estimate…'
export const amountTooSmall = 'Amount too small to trade.'
export const invalidCoverageReason = 'Not enough Invalid shares to insure this sale.'
export const mintingCapacityExhaustedReason = 'The security pool cannot mint more complete sets now.'
export const acknowledgeImpactReason = 'Confirm the price impact first.'
/** Every ticket control is disabled once the market stops taking new positions; Settlement is where holdings go next. */
export const tradingEndedReason = 'Trading has ended for this market.'
export const openSettlement = 'Open settlement'

/** The closed-market notice names the step Settlement actually offers for the market's state. */
export function formatTradingEndedDetail(path: MarketSettlementPath) {
	if (path === 'migrate-shares') return `${tradingEndedReason} Use Settlement to migrate your shares to a child universe.`
	if (path === 'unavailable') return `${tradingEndedReason} Redemption is unavailable until the security pool is operational.`
	return `${tradingEndedReason} Use Settlement to redeem.`
}

/** `limit` is the largest amount of this trade within the limit, with its unit. */
export function formatPriceImpactBlockedReason(limit: string) {
	return `Trade at most ${limit}; larger trades exceed the 15% price-impact limit.`
}

/** A buy mints complete sets with the ETH paid, up to the security pool's remaining minting capacity. */
export function formatMintingCapacityReason(limitEth: string) {
	return `Buy at most ${limitEth} ETH; the security pool cannot mint more now.`
}

export function gasReserveReason(reserve: string) {
	return `Leave ${reserve} ETH in the wallet for gas.`
}

/** Announced once per price-impact tier, without the percentage, so re-priced estimates in the same tier stay quiet. */
export function priceImpactTierAnnouncement(tier: 'low' | 'caution' | 'warning' | 'blocked') {
	if (tier === 'caution') return 'Price impact above 2%.'
	if (tier === 'warning') return 'High price impact. Confirm it before trading.'
	if (tier === 'blocked') return 'Price impact above the 15% limit. Trade a smaller amount.'
	return ''
}

/** Spoken once an amount settles; `amount` is what the trade receives, with its unit. */
export function formatEstimateAnnouncement(amount: string) {
	return `Estimate: you receive about ${amount}.`
}

export function buyOutcome(outcome: 'YES' | 'NO') {
	return `Buy ${outcomeLabel(outcome)}`
}

export function sellOutcome(outcome: 'YES' | 'NO') {
	return `Sell ${outcomeLabel(outcome)}`
}

export function formatProfitIfResolves(outcome: 'YES' | 'NO') {
	return `Profit if the question resolves ${outcomeLabel(outcome)}`
}

export function formatHoldingAfter(outcome: 'YES' | 'NO') {
	return `${outcomeLabel(outcome)} after trade`
}

/** The trading fee as its rate and its ETH value, which arrives already marked as approximate or as an upper bound. */
export function formatTradingFeeValue(rate: string, ethAmount: string) {
	return `${rate} · ${ethAmount} ETH`
}

export function swapped(outcome: 'YES' | 'NO') {
	return `${outcomeLabel(outcome)} swapped in the trading pool`
}

export function sellableHint(holding: string, sellable: string) {
	return `You hold ${holding}; up to ${sellable} can be sold now.`
}

export function priceImpactCaution(percent: string) {
	return `Price impact ${percent}%. Smaller trades get a better average price.`
}

export function priceImpactWarning(percent: string) {
	return `High price impact: ${percent}%. This trade moves the price well away from its current level.`
}

export function priceImpactBlocked(percent: string) {
	return `Price impact ${percent}% is above the 15% limit: this market has too little liquidity for a trade this size.`
}

export function acknowledgeImpact(percent: string) {
	return `I accept a ${percent}% price impact`
}

export function invalidCoverageExplanation(needed: string, held: string, sellable: string, outcome: 'YES' | 'NO') {
	return `Selling pays out ETH by redeeming complete sets, so each set needs 1 Invalid share. This sale needs ${needed}; you hold ${held}. You can sell up to ${sellable} now, or keep the rest of your ${outcomeLabel(outcome)} as shares.`
}

export function sellInsteadAction(amount: string) {
	return `Sell ${amount} instead`
}

export function formatRequotedReceive(amount: string) {
	return `you would now receive ${amount}`
}

export function formatRequotedSell(amount: string) {
	return `you would now sell ${amount}`
}

/** `detail` continues the sentence in lower case; `action` is the button the user presses again. Shown once the market has been re-read. */
export function formatPriceMoved(detail: string, action: string) {
	return `The price moved since your estimate: ${detail}. Review the new estimate and press ${action} again.`
}

/** The stop when re-reading the market did not finish, so the estimate on screen may still show the old price. */
export function formatPriceMovedUnrefreshed(detail: string) {
	return `The price moved since your estimate: ${detail}. The estimate could not be updated; try again shortly.`
}
