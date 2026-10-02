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
export const additionGuidance = 'Your ETH mints equal Invalid, Yes, and No shares. The pool keeps the Yes and No shares it needs; Invalid shares and any leftover Yes or No shares go to your wallet.'

/** Removal pays out shares, not ETH, so the guidance names the next step that turns them into ETH. */
export function removalGuidance(marketOpen: boolean) {
	return marketOpen
		? 'Removing liquidity returns Yes and No shares to your wallet, not ETH. Next, sell them on the Trade tab, or hold them until the question resolves.'
		: 'Removing liquidity returns Yes and No shares to your wallet, not ETH. Next, redeem them with matching Invalid shares as complete sets on the Settlement tab, or hold them until the question resolves.'
}

export const poolNotInitializedReason = 'Initialize the pool first.'
export const noLiquidityToRemoveReason = 'The pool has no liquidity yet.'
export const invalidLpAmount = 'Enter an LP amount with at most 18 decimal places.'
export { invalidEthAmount } from './tradeTicket.js'
export const estimateNote = 'Estimate from the current pool state. Connect a wallet for an exact quote.'
export const estimateHeading = 'Liquidity estimate'
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

export function approximateRemovalValue(amount: string) {
	return `Worth about ${amount} ETH at the current pool price, if the question resolves valid.`
}

export function lpHeld(amount: string) {
	return `You hold ${amount}`
}

export const youProvide = 'You provide'
export { youReceiveEstimate as youReceive } from './tradeTicket.js'
export const previewDetails = 'Liquidity breakdown'

export const retryQuote = 'Retry quote'
export const waitForTransaction = 'Wait for the current transaction to finish.'
