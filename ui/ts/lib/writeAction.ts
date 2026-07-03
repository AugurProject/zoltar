import type { Address, Hash } from '@zoltar/shared/ethereum'
import { formatRefreshErrorMessage, formatWriteErrorMessage } from './errors.js'
import { assertActiveWallet, type ActiveWalletContext } from './walletGuards.js'
import type { WriteOperationsParameters } from '../types/app.js'
import type { TransactionIntent } from '../types/components.js'

type RunWriteActionParameters = {
	accountAddress: Address | undefined
	formatErrorMessage?: ((error: unknown, fallbackMessage: string) => string) | undefined
	missingWalletMessage: string
	onRefreshError?: ((message: string, hash?: Hash) => void) | undefined
	onTransactionCanceled?: (() => void) | undefined
	onTransactionFailed?: ((message: string) => void) | undefined
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onWriteCanceled?: (() => void) | undefined
	onWriteError?: ((message: string) => void) | undefined
	refreshErrorFallback?: string
	refreshState: WriteOperationsParameters['refreshState']
	setErrorMessage: (message: string | undefined) => void
}

type BuildWriteActionConfigParameters = {
	accountAddress: WriteOperationsParameters['accountAddress']
	onTransactionCanceled: WriteOperationsParameters['onTransactionCanceled']
	onTransactionFailed: WriteOperationsParameters['onTransactionFailed'] | undefined
	onTransactionFinished: WriteOperationsParameters['onTransactionFinished']
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	refreshState: WriteOperationsParameters['refreshState']
}

export function buildWriteActionConfig(params: BuildWriteActionConfigParameters, errorSignal: { value: string | undefined }, missingWalletMessage: string, transactionIntent: TransactionIntent) {
	return {
		accountAddress: params.accountAddress,
		onTransactionCanceled: params.onTransactionCanceled,
		onTransactionFinished: params.onTransactionFinished,
		onTransactionFailed: params.onTransactionFailed,
		onTransactionRequested: () => {
			params.onTransactionRequested(transactionIntent)
		},
		refreshState: params.refreshState,
		setErrorMessage: (message: string | undefined) => {
			errorSignal.value = message
		},
		missingWalletMessage,
	}
}

export async function runWriteAction<TResult extends { hash: Hash }>(parameters: RunWriteActionParameters, action: (walletAddress: Address, activeWallet: ActiveWalletContext) => Promise<TResult | undefined>, errorFallback: string, onSuccess?: (result: TResult, walletAddress: Address) => Promise<void> | void) {
	if (parameters.accountAddress === undefined) {
		if (parameters.onWriteError === undefined) {
			parameters.setErrorMessage(parameters.missingWalletMessage)
		} else {
			parameters.onWriteError(parameters.missingWalletMessage)
		}
		return
	}

	try {
		let result: TResult | undefined
		try {
			const activeWallet = await assertActiveWallet(parameters.accountAddress)
			parameters.onTransactionRequested()
			parameters.setErrorMessage(undefined)
			result = await action(parameters.accountAddress, activeWallet)
			if (result === undefined) {
				parameters.onWriteCanceled?.()
				parameters.onTransactionCanceled?.()
				return
			}
		} catch (error) {
			const message = parameters.formatErrorMessage?.(error, errorFallback) ?? formatWriteErrorMessage(error, errorFallback)
			parameters.onTransactionFailed?.(message)
			if (parameters.onWriteError === undefined) {
				parameters.setErrorMessage(message)
			} else {
				parameters.onWriteError(message)
			}
			return
		}

		try {
			await onSuccess?.(result, parameters.accountAddress)
			await parameters.refreshState()
		} catch (error) {
			const message = formatRefreshErrorMessage(error, parameters.refreshErrorFallback ?? 'Transaction succeeded, but refreshing the UI failed')
			if (parameters.onRefreshError === undefined) {
				parameters.setErrorMessage(message)
			} else {
				parameters.onRefreshError(message, result.hash)
			}
		}
	} finally {
		await Promise.resolve(parameters.onTransactionFinished())
	}
}
