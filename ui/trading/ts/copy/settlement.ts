export const invalid = 'INVALID'
export const yes = 'YES'
export const no = 'NO'
export const operationLabel = 'Settlement operation'
export const completeSetAction = 'Complete set'
export const forkMigrationAction = 'Fork migration'
export const completeSetRedemptionPrefix = 'Burn equal amounts of wallet INVALID, YES, and NO for ETH at the security pool’s current collateral rate. Available redemption value:'
export const completeSetValueToRedeem = 'Complete-set value to redeem'
export const eth = 'ETH'
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
export const slippageRangeReason = 'Enter a slippage tolerance from 0% to 5%.'
export const validityRangeReason = 'Enter a transaction validity from 1 to 1440 whole minutes.'

export function redemptionSimulationSummary(blockNumber: bigint, expectedEth: string, minimumEth: string, slippagePercent: string, deadline: string) {
	return `Authoritative redemption simulation at block ${blockNumber.toString()}: ${expectedEth} ETH expected, ${minimumEth} ETH minimum at ${slippagePercent}% slippage; valid until ${deadline}`
}

export function settlementSimulationSummary(blockNumber: bigint) {
	return `Authoritative settlement simulation ready at block ${blockNumber.toString()}`
}
