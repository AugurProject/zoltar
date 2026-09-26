import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import { createAwaitingWalletPresentation, createPreparedWalletPresentation, createTransactionFailurePresentation } from './transactionPresentations.js'
import type { TransactionRequestPreview, TransactionSubmissionStatus } from '../wallet/chainBackend.js'
import { confirmationUnavailableDetail } from '../copy/transaction.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '../types/components.js'
import { getTransactionLifecycleHash, isTransactionAwaitingUser, startTransactionLifecycle, transitionTransactionLifecycle, type TransactionFailure, type TransactionLifecycle } from './transactionLifecycle.js'
import { transactionScopesOverlap, type TransactionScope } from './transactionScope.js'

/** One requested transaction from the moment its action starts until the action finishes. */
type TransactionTrayEntry = Readonly<{
	intent: TransactionIntent
	key: string
	lifecycle: TransactionLifecycle
}>

export type TransactionTrayState = Readonly<{
	active: GlobalTransactionPresentation | undefined
	entries: readonly TransactionTrayEntry[]
	requestSequence: number
}>

export function createInitialTransactionTrayState(): TransactionTrayState {
	return {
		active: undefined,
		entries: [],
		requestSequence: 1,
	}
}

function applyActiveBackendTransactionIntentDefaults(intent: TransactionIntent): TransactionIntent {
	return {
		...intent,
		requiresWalletConfirmation: intent.requiresWalletConfirmation ?? getActiveBackend().id !== 'simulation',
	}
}

function updateEntry(state: TransactionTrayState, key: string, update: (entry: TransactionTrayEntry) => TransactionTrayEntry): TransactionTrayState {
	return { ...state, entries: state.entries.map(entry => (entry.key === key ? update(entry) : entry)) }
}

/** The request the review or wallet prompt belongs to; the wallet handles one prompt at a time. */
function getForegroundEntry(state: TransactionTrayState) {
	return state.entries.find(entry => isTransactionAwaitingUser(entry.lifecycle))
}

/** The request an outcome callback belongs to; callers without a key act on the open prompt or the latest request. */
export function resolveTransactionTrayEntry(state: TransactionTrayState, key: string | undefined) {
	if (key !== undefined) return state.entries.find(entry => entry.key === key)
	return getForegroundEntry(state) ?? state.entries.at(-1)
}

function getEntryHash(entry: TransactionTrayEntry) {
	return getTransactionLifecycleHash(entry.lifecycle)
}

export function getInFlightTransactionCount(state: TransactionTrayState) {
	return state.entries.length
}

export function getTransactionRequestKey(state: TransactionTrayState) {
	return state.entries.at(-1)?.key
}

/** A review or wallet prompt is open; no other transaction can start until the user resolves it. */
export function isTransactionPromptOpen(state: TransactionTrayState) {
	return getForegroundEntry(state) !== undefined
}

/** Scopes of every transaction still running, including ones waiting for their receipt. */
export function getLockedTransactionScopes(state: TransactionTrayState): readonly TransactionScope[] {
	return state.entries.flatMap(entry => (entry.intent.scope === undefined || entry.intent.scope.length === 0 ? [] : [entry.intent.scope]))
}

export function canRequestTransaction(state: TransactionTrayState, intent: TransactionIntent) {
	if (isTransactionPromptOpen(state)) return false
	return !getLockedTransactionScopes(state).some(scope => transactionScopesOverlap(scope, intent.scope))
}

export function markTransactionRequested(state: TransactionTrayState, intent: TransactionIntent): TransactionTrayState {
	const key = `transaction-request-${state.requestSequence}`
	const resolvedIntent = applyActiveBackendTransactionIntentDefaults(intent)
	return {
		active: {
			...createAwaitingWalletPresentation(resolvedIntent, key),
			operationKey: key,
		},
		entries: [...state.entries, { intent: resolvedIntent, key, lifecycle: startTransactionLifecycle(true) }],
		requestSequence: state.requestSequence + 1,
	}
}

/**
 * The request a prepared transaction belongs to: the open prompt, or the only running action preparing its next
 * transaction. With several actions running and no prompt open the preview cannot be attributed, so it is ignored.
 */
export function getPreparingTransactionEntry(state: TransactionTrayState) {
	return getForegroundEntry(state) ?? (state.entries.length === 1 ? state.entries[0] : undefined)
}

export function markTransactionPrepared(state: TransactionTrayState, preview: TransactionRequestPreview): TransactionTrayState {
	const entry = getPreparingTransactionEntry(state)
	if (entry === undefined) return state
	const prepared = createPreparedWalletPresentation(entry.intent, preview, entry.key)
	return {
		...updateEntry(state, entry.key, current => ({
			...current,
			intent: {
				...current.intent,
				...(prepared.rows === undefined ? {} : { rows: prepared.rows }),
				...(prepared.technicalRows === undefined ? {} : { technicalRows: prepared.technicalRows }),
			},
			lifecycle: isTransactionAwaitingUser(current.lifecycle) ? transitionTransactionLifecycle(current.lifecycle, { type: 'review-confirmed' }) : startTransactionLifecycle(false),
		})),
		active: { ...prepared, operationKey: entry.key },
	}
}

function findSubmittedEntry(state: TransactionTrayState, hash: Hash, replacedHash: Hash | undefined) {
	// A recovered broadcast reports a hash the tray already tracks and a replacement names the hash it replaced.
	const tracked = state.entries.find(candidate => getEntryHash(candidate) === hash) ?? (replacedHash === undefined ? undefined : state.entries.find(candidate => getEntryHash(candidate) === replacedHash))
	if (tracked !== undefined) return tracked
	// A new hash belongs to the open wallet prompt; without one it is only attributed when a single broadcast is pending.
	const foreground = getForegroundEntry(state)
	if (foreground !== undefined) return foreground
	const pending = state.entries.filter(candidate => candidate.lifecycle.phase === 'pending')
	return pending.length === 1 ? pending[0] : undefined
}

export function markTransactionSubmitted(state: TransactionTrayState, hash: Hash, status: TransactionSubmissionStatus = 'pending', replacedHash?: Hash): TransactionTrayState {
	const entry = findSubmittedEntry(state, hash, replacedHash)
	if (entry === undefined) return state
	const intent = entry.intent
	const next = updateEntry(state, entry.key, current => ({ ...current, lifecycle: transitionTransactionLifecycle(transitionTransactionLifecycle(current.lifecycle, { type: 'review-confirmed' }), { type: 'submitted', hash }) }))
	const activeBelongsToEntry = state.active === undefined || state.active.operationKey === entry.key || state.active.hash === getEntryHash(entry)
	if (!activeBelongsToEntry) return next
	return {
		...next,
		active: {
			dismissKey: hash,
			hash,
			operationKey: entry.key,
			...(intent.submittedDetail === undefined ? {} : { detail: intent.submittedDetail }),
			...(status === 'uncertain' ? { detail: confirmationUnavailableDetail } : {}),
			...(intent.rows === undefined ? {} : { rows: intent.rows }),
			...(intent.technicalRows === undefined ? {} : { technicalRows: intent.technicalRows }),
			title: intent.submittedTitle,
			tone: 'pending',
			...(intent.universeId === undefined ? {} : { universeId: intent.universeId }),
		},
	}
}

export function markTransactionFailed(state: TransactionTrayState, failure: TransactionFailure, key?: string): TransactionTrayState {
	const entry = resolveTransactionTrayEntry(state, key)
	if (entry === undefined) return state
	const next = updateEntry(state, entry.key, current => ({ ...current, lifecycle: transitionTransactionLifecycle(current.lifecycle, { type: 'failed', failure }) }))
	const hash = getEntryHash(entry)
	if (hash !== undefined) {
		const active = state.active?.hash === hash ? state.active : undefined
		return {
			...next,
			active: {
				...(active ?? { hash, operationKey: entry.key, title: entry.intent.submittedTitle, tone: 'pending' }),
				detail: failure.message,
				dismissKey: hash,
				title: entry.intent.failedTitle ?? active?.title ?? entry.intent.submittedTitle,
				tone: 'error',
			},
		}
	}
	return {
		...next,
		active: {
			...createTransactionFailurePresentation(entry.intent, failure.message, entry.key),
			operationKey: entry.key,
		},
	}
}

export function markTransactionCanceled(state: TransactionTrayState, key?: string): TransactionTrayState {
	const entry = key === undefined ? getForegroundEntry(state) : state.entries.find(candidate => candidate.key === key)
	if (entry === undefined) return state
	return {
		...state,
		active: state.active?.dismissKey === entry.key ? undefined : state.active,
		entries: state.entries.filter(candidate => candidate.key !== entry.key),
	}
}

export function markTransactionPresented(state: TransactionTrayState, active: GlobalTransactionPresentation): TransactionTrayState {
	const previousActive = state.active
	const isSameTransaction = previousActive !== undefined && ((active.hash !== undefined && active.hash === previousActive.hash) || (active.dismissKey !== undefined && active.dismissKey === previousActive.dismissKey))
	const operationKey = isSameTransaction ? (previousActive.operationKey ?? active.operationKey ?? active.dismissKey ?? active.hash) : (active.operationKey ?? active.dismissKey ?? active.hash)
	const technicalRows = active.technicalRows ?? (isSameTransaction ? previousActive.technicalRows : undefined)
	const universeId = active.universeId ?? (isSameTransaction ? previousActive.universeId : undefined)
	return {
		...state,
		active: {
			...active,
			...(operationKey === undefined ? {} : { operationKey }),
			...(technicalRows === undefined ? {} : { technicalRows }),
			...(universeId === undefined ? {} : { universeId }),
		},
	}
}

/**
 * An action is locked while a review or wallet prompt is open, or while a running transaction touches one of
 * the objects in its scope. An unscoped action is not locked by unrelated transactions still waiting for receipts.
 */
export function isTransactionActionLocked(state: TransactionTrayState, scope?: TransactionScope) {
	if (isTransactionPromptOpen(state)) return true
	return getLockedTransactionScopes(state).some(locked => transactionScopesOverlap(locked, scope))
}

export function markTransactionFinished(state: TransactionTrayState, key?: string): TransactionTrayState {
	const entry = resolveTransactionTrayEntry(state, key)
	if (entry === undefined) return state
	return { ...state, entries: state.entries.filter(candidate => candidate.key !== entry.key) }
}
