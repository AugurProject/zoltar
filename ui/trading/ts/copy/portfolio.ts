export { invalid, no, yes } from './outcomes.js'
export const lpYesClaim = 'LP YES claim'
export const lpNoClaim = 'LP NO claim'
export const claimCoveredByInvalid = 'Claim covered by separate INVALID'
export const maximumInsuredYesExit = 'Maximum insured YES exit'
export const maximumInsuredNoExit = 'Maximum insured NO exit'
export const disconnectedGuidance = 'Connect a wallet to load the positions for these security pools.'
export const loadingPoolBalances = 'Loading balances separately for each security pool…'
export const portfolioBalancesUnavailable = 'Portfolio balances could not be loaded.'
export const noPortfolioBalances = 'No YES, NO, INVALID, or LP balance was found in the discovered security pools.'
export const lpClaims = 'LP claims'
export const insuredExits = 'Insured exits'
export const balanceUnavailable = 'Balance unavailable'

export function poolBalancesUnavailable(message: string) {
	return `This security pool’s balances could not be loaded: ${message}`
}

export const settlementRequired = 'Fork / settlement in progress'
export const resolved = 'Resolved'
export const marketUnavailable = 'Market data unavailable'

export const positionDetails = 'Position details'

export const summaryLabel = 'Portfolio summary'
export const totalValue = 'Total value'
export const totalValueBasis = 'Exit and redemption prices now'
export function excludedFromTotal(count: number) {
	return `Excludes ${count.toString()} ${count === 1 ? 'position' : 'positions'} without a price`
}
export const profitLoss = 'Profit / loss'
export const profitLossUnavailable = 'Not available'
export const costBasisUnavailableReason = 'Entry costs are not recorded on-chain per account.'
export const positions = 'Positions'
export const needsAttention = 'Needs attention'
export const actionItemCount = 'Action items'
export const nothingNeedsAttention = 'Nothing due'

export const valueNow = 'Value now'
export const exitValueBasis = 'If exited at pool prices, after fees'
export const redemptionValueBasis = 'Winning-share payout'
export const valueUnavailable = 'Unavailable'
export const settlementValueReason = 'Settle to value this position.'
export const marketValueReason = 'Market data unavailable.'
export const balanceValueReason = 'Balance unavailable.'

export const sell = 'Sell'
export const redeem = 'Redeem'
export const settle = 'Settle'
export const withdrawLiquidity = 'Withdraw liquidity'
export const actionRedeem = 'Payout ready'
export const actionSettle = 'Fork settlement'
export const actionWithdrawLiquidity = 'Trading closed'
export const actionTradingCloses = 'Trading closes'
export const noDeadline = 'No deadline'

export function ethAmount(value: string) {
	return `${value} ETH`
}

/** Accessible name for a row or attention-item action, naming the market it acts on. */
export function actionFor(action: string, marketTitle: string) {
	return `${action}: ${marketTitle}`
}
