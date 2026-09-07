export const yes = 'YES'
export const no = 'NO'
export const currentSpotPriceCaption = 'Current spot price · YES among valid outcomes'

export function conditionalYesPriceLabel(percent: string) {
	return `Conditional YES price ${percent} percent`
}

export function probabilityLabel(outcome: 'YES' | 'NO', percent: string) {
	return `${outcome} ${percent}%`
}

export function beforePriceLabel(percent: string) {
	return `Before ${percent} percent`
}
