import { invalid, outcomeLabel, yes } from './outcomes.js'

// Visible prices must say they are conditional on a valid resolution; the trading pool has no view on Invalid.
const ifNotInvalid = `if not ${invalid}`

/** Names what every displayed Yes / No price is conditional on. */
const priceIfNotInvalid = `Price ${ifNotInvalid}`
/** The same price on a market that no longer trades: the pool's last price, not a live one. */
const lastPriceIfNotInvalid = `Last price ${ifNotInvalid}`

function conditionalYesPriceLabel(percent: string, last = false) {
	return `${yes} ${last ? 'last price' : 'price'} ${ifNotInvalid}: ${percent} percent`
}

function conditionalYesMoveLabel(before: string, after: string) {
	return `${yes} price ${ifNotInvalid} moves from ${before} to ${after} percent after this trade`
}

function probabilityLabel(outcome: 'YES' | 'NO', percent: string) {
	return `${outcomeLabel(outcome)} ${percent}%`
}

function probabilityMoveLabel(outcome: 'YES' | 'NO', before: string, after: string) {
	return `${outcomeLabel(outcome)} ${before}% → ${after}%`
}

function beforePriceLabel(percent: string) {
	return `Before this trade: ${percent}%`
}

export const probabilityCopy = { priceIfNotInvalid, lastPriceIfNotInvalid, conditionalYesPriceLabel, conditionalYesMoveLabel, probabilityLabel, probabilityMoveLabel, beforePriceLabel } as const
