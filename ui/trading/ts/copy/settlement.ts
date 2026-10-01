export { eth, invalid, no, yes } from './outcomes.js'
export const operationLabel = 'Settlement operation'
export const completeSetAction = 'Complete set'
export const forkMigrationAction = 'Fork migration'
export const completeSetRedemptionGuidance = 'Burn equal amounts of wallet INVALID, YES, and NO for ETH at the security pool’s current collateral rate.'
export const max = 'Max'
export const completeSetValueToRedeem = 'Complete-set value to redeem'
export const winningRedemptionUnavailable = 'Winning-outcome redemption becomes available after the market finalizes.'
export const migrationGuidance = 'Choose the market share separately from the fork branches. Migration permanently locks parent-universe transfers for the selected share. The same source can still migrate later into other children.'
export const marketDataUnavailableReason = 'Market data is unavailable. Refresh the market.'
export const universeNotForkedReason = 'The universe has not forked, so there is nothing to migrate.'
export const noSharesToMigrateReason = 'You hold no INVALID, YES, or NO shares to migrate.'
export const universeForkedReason = 'The universe forked. Migrate your shares to a child universe instead.'
export const poolNotOperationalReason = 'The security pool is not operational, so it cannot pay out ETH.'
export const noCompleteSetsReason = 'You hold no complete sets. Redeeming needs equal INVALID, YES, and NO.'
export const questionNotResolvedReason = 'The question has not resolved yet.'
export const acknowledgeMigrationReason = 'Confirm that you understand the migration.'
export const sourceShare = 'Source share'
export const selectedSourceBalance = 'Selected source balance:'
export const loadingForkDetails = 'Loading fork question and child branches…'
export const forkDetailsUnavailable = 'Fork question details are unavailable.'
export const retryForkDetails = 'Retry fork details'
export { walletBalancesUnavailable } from './app.js'

export function redeemOutcomeAction(outcome: 'INVALID' | 'YES' | 'NO') {
	return `Redeem ${outcome}`
}

export function noWinningSharesReason(outcome: 'INVALID' | 'YES' | 'NO') {
	return `You hold no ${outcome} shares to redeem.`
}

export function completeSetsHeld(completeSets: string, value: string) {
	return `You hold ${completeSets}, worth ${value}`
}

export function migrationAmount(balance: string) {
	return `Migrates your entire balance: ${balance}`
}

export function acknowledgeMigration(balance: string, outcome: 'INVALID' | 'YES' | 'NO') {
	return `I understand this moves all ${balance} into the selected branches and permanently locks my ${outcome} transfers in the parent universe.`
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
export { youReceiveEstimate as youReceive } from './tradeTicket.js'
export const minimumReceived = 'Minimum received'
export const redeemCompleteSetsAction = 'Redeem complete sets'

export function migrationAction(count: number) {
	return count === 0 ? 'Migrate shares' : `Migrate to ${count.toString()} ${count === 1 ? 'branch' : 'branches'}`
}
