import { endSentence } from '../lib/format.js'
export const transaction = 'Transaction'
export { trade } from './app.js'
export const tradeFailed = 'Trade failed.'
export const checkingLatestPrice = 'Checking price…'
export const confirmInWallet = 'Confirm in wallet…'
export const waitingForConfirmation = 'Waiting for confirmation…'
export { outcome, zeroDecimalPlaceholder } from '@zoltar/ui-core-shared/copy/common.js'
export const retryBalances = 'Retry balances'
export const walletYes = 'Wallet Yes'
export const walletNo = 'Wallet No'
export const walletInvalid = 'Wallet Invalid'
const refreshingWalletBalances = 'Refreshing wallet balances…'
export const balanceRefreshFailed = 'Balance refresh failed.'
export { eth, no, yes } from './outcomes.js'
/** Closes every estimate note: the estimate is recomputed against the chain before the wallet is asked to sign. */
export const recheckedBeforeWallet = 'Rechecked before your wallet opens.'

export function formatWalletBalance(amount: string) {
	return `Wallet: ${amount}`
}

export function formatHolding(holding: string) {
	return `You hold ${holding}`
}

export function preparingAction(action: string) {
	return `${action}: checking the latest price before your wallet opens…`
}

export function actionPendingInWallet(action: string) {
	return `${action}: confirm in your wallet.`
}

export function actionPendingOnchain(action: string) {
	return `${action} sent. Waiting for confirmation…`
}

export function actionConfirmedOnchain(action: string) {
	return `${action} confirmed.`
}

export function revalidatingAfterReceipt(status: string) {
	return `${status} · ${refreshingWalletBalances}`
}
export const formatTradeActivity = (market: string) => `Trade · ${market}`
export const formatLiquidityActivity = (market: string) => `Liquidity · ${market}`
export const formatSettlementActivity = (market: string) => `Settlement · ${market}`

/** Names the switcher options a reason applies to, such as `Migrate unavailable: The universe has not forked…`. Reasons reused from short badge copy get closing punctuation so stacked reasons read as consistent sentences. */
export function unavailableOperationReason(operationLabels: readonly string[], reason: string) {
	return `${operationLabels.join(', ')} unavailable: ${endSentence(reason)}`
}
