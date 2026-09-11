const yes = 'YES'
const no = 'NO'

function conditionalYesPriceLabel(percent: string) {
	return `Conditional YES price ${percent} percent`
}

// Visible prices must say they are conditional on a valid resolution; the AMM has no view on INVALID.
function probabilityLabel(outcome: 'YES' | 'NO', percent: string) {
	return `Conditional ${outcome} ${percent}%`
}

function beforePriceLabel(percent: string) {
	return `Before ${percent} percent`
}

export const probabilityCopy = { yes, no, conditionalYesPriceLabel, probabilityLabel, beforePriceLabel } as const
