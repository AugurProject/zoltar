import { useSignal } from '@preact/signals'
import type { Hash } from '@zoltar/shared/ethereum'
import type { TransactionRequestPreview } from '../../lib/chainBackend.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '../../lib/transactionTray.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '../../types/components.js'

type TransactionTrayControllerOptions = {
	onFinished?: () => Promise<void> | void
}

export function useTransactionTrayController({ onFinished }: TransactionTrayControllerOptions = {}) {
	const transactionState = useSignal(createInitialTransactionTrayState())

	return {
		onTransactionCanceled: () => {
			transactionState.value = markTransactionCanceled(transactionState.value)
		},
		onTransactionFailed: (message: string) => {
			transactionState.value = markTransactionFailed(transactionState.value, message)
		},
		onTransactionFinished: () => {
			transactionState.value = markTransactionFinished(transactionState.value)
			void onFinished?.()
		},
		onTransactionPrepared: (preview: TransactionRequestPreview) => {
			transactionState.value = markTransactionPrepared(transactionState.value, preview)
		},
		onTransactionPresented: (presentation: GlobalTransactionPresentation) => {
			transactionState.value = markTransactionPresented(transactionState.value, presentation)
		},
		onTransactionRequested: (intent: TransactionIntent) => {
			transactionState.value = markTransactionRequested(transactionState.value, intent)
		},
		onTransactionSubmitted: (hash: Hash) => {
			transactionState.value = markTransactionSubmitted(transactionState.value, hash)
		},
		transactionState,
	}
}
