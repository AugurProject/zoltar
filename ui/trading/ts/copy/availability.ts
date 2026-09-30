import { formatNetworkRequiredReason, positiveAmountRequired, walletConnectionRequired } from '@zoltar/ui-core-shared/copy/common.js'
import { conditionalYesPriceValidation } from './liquidity.js'
import { walletBalancesUnavailable } from './app.js'

export { formatNetworkRequiredReason }
export const connectWalletReason = walletConnectionRequired
export const marketClosedReason = 'Market closed to new positions.'
export const balancesLoadingReason = 'Loading wallet balances…'
export const balancesUnavailableReason = `${walletBalancesUnavailable}.`
export const amountRequiredReason = positiveAmountRequired
export const insufficientEthReason = 'Insufficient ETH balance.'
export const insufficientLpReason = 'Insufficient LP balance.'
export const initializePriceInvalidReason = conditionalYesPriceValidation
export const transactionInProgressReason = 'Transaction in progress.'
export const quoteLoadingReason = 'Getting a quote…'
export const quoteUnavailableReason = 'Quote unavailable. Change the amount or try again.'

export function formatInsufficientOutcomeReason(outcome: 'YES' | 'NO') {
	return `Insufficient ${outcome} balance.`
}

export const holdingFeesBoundsReason = 'Holding fees exceed these limits before expiry. Increase slippage or shorten validity in Settings.'
export const holdingFeesUnavailableReason = 'Holding fee projection unavailable. Refresh the market before submitting.'

export const submissionTimingUnavailableReason = 'Market timing is unavailable. Refresh before submitting.'
export const questionClosingSoonReason = 'This question closes in 60 seconds or less. New trades and liquidity deposits are paused.'
export const submissionTimingChangedReason = 'Transaction timing changed. Refresh the quote before submitting.'
