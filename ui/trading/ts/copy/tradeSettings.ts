export const tradeSettings = 'Trade settings'
export const slippageTolerance = 'Slippage tolerance'
export const slippagePresets = 'Slippage presets'
export const customSlippage = 'Custom slippage tolerance, percent'
export const slippageValidation = 'Enter 0% to 5%, with at most two decimal places.'
export const transactionValidFor = 'Transaction valid for'
export const validityPresets = 'Validity presets'
export const customValidity = 'Custom validity, minutes'
export const percent = '%'
export const minutes = 'min'
export const validityValidation = 'Enter a whole number from 1 to 1440 minutes.'
export const settingsHelp = 'Transactions revert if the price moves further than this or they are not mined in time.'

export function minutesLabel(minutes: bigint) {
	return `${minutes.toString()} min`
}

/** The protection summary shown next to a quote, with the Settings menu as the one place to change it. */
export function protectionSummary(slippagePercent: string, minutes: bigint) {
	return `Slippage ${slippagePercent}% · valid ${minutes.toString()} min · change in Settings`
}
