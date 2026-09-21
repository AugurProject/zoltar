export const disconnectedGuidance = 'Connect a wallet to load balances and simulate liquidity transactions.'
export const balanceRefreshFallback = 'balance refresh failed'
export const operationLabel = 'Liquidity operation'
export const initializeAction = 'Initialize'
export const addAction = 'Add'
export const removeAction = 'Remove'
export const lpTokenAmount = 'LP tokens'
export const ethAmount = 'ETH amount'
export const lp = 'LP'
export const conditionalYesPrice = 'Conditional YES price'
export const conditionalYesPriceValidation = 'Enter a Conditional YES price above 0% and below 100%, with at most two decimal places.'
export const removalGuidance = 'Removal returns raw YES and NO. It never consumes wallet INVALID.'
export const additionGuidance = 'All INVALID and unused directional shares return to the wallet; LP tokens do not include wallet INVALID.'
export const slippageTolerance = 'Slippage tolerance'
export const deadline = 'Deadline'
export const completeSetSharesCreated = 'Complete sets created'
export const sharesDeposited = 'YES / NO deposited'
export { eth, invalid, no, percent, yes } from './outcomes.js'

export function balancesUnavailable(reason: string) {
	return `Wallet balances are unavailable: ${reason}.`
}

export const simulationBlockLabel = 'Simulation block'

export const youProvide = 'You provide'
export const youReceive = 'Expected to receive'
export const previewDetails = 'Liquidity breakdown'
