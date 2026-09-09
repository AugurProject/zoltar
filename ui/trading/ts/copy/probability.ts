const yes = 'YES'
const no = 'NO'
const currentSpotPriceCaption = 'Current spot price · YES among valid outcomes'

function conditionalYesPriceLabel(percent: string) {
	return `Conditional YES price ${percent} percent`
}

function probabilityLabel(outcome: 'YES' | 'NO', percent: string) {
	return `${outcome} ${percent}%`
}

function beforePriceLabel(percent: string) {
	return `Before ${percent} percent`
}

export const probabilityCopy = { yes, no, currentSpotPriceCaption, conditionalYesPriceLabel, probabilityLabel, beforePriceLabel } as const
