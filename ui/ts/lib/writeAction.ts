import type { Address, Hash } from 'viem'
import { formatRefreshErrorMessage, formatWriteErrorMessage } from './errors.js'
import type { WriteOperationsParameters } from '../types/app.js'

type RunWriteActionParameters = {
	accountAddress: Address | undefined
	formatErrorMessage?: ((error: unknown, fallbackMessage: string) => string) | undefined
	missingWalletMessage: string
	onRefreshError?: ((message: string, hash?: Hash) => void) | undefined
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onWriteError?: ((message: string) => void) | undefined
	refreshErrorFallback?: string
	refreshState: () => Promise<void>
	setErrorMessage: (message: string | undefined) => void
}

export function buildWriteActionConfig(params: Omit<WriteOperationsParameters, 'onTransactionSubmitted'>, errorSignal: { value: string | undefined }, missingWalletMessage: string) {
	return {
		accountAddress: params.accountAddress,
		onTransaction: params.onTransaction,
		onTransactionFinished: params.onTransactionFinished,
		onTransactionRequested: params.onTransactionRequested,
		refreshState: params.refreshState,
		setErrorMessage: (message: string | undefined) => {
			errorSignal.value = message
		},
		missingWalletMessage,
	}
}

export async function runWriteAction<TResult extends { hash: Hash }>(parameters: RunWriteActionParameters, action: (walletAddress: Address) => Promise<TResult | undefined>, errorFallback: string, onSuccess?: (result: TResult, walletAddress: Address) => Promise<void> | void) {
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
			parameters.onTransactionRequested()
			parameters.setErrorMessage(undefined)
			result = await action(parameters.accountAddress)
			if (result === undefined) return
			await Promise.resolve(parameters.onTransaction(result.hash))
		} catch (error) {
			const message = parameters.formatErrorMessage?.(error, errorFallback) ?? formatWriteErrorMessage(error, errorFallback)
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
