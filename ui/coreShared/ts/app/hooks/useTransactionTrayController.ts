import { useSignal } from '@preact/signals'
import { useRef } from 'preact/hooks'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionRequestPreview, TransactionSubmissionStatus } from '../../wallet/chainBackend.js'
import {
	canRequestTransaction,
	createInitialTransactionTrayState,
	getPreparingTransactionEntry,
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
			// Only a reverted or replaced broadcast is known to have failed on chain; other failures (such as a check after a
			// confirmed approval) leave the receipt to the activity watcher.
			if (hash !== undefined && (details.kind === 'reverted' || details.kind === 'replaced')) recordTransactionSettled(hash, { status: 'failed', failureKind: details.kind })
			else if (hash !== undefined) releaseTransactionActivityWatch(hash)
		},
		onTransactionFinished: (requestKey?: TransactionRequestKey) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			const entry = resolveTransactionTrayEntry(previous, requestKey)
			if (entry?.lifecycle.phase === 'pending') {
				// Only a presented success confirms the row; otherwise the activity watcher settles it from the receipt.
				const hash = entry.lifecycle.hash
				const succeeded = previous.active?.hash === hash && (previous.active.tone === 'success' || previous.active.tone === 'warning')
				if (succeeded) recordTransactionSettled(hash, { status: 'confirmed' })
				else releaseTransactionActivityWatch(hash)
			}
			transactionState.value = markTransactionFinished(previous, entry?.key)
			void onFinished?.()
		},
		onTransactionPrepared: (preview: TransactionRequestPreview) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			// A multi-write action prepares its next transaction only after the previous one confirmed; settle that row.
			const preparing = getPreparingTransactionEntry(previous)
			if (preparing?.lifecycle.phase === 'pending') recordTransactionSettled(preparing.lifecycle.hash, { status: 'confirmed' })
			transactionState.value = markTransactionPrepared(previous, preview)
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
		onTransactionSubmitted: (hash: Hash, status?: TransactionSubmissionStatus, replacedHash?: Hash) => {
			if (!isCurrentGeneration()) return
			const previous = transactionState.value
			transactionState.value = markTransactionSubmitted(previous, hash, status, replacedHash)
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
