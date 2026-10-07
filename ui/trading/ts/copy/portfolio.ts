export const lpYesClaim = 'LP Yes claim'
export const lpNoClaim = 'LP No claim'
export const claimInsuredByInvalid = 'Claim insured by separate Invalid shares'
export const maximumInsuredYesExit = 'Maximum insured Yes exit'
export const maximumInsuredNoExit = 'Maximum insured No exit'
export const disconnectedTitle = 'Connect a wallet to see your positions'
export const portfolioBalancesUnavailable = 'Portfolio balances could not be loaded.'
export const noPositions = 'No positions'
export const noPortfolioBalances = 'No Yes, No, Invalid, or LP balance was found in your favorite markets. Portfolio only covers markets opened in this browser.'

export function noPositionsInUniverse(universe: string) {
	return `No positions in ${universe}`
}
export const lpClaims = 'LP claims'
export const insuredExits = 'Insured exits'
export const balancesUnavailable = 'Balances unavailable'

export function poolBalancesUnavailable(message: string) {
	return `This security pool’s balances could not be loaded: ${message}`
}

export const positionDetails = 'Position details'

export const summaryLabel = 'Portfolio summary'
export const totalValue = 'Total value'
export const totalValueBasis = 'Exit and redemption estimates at last refresh'
export function excludedFromTotal(count: number) {
	return `Excludes ${count.toString()} ${count === 1 ? 'position' : 'positions'} without a price`
}
export const positions = 'Positions'
export const needsAttention = 'Needs attention'
export const nothingNeedsAttention = 'Nothing'

export const valueNow = 'Position value'
export const exitValueBasis = 'If exited at trading pool prices, after fees'
export const redemptionValueBasis = 'Winning-share payout'
export const exitValuePendingBasis = 'Trading pool exit for insured shares; other shares pay at resolution'
export const completeSetsBasis = 'Complete sets redeemable now'
export const completeSetsPendingBasis = 'Complete sets only; other shares pay at resolution'
export const pendingResolutionExcluded = 'Excludes shares that pay at resolution'
export { unavailable as valueUnavailable } from '@zoltar/ui-core-shared/copy/common.js'
export const migrationValueReason = 'Migrate shares to value this position.'
export const poolInactiveValueReason = 'Security pool inactive.'
export const marketValueReason = 'Market data unavailable.'
export const balanceValueReason = 'Balances unavailable.'

export { sell } from './tradeTicket.js'
export const redeem = 'Redeem'
export const migrate = 'Migrate'
export { removeLiquidityAction as removeLiquidity } from './liquidity.js'
export const actionRedeem = 'Redeemable'
export const actionMigrate = 'Fork migration'
export const actionRemoveLiquidity = 'Trading ended'
export const noDeadline = 'No deadline'

/** Accessible name for a row or attention-item action, naming the market it acts on. */
export function actionFor(action: string, marketTitle: string) {
	return `${action}: ${marketTitle}`
}

export const noFavoriteMarkets = 'No favorite markets in this universe'
/** Portfolio reads balances only for markets this browser opened; holdings elsewhere are not discovered. */
export const favoriteGuidance = 'Portfolio only covers markets opened in this browser. Open a security pool by address in Markets to add it here.'
export const browseMarkets = 'Browse markets'

export const refreshPortfolio = 'Refresh portfolio'
