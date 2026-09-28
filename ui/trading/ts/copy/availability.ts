import { formatNetworkRequiredReason, positiveAmountRequired, walletConnectionRequired } from '@zoltar/ui-core-shared/copy/common.js'
import { conditionalYesPriceValidation } from './liquidity.js'

export { formatNetworkRequiredReason }
export const connectWalletReason = walletConnectionRequired
export const marketClosedReason = 'Market closed to new positions.'
export const balancesLoadingReason = 'Loading wallet balances…'
export const balancesUnavailableReason = 'Wallet balances unavailable.'
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

export function formatSwitchNetworkAction(networkName: string) {
	return `Switch to ${networkName}`
}
