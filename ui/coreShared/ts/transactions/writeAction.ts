import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatRefreshErrorMessage, formatWriteErrorMessage, isTransactionReviewCancellation, transactionErrorMessages } from '../lib/errors.js'
import { assertActiveWallet, type ActiveWalletContext } from '../wallet/assertActiveWallet.js'
import type { TransactionFailureDetails, TransactionRequestKey, TransactionRequestResult, WriteOperationsParameters } from '../types/app.js'
import type { TransactionIntent } from '../types/components.js'
import { createActiveEnvironmentGuard } from '../lib/activeEnvironment.js'

import { getTransactionReviewSignal } from './transactionReviewScope.js'
import { getTransactionFailureKind } from './transactionLifecycle.js'

export type WriteActionContext = ActiveWalletContext & {
	reviewSignal: AbortSignal
	assertActive: () => void
}

type RunWriteActionParameters = {
	accountAddress: Address | undefined
	formatErrorMessage?: ((error: unknown, fallbackMessage: string) => string) | undefined
	missingWalletMessage: string
	onRefreshError?: ((message: string, hash?: Hash) => void) | undefined
	onTransactionCanceled?: ((requestKey?: TransactionRequestKey) => void) | undefined
	onTransactionFailed?: ((message: string, details?: TransactionFailureDetails) => void) | undefined
	onTransactionFinished: (requestKey?: TransactionRequestKey) => void
	onTransactionRequested: () => TransactionRequestResult
	onWriteCanceled?: (() => void) | undefined
	onWriteError?: ((message: string) => void) | undefined
	reviewSignal?: AbortSignal | undefined
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
			return params.onTransactionRequested(transactionIntent)
		},
		refreshState: params.refreshState,
		setErrorMessage: (message: string | undefined) => {
			errorSignal.value = message
		},
		missingWalletMessage,
	}
}

export async function runWriteAction<TResult extends { hash: Hash }>(parameters: RunWriteActionParameters, action: (walletAddress: Address, activeWallet: WriteActionContext) => Promise<TResult | undefined>, errorFallback: string, onSuccess?: (result: TResult, walletAddress: Address) => Promise<void> | void) {
	if (parameters.accountAddress === undefined) {
		if (parameters.onWriteError === undefined) {
			parameters.setErrorMessage(parameters.missingWalletMessage)
		} else {
			parameters.onWriteError(parameters.missingWalletMessage)
		}
		return
	}

	// Capture ownership before wallet checks or action-specific preparation can yield.
	const reviewSignal = parameters.reviewSignal ?? getTransactionReviewSignal() ?? new AbortController().signal
	const assertActive = () => {
		if (reviewSignal.aborted) throw new Error(transactionErrorMessages.reviewCanceled)
	}
	let ownsTransaction = false
	let requestKey: TransactionRequestKey | undefined
	try {
		const environmentGuard = createActiveEnvironmentGuard()
		let result: TResult | undefined
		try {
			assertActive()
			const activeWallet = await assertActiveWallet(parameters.accountAddress)
			assertActive()
			if (!environmentGuard.isCurrent()) return
			const request = parameters.onTransactionRequested()
			if (request === false) {
				parameters.onWriteCanceled?.()
				return
			}
			ownsTransaction = true
			requestKey = typeof request === 'string' ? request : undefined
			parameters.setErrorMessage(undefined)
			result = await action(parameters.accountAddress, { ...activeWallet, reviewSignal, assertActive })
			if (!environmentGuard.isCurrent()) return
			if (result === undefined) {
				parameters.onWriteCanceled?.()
				parameters.onTransactionCanceled?.(requestKey)
				return
			}
		} catch (error) {
			if (!environmentGuard.isCurrent()) return
			if (isTransactionReviewCancellation(error)) {
				// Closing the review dialog cancels the remaining steps; nothing failed.
				parameters.onWriteCanceled?.()
				if (ownsTransaction) parameters.onTransactionCanceled?.(requestKey)
				return
			}
			const message = parameters.formatErrorMessage?.(error, errorFallback) ?? formatWriteErrorMessage(error, errorFallback)
			if (ownsTransaction) parameters.onTransactionFailed?.(message, { kind: getTransactionFailureKind(error), requestKey })
			if (parameters.onWriteError === undefined) {
				parameters.setErrorMessage(message)
			} else {
				parameters.onWriteError(message)
			}
			return
		}

		try {
			await onSuccess?.(result, parameters.accountAddress)
			if (!environmentGuard.isCurrent()) return
			await parameters.refreshState()
			if (!environmentGuard.isCurrent()) return
		} catch (error) {
			if (!environmentGuard.isCurrent()) return
			const message = formatRefreshErrorMessage(error, parameters.refreshErrorFallback ?? 'Transaction succeeded, but refreshing the UI failed')
			if (parameters.onRefreshError === undefined) {
				parameters.setErrorMessage(message)
			} else {
				parameters.onRefreshError(message, result.hash)
			}
		}
	} finally {
		if (ownsTransaction) await Promise.resolve(parameters.onTransactionFinished(requestKey))
	}
}
