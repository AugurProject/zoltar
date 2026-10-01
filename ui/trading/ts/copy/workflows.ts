export const transaction = 'Transaction'
export const tradeLabel = 'Trade'
export const tradeFailed = 'Trade failed'
export const checkingLatestPrice = 'Checking price…'
export const confirmInWallet = 'Confirm in wallet…'
export const waitingForConfirmation = 'Waiting for confirmation…'
export { outcome } from '@zoltar/ui-core-shared/copy/common.js'
import { walletBalancesUnavailable as walletBalancesUnavailableLabel } from './app.js'
export const retryBalances = 'Retry balances'
export const amountPlaceholder = '0.0'
export const walletYes = 'Wallet YES'
export const walletNo = 'Wallet NO'
export const walletInvalid = 'Wallet INVALID'
const refreshingWalletBalances = 'Refreshing wallet balances…'
export const balanceRefreshFailed = 'Balance refresh failed.'
export { eth, no, yes } from './outcomes.js'

export function walletBalancesUnavailable(reason: string) {
	return `${walletBalancesUnavailableLabel}; retry before trading. ${reason}`
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

/** Names the switcher options a reason applies to, such as `Fork migration unavailable: The universe has not forked…`. Reasons reused from short badge copy get closing punctuation so stacked reasons read as consistent sentences. */
export function unavailableOperationReason(operationLabels: readonly string[], reason: string) {
	const sentence = /[.!?…]$/.test(reason) ? reason : `${reason}.`
	return `${operationLabels.join(', ')} unavailable: ${sentence}`
}
