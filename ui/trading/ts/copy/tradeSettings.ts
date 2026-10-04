export const tradeSettings = 'Trade settings'
export const slippageTolerance = 'Slippage tolerance'
export const slippagePresets = 'Slippage presets'
export const customSlippage = 'Custom slippage tolerance, percent'
export const slippageValidation = 'Enter 0.01% to 5%, with at most two decimal places.'
export const lowSlippageWarning = 'Below 0.1%, small price moves can make transactions fail.'
export const transactionValidFor = 'Transaction valid for'
export const validityPresets = 'Validity presets'
export const customValidity = 'Custom validity, minutes'
export const percent = '%'
export const minutes = 'min'
export const validityValidation = 'Enter a whole number from 1 to 1440 minutes.'
export const settingsHelp = 'Transactions revert if the price moves further than this or they are included after their deadline.'

export function minutesLabel(minutes: bigint) {
	return `${minutes.toString()} min`
}

/** The protection summary shown next to a quote, with the Settings menu as the one place to change it. */
export function protectionSummary(slippagePercent: string, minutes: bigint, cutoff?: 'question') {
	let cutoffNote = ''
	if (cutoff === 'question') cutoffNote = ' · ends sooner at question close'
	return `${protectionTitle(slippagePercent, minutes)}${cutoffNote} · change in Settings`
}

/** The current protection values alone, titling the settings a quote offers to change in place. */
export function protectionTitle(slippagePercent: string, minutes: bigint) {
	return `Slippage ${slippagePercent}% · valid up to ${minutes.toString()} min`
}

export const validityEndsAtQuestionClose = 'A transaction is never valid past question close.'
