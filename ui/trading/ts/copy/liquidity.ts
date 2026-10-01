import { walletBalancesUnavailable } from './app.js'
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
export const conditionalYesPrice = 'Conditional Yes price'
export const conditionalYesPriceValidation = 'Enter a conditional Yes price above 0% and below 100%, with at most two decimal places.'
export const removalGuidance = 'Removal returns raw Yes and No shares. It never consumes wallet Invalid shares.'
export const additionGuidance = 'All Invalid and unused directional shares return to the wallet; LP tokens do not include wallet Invalid shares.'
export const completeSetSharesCreated = 'Complete sets created'
export const sharesDeposited = 'Yes / No deposited'
export const liquidityTransaction = 'Liquidity transaction'
export const transactionFailed = 'Liquidity transaction failed'
export const quoteFailed = 'Liquidity quote failed'
export const quoteUnavailable = 'Liquidity quote unavailable'
export const gettingQuote = 'Getting a quote…'
export const quoteHeading = 'Liquidity quote'
export const quoteBlock = 'Quoted at block'
export const closedToAdditions = 'This market no longer accepts new liquidity. Removing liquidity is still available.'
export { eth, percent } from './outcomes.js'

export function balancesUnavailable(reason: string) {
	return `${walletBalancesUnavailable}: ${reason}.`
}

export function walletEth(amount: string) {
	return `Wallet: ${amount} ETH`
}

export function lpHeld(amount: string) {
	return `You hold ${amount}`
}

export const youProvide = 'You provide'
export { youReceiveEstimate as youReceive } from './tradeTicket.js'
export const previewDetails = 'Liquidity breakdown'

export const retryQuote = 'Retry quote'
export const waitForTransaction = 'Wait for the current transaction to finish.'
