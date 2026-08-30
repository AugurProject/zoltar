import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Hash } from '@zoltar/shared/ethereum'
import type { TransactionRequestPreview } from '../../lib/chainBackend.js'
import { createInitialTransactionTrayState, markTransactionCanceled, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '../../lib/transactionTray.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '../../types/components.js'

type TransactionTrayControllerOptions = {
	onFinished?: () => Promise<void> | void
}

export function useTransactionTrayController({ onFinished }: TransactionTrayControllerOptions = {}) {
	const transactionState = useSignal(createInitialTransactionTrayState())
	const transactionGenerationRef = useRef(0)
	const transactionGeneration = transactionGenerationRef.current
	const isCurrentGeneration = () => transactionGenerationRef.current === transactionGeneration

	return {
		onTransactionCanceled: () => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionCanceled(transactionState.value)
		},
		onTransactionFailed: (message: string) => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionFailed(transactionState.value, message)
		},
		onTransactionFinished: () => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionFinished(transactionState.value)
			void onFinished?.()
		},
		onTransactionPrepared: (preview: TransactionRequestPreview) => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionPrepared(transactionState.value, preview)
		},
		onTransactionPresented: (presentation: GlobalTransactionPresentation) => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionPresented(transactionState.value, presentation)
		},
		onTransactionRequested: (intent: TransactionIntent) => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionRequested(transactionState.value, intent)
		},
		onTransactionSubmitted: (hash: Hash) => {
			if (!isCurrentGeneration()) return
			transactionState.value = markTransactionSubmitted(transactionState.value, hash)
		},
		resetForEnvironment: () => {
			transactionGenerationRef.current += 1
			transactionState.value = createInitialTransactionTrayState()
		},
		transactionState,
	}
}
