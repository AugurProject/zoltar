import { outcomeLabel, yes } from './outcomes.js'

function conditionalYesPriceLabel(percent: string) {
	return `Conditional ${yes} price ${percent} percent`
}

function conditionalYesMoveLabel(before: string, after: string) {
	return `Conditional ${yes} price moves from ${before} to ${after} percent after this trade`
}

// Visible prices must say they are conditional on a valid resolution; the trading pool has no view on Invalid.
function probabilityLabel(outcome: 'YES' | 'NO', percent: string) {
	return `Conditional ${outcomeLabel(outcome)} ${percent}%`
}

function probabilityMoveLabel(outcome: 'YES' | 'NO', before: string, after: string) {
	return `Conditional ${outcomeLabel(outcome)} ${before}% → ${after}%`
}

function beforePriceLabel(percent: string) {
	return `Before this trade: ${percent}%`
}

export const probabilityCopy = { conditionalYesPriceLabel, conditionalYesMoveLabel, probabilityLabel, probabilityMoveLabel, beforePriceLabel } as const
