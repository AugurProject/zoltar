import type { Address, Hash } from 'viem'
import { getErrorMessage } from './errors.js'

type RunWriteActionParameters = {
	accountAddress: Address | undefined
	missingWalletMessage: string
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	refreshState: () => Promise<void>
	setErrorMessage: (message: string | undefined) => void
}

export async function runWriteAction<TResult extends { hash: Hash }>(parameters: RunWriteActionParameters, action: (walletAddress: Address) => Promise<TResult>, errorFallback: string, onSuccess?: (result: TResult, walletAddress: Address) => Promise<void> | void) {
	if (parameters.accountAddress === undefined) {
		parameters.setErrorMessage(parameters.missingWalletMessage)
		return
	}

	try {
		parameters.onTransactionRequested()
		parameters.setErrorMessage(undefined)
		const result = await action(parameters.accountAddress)
		await Promise.resolve(parameters.onTransaction(result.hash))
		await onSuccess?.(result, parameters.accountAddress)
		await parameters.refreshState()
	} catch (error) {
		parameters.setErrorMessage(getErrorMessage(error, errorFallback))
	} finally {
		await Promise.resolve(parameters.onTransactionFinished())
	}
}
