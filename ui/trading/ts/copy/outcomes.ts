import { eth, percent } from '@zoltar/ui-core-shared/copy/common.js'

/** Outcome labels match the rest of the UI; badges may upper-case them in CSS. */
export const yes = 'Yes'
export const no = 'No'
export const invalid = 'Invalid'

/** The display label for a share outcome key. */
export function outcomeLabel(outcome: 'INVALID' | 'YES' | 'NO') {
	if (outcome === 'YES') return yes
	if (outcome === 'NO') return no
	return invalid
}
export { eth, percent }

export function formatEthAmount(value: string) {
	return `${value} ${eth}`
}
