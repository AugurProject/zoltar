const yes = 'YES'
const no = 'NO'

function conditionalYesPriceLabel(percent: string) {
	return `Conditional YES price ${percent} percent`
}

function conditionalYesMoveLabel(before: string, after: string) {
	return `Conditional YES price moves from ${before} to ${after} percent after this trade`
}

// Visible prices must say they are conditional on a valid resolution; the AMM has no view on INVALID.
function probabilityLabel(outcome: 'YES' | 'NO', percent: string) {
	return `Conditional ${outcome} ${percent}%`
}

function probabilityMoveLabel(outcome: 'YES' | 'NO', before: string, after: string) {
	return `Conditional ${outcome} ${before}% → ${after}%`
}

function beforePriceLabel(percent: string) {
	return `Before this trade: ${percent}%`
}

export const probabilityCopy = { yes, no, conditionalYesPriceLabel, conditionalYesMoveLabel, probabilityLabel, probabilityMoveLabel, beforePriceLabel } as const
