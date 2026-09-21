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

export const openPosition = 'Open position'
export const settlementRequired = 'Fork / settlement in progress'
export const resolved = 'Resolved'
export const marketUnavailable = 'Market data unavailable'

export const positionDetails = 'Position details'
