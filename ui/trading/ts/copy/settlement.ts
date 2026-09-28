export { eth, invalid, no, yes } from './outcomes.js'
export const operationLabel = 'Settlement operation'
export const completeSetAction = 'Complete set'
export const forkMigrationAction = 'Fork migration'
export const completeSetRedemptionPrefix = 'Burn equal amounts of wallet INVALID, YES, and NO for ETH at the security pool’s current collateral rate. Available redemption value:'
export const completeSetValueToRedeem = 'Complete-set value to redeem'
export const winningRedemptionUnavailable = 'Winning-outcome redemption becomes available after the market finalizes.'
export const migrationGuidance = 'Choose the market share separately from the fork branches. Migration permanently locks parent-universe transfers for the selected share. The same source can still migrate later into other children.'
export const sourceShare = 'Source share'
export const selectedSourceBalance = 'Selected source balance:'
export const loadingForkDetails = 'Loading fork question and child branches…'
export const forkDetailsUnavailable = 'Fork question details are unavailable.'
export const retryForkDetails = 'Retry fork details'
export const walletBalancesUnavailable = 'Wallet balances are unavailable'

export function redeemOutcomeAction(outcome: 'INVALID' | 'YES' | 'NO') {
	return `Redeem ${outcome}`
}

export function winningRedemptionGuidance(outcome: 'INVALID' | 'YES' | 'NO', balance: string) {
	return `Redeem the wallet’s entire ${outcome} balance (${balance}) through this exact security pool.`
}
export const settlementTransaction = 'Settlement transaction'
export const loadingForkDetailsReason = 'Loading the universe fork question and child branches.'
export const forkDetailsUnavailableReason = 'Fork question details are unavailable.'
export const forkDetailsLoadFailed = 'Fork question details failed to load'
export const transactionFailed = 'Settlement transaction failed'
export const quoteFailed = 'Settlement quote failed'
export const quoteUnavailable = 'Settlement quote unavailable'
export const gettingQuote = 'Getting a quote…'
export const quoteHeading = 'Redemption quote'
export const youReceive = 'You receive ≈'
export const minimumReceived = 'Minimum received'
export const redeemCompleteSetsAction = 'Redeem complete sets'

export function migrationAction(count: number) {
	return count === 0 ? 'Migrate shares' : `Migrate to ${count.toString()} ${count === 1 ? 'branch' : 'branches'}`
}
