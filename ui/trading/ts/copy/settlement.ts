export const invalid = 'INVALID'
export const yes = 'YES'
export const no = 'NO'
export const sectionKicker = 'Authoritative protocol actions'
export const sectionTitle = 'Settlement and fork migration'
export const operationLabel = 'Settlement operation'
export const completeSetAction = 'Complete set'
export const forkMigrationAction = 'Fork migration'
export const completeSetRedemptionPrefix = 'Burn equal amounts of wallet INVALID, YES, and NO for ETH at the security pool’s current collateral rate. Available complete sets:'
export const completeSetSharesToRedeem = 'Complete-set shares to redeem'
export const shares = 'shares'
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
