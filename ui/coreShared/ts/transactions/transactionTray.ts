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
	/** This request's latest status presentation, restored when another request's prompt closes. */
	presentation?: GlobalTransactionPresentation | undefined
}>

/** One status presentation and the request it belongs to; `sequence` orders them by arrival. */
type PresentationRecord = Readonly<{ key: string | undefined; presentation: GlobalTransactionPresentation; sequence: number }>

export type TransactionTrayState = Readonly<{
	/** The status shown to the user, derived from `presentations`: the open prompt's own status, else the newest. */
	active: GlobalTransactionPresentation | undefined
	entries: readonly TransactionTrayEntry[]
	/** Recent statuses, one per request, newest last; kept after a request finishes so its outcome stays visible. */
	presentations?: readonly PresentationRecord[] | undefined
	requestSequence: number
}>

const MAX_PRESENTATIONS = 10

export function createInitialTransactionTrayState(): TransactionTrayState {
	return {
		active: undefined,
		entries: [],
		presentations: [],
		requestSequence: 1,
	}
}

function isPromptPresentation(presentation: GlobalTransactionPresentation) {
	return presentation.tone === 'awaiting-wallet' || presentation.tone === 'preparing'
}

/**
 * The shown status: while a review or wallet prompt is open it is always that prompt's own status, so another
 * request's outcome cannot replace or cancel the review the user is working in; otherwise it is the newest status.
 */
function deriveActive(state: TransactionTrayState): TransactionTrayState {
	const records = state.presentations ?? []
	const foreground = getForegroundEntry(state)
	if (foreground !== undefined) return { ...state, active: records.findLast(record => record.key === foreground.key)?.presentation ?? state.active }
	return { ...state, active: records.at(-1)?.presentation }
}

/** Records a request's latest status (replacing its previous one) and re-derives the shown status. */
function present(state: TransactionTrayState, ownerKey: string | undefined, presentation: GlobalTransactionPresentation): TransactionTrayState {
	const owner = state.entries.find(entry => entry.key === ownerKey)
	if (presentation.showStatusDialog === undefined && owner?.intent.showStatusDialog === false) presentation = { ...presentation, showStatusDialog: false }
	const records = state.presentations ?? []
	const sequence = (records.at(-1)?.sequence ?? 0) + 1
	const kept = ownerKey === undefined ? records.filter(record => record.presentation.hash === undefined || record.presentation.hash !== presentation.hash) : records.filter(record => record.key !== ownerKey)
	const entries = ownerKey === undefined ? state.entries : state.entries.map(entry => (entry.key === ownerKey ? { ...entry, presentation } : entry))
	return deriveActive({ ...state, entries, presentations: [...kept, { key: ownerKey, presentation, sequence }].slice(-MAX_PRESENTATIONS) })
}

/** A request that ends without broadcasting drops its review or wallet prompt status. */
function dropPromptPresentation(state: TransactionTrayState, key: string): TransactionTrayState {
	const records = state.presentations ?? []
	return deriveActive({ ...state, presentations: records.filter(record => record.key !== key || !isPromptPresentation(record.presentation)) })
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
	const presentation = { ...createAwaitingWalletPresentation(resolvedIntent, key), operationKey: key }
	return present({ ...state, entries: [...state.entries, { intent: resolvedIntent, key, lifecycle: startTransactionLifecycle(true) }], requestSequence: state.requestSequence + 1 }, key, presentation)
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
	const next = updateEntry(state, entry.key, current => ({
		...current,
		intent: {
			...current.intent,
			...(prepared.rows === undefined ? {} : { rows: prepared.rows }),
			...(prepared.technicalRows === undefined ? {} : { technicalRows: prepared.technicalRows }),
		},
		lifecycle: isTransactionAwaitingUser(current.lifecycle) ? transitionTransactionLifecycle(current.lifecycle, { type: 'review-confirmed' }) : startTransactionLifecycle(false),
	}))
	return present(next, entry.key, { ...prepared, operationKey: entry.key })
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
	// A later report for an entry whose outcome is already shown (such as a recovered receipt) does not replace it.
	if (entry.presentation !== undefined && entry.presentation.tone !== 'pending' && entry.presentation.tone !== 'awaiting-wallet' && entry.presentation.tone !== 'preparing') return next
	return present(next, entry.key, {
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
	})
}

export function markTransactionFailed(state: TransactionTrayState, failure: TransactionFailure, key?: string): TransactionTrayState {
	const entry = resolveTransactionTrayEntry(state, key)
	if (entry === undefined) return state
	const next = updateEntry(state, entry.key, current => ({ ...current, lifecycle: transitionTransactionLifecycle(current.lifecycle, { type: 'failed', failure }) }))
	const hash = getEntryHash(entry)
	if (hash !== undefined) {
		const previous = entry.presentation?.hash === hash ? entry.presentation : undefined
		return present(next, entry.key, {
			...(previous ?? { hash, title: entry.intent.submittedTitle, tone: 'pending' }),
			detail: failure.message,
			dismissKey: hash,
			operationKey: entry.key,
			title: entry.intent.failedTitle ?? previous?.title ?? entry.intent.submittedTitle,
			tone: 'error',
		})
	}
	return present(next, entry.key, { ...createTransactionFailurePresentation(entry.intent, failure.message, entry.key), operationKey: entry.key })
}

export function markTransactionCanceled(state: TransactionTrayState, key?: string): TransactionTrayState {
	const entry = key === undefined ? getForegroundEntry(state) : state.entries.find(candidate => candidate.key === key)
	if (entry === undefined) return state
	return dropPromptPresentation({ ...state, entries: state.entries.filter(candidate => candidate.key !== entry.key) }, entry.key)
}

export function markTransactionPresented(state: TransactionTrayState, active: GlobalTransactionPresentation): TransactionTrayState {
	// The presentation belongs to the request that broadcast its hash, else to the open prompt or the only running request.
	const owner = (active.hash === undefined ? undefined : state.entries.find(entry => entry.presentation?.hash === active.hash || getEntryHash(entry) === active.hash)) ?? getForegroundEntry(state) ?? (state.entries.length === 1 ? state.entries[0] : undefined)
	const previousActive = owner?.presentation ?? state.active
	const isSameTransaction = previousActive !== undefined && ((active.hash !== undefined && active.hash === previousActive.hash) || (active.dismissKey !== undefined && active.dismissKey === previousActive.dismissKey))
	const operationKey = isSameTransaction ? (previousActive.operationKey ?? active.operationKey ?? active.dismissKey ?? active.hash) : (active.operationKey ?? active.dismissKey ?? active.hash)
	const technicalRows = active.technicalRows ?? (isSameTransaction ? previousActive.technicalRows : undefined)
	const universeId = active.universeId ?? (isSameTransaction ? previousActive.universeId : undefined)
	return present(state, owner?.key, {
		...active,
		...(operationKey === undefined ? {} : { operationKey }),
		...(technicalRows === undefined ? {} : { technicalRows }),
		...(universeId === undefined ? {} : { universeId }),
	})
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
	return dropPromptPresentation({ ...state, entries: state.entries.filter(candidate => candidate.key !== entry.key) }, entry.key)
}
