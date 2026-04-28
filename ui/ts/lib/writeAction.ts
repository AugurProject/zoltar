import type { Address, Hash } from 'viem'
import { getErrorMessage } from './errors.js'
import type { WriteOperationsParameters } from '../types/app.js'

type RunWriteActionParameters = {
	accountAddress: Address | undefined
	formatErrorMessage?: ((error: unknown, fallbackMessage: string) => string) | undefined
	missingWalletMessage: string
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
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
		parameters.setErrorMessage('Connect wallet to continue.')
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
			parameters.setErrorMessage(parameters.formatErrorMessage?.(error, errorFallback) ?? getErrorMessage(error, errorFallback))
			return
		}

		try {
			await onSuccess?.(result, parameters.accountAddress)
			await parameters.refreshState()
		} catch (error) {
			parameters.setErrorMessage(getErrorMessage(error, parameters.refreshErrorFallback ?? 'Transaction succeeded, but refreshing the UI failed'))
		}
	} finally {
		await Promise.resolve(parameters.onTransactionFinished())
	}
}
