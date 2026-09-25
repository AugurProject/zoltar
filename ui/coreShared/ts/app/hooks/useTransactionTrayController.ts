import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionRequestPreview, TransactionSubmissionStatus } from '../../wallet/chainBackend.js'
import {
	canRequestTransaction,
	createInitialTransactionTrayState,
	getTransactionRequestKey,
	markTransactionCanceled,
	markTransactionFailed,
	markTransactionFinished,
	markTransactionPrepared,
	markTransactionPresented,
	markTransactionRequested,
	markTransactionSubmitted,
	resolveTransactionTrayEntry,
	type TransactionTrayState,
} from '../../transactions/transactionTray.js'
import { getTransactionLifecycleHash } from '../../transactions/transactionLifecycle.js'
import { recordTransactionSettled, recordTransactionSubmitted, releaseTransactionActivityWatch } from '../../transactions/transactionActivityStore.js'
import { humanizeTransactionAction } from '../../transactions/transactionPresentations.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '../../types/components.js'
import type { TransactionFailureDetails, TransactionRequestKey } from '../../types/app.js'

type TransactionTrayControllerOptions = {
	onFinished?: () => Promise<void> | void
}

function getActivityTitle(intent: TransactionIntent) {
	return typeof intent.submittedTitle === 'string' ? intent.submittedTitle : humanizeTransactionAction(intent.action)
}

function findChangedHash(previous: TransactionTrayState, next: TransactionTrayState) {
	for (const entry of next.entries) {
		const hash = getTransactionLifecycleHash(entry.lifecycle)
		if (hash === undefined) continue
		const before = previous.entries.find(candidate => candidate.key === entry.key)
		const previousHash = before === undefined ? undefined : getTransactionLifecycleHash(before.lifecycle)
		if (previousHash !== hash) return { entry, hash, previousHash }
	}
	return undefined
}

export function useTransactionTrayController({ onFinished }: TransactionTrayControllerOptions = {}) {
	const transactionState = useSignal(createInitialTransactionTrayState())
	const transactionGenerationRef = useRef(0)
	const transactionGeneration = transactionGenerationRef.current
	const isCurrentGeneration = () => transactionGenerationRef.current === transactionGeneration

	return {
		onTransactionCanceled: (requestKey?: TransactionRequestKey) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			const entry = requestKey === undefined ? undefined : resolveTransactionTrayEntry(previous, requestKey)
			// Canceling the remaining steps leaves a broadcast transaction running; the activity list keeps watching it.
			if (entry?.lifecycle.phase === 'pending') releaseTransactionActivityWatch(entry.lifecycle.hash)
			transactionState.value = markTransactionCanceled(previous, requestKey)
		},
		onTransactionFailed: (message: string, details: TransactionFailureDetails = {}) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			const entry = resolveTransactionTrayEntry(previous, details.requestKey)
			transactionState.value = markTransactionFailed(previous, { kind: details.kind ?? 'error', message }, entry?.key)
			const hash = entry === undefined ? undefined : getTransactionLifecycleHash(entry.lifecycle)
			if (hash !== undefined) recordTransactionSettled(hash, { status: 'failed', failureKind: details.kind ?? 'error' })
		},
		onTransactionFinished: (requestKey?: TransactionRequestKey) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			const entry = resolveTransactionTrayEntry(previous, requestKey)
			// An action that finished after its broadcast without reporting a failure was confirmed.
			if (entry?.lifecycle.phase === 'pending') recordTransactionSettled(entry.lifecycle.hash, { status: 'confirmed' })
			transactionState.value = markTransactionFinished(previous, entry?.key)
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
		onTransactionRequested: (intent: TransactionIntent): TransactionRequestKey | false => {
			if (!isCurrentGeneration()) return false
			if (!canRequestTransaction(transactionState.value, intent)) return false
			transactionState.value = markTransactionRequested(transactionState.value, intent)
			return getTransactionRequestKey(transactionState.value) ?? false
		},
		onTransactionSubmitted: (hash: Hash, status?: TransactionSubmissionStatus) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			transactionState.value = markTransactionSubmitted(previous, hash, status)
			const changed = findChangedHash(previous, transactionState.value)
			if (changed !== undefined) recordTransactionSubmitted({ hash: changed.hash, previousHash: changed.previousHash, scope: changed.entry.intent.scope, title: getActivityTitle(changed.entry.intent) })
		},
		resetForEnvironment: () => {
			transactionGenerationRef.current += 1
			transactionState.value = createInitialTransactionTrayState()
		},
		transactionState,
	}
}
