import { formatNetworkRequiredReason, walletConnectionRequired } from '@zoltar/ui-core-shared/copy/common.js'
import { outcomeLabel } from './outcomes.js'
import { conditionalYesPriceValidation } from './liquidity.js'
import { walletBalancesUnavailable } from './app.js'
import { liveCopy } from './live.js'

export { formatNetworkRequiredReason }
export { closedToAdditions as liquidityClosedReason } from './liquidity.js'
export const connectWalletReason = walletConnectionRequired
export const balancesLoadingReason = 'Loading wallet balances…'
export const balancesUnavailableReason = `${walletBalancesUnavailable}.`
export const insufficientEthReason = 'Insufficient ETH balance.'
export const insufficientLpReason = 'Insufficient LP balance.'
export const initializePriceInvalidReason = conditionalYesPriceValidation
export const transactionInProgressReason = 'Transaction in progress.'
/** Every Trading ticket names a missing or zero amount the same way, as a neutral reason on its disabled action. */
const amountRequiredReason = 'Enter an amount.'
export const amountPositiveReason = 'Enter an amount greater than 0.'

/** The reason an amount alone blocks the action: missing, or zero. Undefined once it is positive. */
export function amountReason(amount: bigint | undefined) {
	if (amount === undefined) return amountRequiredReason
	return amount <= 0n ? amountPositiveReason : undefined
}

export function formatInsufficientOutcomeReason(outcome: 'YES' | 'NO') {
	return `Insufficient ${outcomeLabel(outcome)} balance.`
}

export const holdingFeesBoundsReason = 'Holding fees exceed these limits before expiry. Increase slippage or shorten validity in Settings.'
export const holdingFeesUnavailableReason = 'Holding fee projection unavailable. Refresh the market before submitting.'

export const submissionTimingUnavailableReason = 'Market timing is unavailable. Refresh before submitting.'
export const questionClosingSoonReason = 'This question closes in 60 seconds or less. New trades and liquidity deposits are paused.'
export const submissionTimingChangedReason = 'Transaction timing changed. Refresh the quote before submitting.'

/** Why the first liquidity cannot create this market; `blocker` is the market status that rules it out, such as `Question ended`. */
export function formatInitializationClosedReason(blocker: string | undefined) {
	return liveCopy.formatInitializationUnavailable(blocker ?? liveCopy.tradingClosed)
}
