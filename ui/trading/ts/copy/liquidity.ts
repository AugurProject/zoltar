export const balanceRefreshFallback = 'balance refresh failed'
export const operationLabel = 'Liquidity operation'
export const initializeAction = 'Initialize'
export const addAction = 'Add'
export const removeAction = 'Remove'
export const initializeLiquidityAction = 'Initialize pool'
export const addLiquidityAction = 'Add liquidity'
export const removeLiquidityAction = 'Remove liquidity'
export const lpTokenAmount = 'LP tokens'
export const ethAmount = 'ETH amount'
export const lp = 'LP'
export const conditionalYesPrice = 'Conditional YES price'
export const conditionalYesPriceValidation = 'Enter a Conditional YES price above 0% and below 100%, with at most two decimal places.'
export const removalGuidance = 'Removal returns raw YES and NO. It never consumes wallet INVALID.'
export const additionGuidance = 'All INVALID and unused directional shares return to the wallet; LP tokens do not include wallet INVALID.'
export const completeSetSharesCreated = 'Complete sets created'
export const sharesDeposited = 'YES / NO deposited'
export const liquidityTransaction = 'Liquidity transaction'
export const transactionFailed = 'Liquidity transaction failed'
export const quoteFailed = 'Liquidity quote failed'
export const quoteUnavailable = 'Liquidity quote unavailable'
export const gettingQuote = 'Getting a quote…'
export const quoteHeading = 'Liquidity quote'
export const quoteBlock = 'Quoted at block'
export const closedToAdditions = 'This market no longer accepts new liquidity. Removing liquidity is still available.'
export { eth, invalid, no, percent, yes } from './outcomes.js'

export function balancesUnavailable(reason: string) {
	return `Wallet balances are unavailable: ${reason}.`
}

export function walletEth(amount: string) {
	return `Wallet: ${amount} ETH`
}

export function lpHeld(amount: string) {
	return `You hold ${amount}`
}

export const youProvide = 'You provide'
export const youReceive = 'Expected to receive'
export const previewDetails = 'Liquidity breakdown'
