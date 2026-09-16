import { formatNetworkRequiredReason, positiveAmountRequired, walletConnectionRequired } from '@zoltar/ui-core-shared/copy/common.js'
import { amountTooSmall } from './workflows.js'
import { conditionalYesPriceValidation } from './liquidity.js'

export { formatNetworkRequiredReason }
export const connectWalletReason = walletConnectionRequired
export const marketClosedReason = 'Market closed to new positions.'
export const balancesLoadingReason = 'Loading wallet balances…'
export const balancesUnavailableReason = 'Wallet balances unavailable.'
export const amountRequiredReason = positiveAmountRequired
export const insufficientEthReason = 'Insufficient ETH balance.'
export const insufficientLpReason = 'Insufficient LP balance.'
export const exitExceedsInsuranceReason = 'Exit exceeds the insured amount.'
export const amountTooSmallReason = `${amountTooSmall}.`
export const protectionInvalidReason = 'Fix the transaction protection settings.'
export const initializePriceInvalidReason = conditionalYesPriceValidation
export const transactionInProgressReason = 'Transaction in progress.'
export const quoteRequiredReason = 'Simulate again before submitting.'

export function formatInsufficientOutcomeReason(outcome: 'YES' | 'NO') {
	return `Insufficient ${outcome} balance.`
}

export function formatSwitchNetworkAction(networkName: string) {
	return `Switch to ${networkName}`
}
