import type { MarketSettlementPath } from '../protocol/liveMarket.js'
import { recheckedBeforeWallet } from './workflows.js'
export const operationLabel = 'Liquidity operation'
export const initializeAction = 'Create market'
export const addAction = 'Add'
export const removeAction = 'Remove'
/** Creating the trading pool and adding its first liquidity happen in one transaction. */
export const createMarketAndAddLiquidityAction = 'Create market and add liquidity'
export const initializeLiquidityAction = 'Add first liquidity'
export const addLiquidityAction = 'Add liquidity'
export const removeLiquidityAction = 'Remove liquidity'
export { amount } from '@zoltar/ui-core-shared/copy/common.js'
export const lp = 'LP'
export const conditionalYesPrice = 'Conditional Yes price'
export const conditionalYesPriceValidation = 'Enter a conditional Yes price above 0% and below 100%, with at most two decimal places.'
export const additionGuidance = 'Your ETH mints equal Yes, No, and Invalid shares. The trading pool keeps the Yes and No shares it needs; Invalid shares and any leftover Yes or No shares go to your wallet.'

const removalLead = 'Removing liquidity returns Yes and No shares to your wallet, not ETH.'

/** Removal pays out shares, not ETH, so the guidance names the next step that turns them into ETH. `path` is undefined while the market still trades. */
export function formatRemovalGuidance(path: MarketSettlementPath | undefined) {
	if (path === undefined) return `${removalLead} Next, sell them on the Trade tab, or hold them until the question resolves.`
	if (path === 'redeem-complete-sets') return `${removalLead} Next, redeem them with matching Invalid shares as complete sets on the Settlement tab, or hold them until the question resolves.`
	if (path === 'redeem-winning-shares') return `${removalLead} Next, redeem the winning shares on the Settlement tab.`
	if (path === 'migrate-shares') return `${removalLead} Next, migrate them to a child universe on the Settlement tab.`
	return `${removalLead} They cannot be redeemed until the security pool is operational.`
}

export const marketNotInitializedReason = 'Create the market first.'
export const noLiquidityToRemoveReason = 'The market has no liquidity yet.'
export const invalidLpAmount = 'Enter an LP amount with at most 18 decimal places.'
export { invalidEthAmount } from './tradeTicket.js'
export const estimateNote = 'Estimate from the current trading pool state.'
export const estimateHeading = 'Liquidity estimate'
export const completeSetSharesCreated = 'Complete sets created'
export const sharesDeposited = 'Yes / No deposited'
export const liquidityTransaction = 'Liquidity transaction'
export const transactionFailed = 'Liquidity transaction failed.'
export const closedToAdditions = 'Trading has ended for this market, so it no longer accepts new liquidity. Removing liquidity is still available.'
export { eth, percent } from './outcomes.js'

export function approximateRemovalValue(amount: string) {
	return `Worth about ${amount} ETH at the current trading pool price, if the question resolves Yes or No.`
}

export const youProvide = 'You provide'
export { youReceiveEstimate as youReceive } from './tradeTicket.js'
export const previewDetails = 'Liquidity breakdown'

export const localEstimateNote = `${estimateNote} ${recheckedBeforeWallet}`
export const initialAmountTooSmall = 'Increase the amount to mint liquidity.'

export const removalAmountTooSmall = 'Increase the amount to receive Yes and No shares.'

export const initializeEstimateNote = 'Estimate from your price and the current collateral rate.'
export const initializeLocalEstimateNote = `${initializeEstimateNote} ${recheckedBeforeWallet}`
