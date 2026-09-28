export const transaction = 'Transaction'
export const tradeLabel = 'Trade'
export const tradeFailed = 'Trade failed'
export const checkingLatestPrice = 'Checking price…'
export const confirmInWallet = 'Confirm in wallet…'
export const waitingForConfirmation = 'Waiting for confirmation…'
export { outcome } from '@zoltar/ui-core-shared/copy/common.js'
export const retryBalances = 'Retry balances'
export const amountPlaceholder = '0.0'
export const walletYes = 'Wallet YES'
export const walletNo = 'Wallet NO'
export const walletInvalid = 'Wallet INVALID'
const refreshingWalletBalances = 'Refreshing wallet balances…'
export const balanceRefreshFailed = 'Balance refresh failed.'
export { eth, no, yes } from './outcomes.js'

export function walletBalancesUnavailable(reason: string) {
	return `Wallet balances are unavailable; retry before trading. ${reason}`
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
