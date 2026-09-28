import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { isWalletRejection } from '../lib/errors.js'

/**
 * One transaction moves through explicit phases: the app review, the wallet prompt, the broadcast
 * transaction waiting for its receipt, and a terminal confirmed or failed phase.
 */
export type TransactionPhase = 'review' | 'wallet' | 'pending' | 'confirmed' | 'failed'

/** Why a transaction failed, so presentation never has to compare error strings. */
export type TransactionFailureKind = 'rejected' | 'reverted' | 'replaced' | 'error'

export type TransactionFailure = Readonly<{ kind: TransactionFailureKind; message: string }>

export type TransactionLifecycle = Readonly<{ phase: 'review' }> | Readonly<{ phase: 'wallet' }> | Readonly<{ phase: 'pending'; hash: Hash }> | Readonly<{ phase: 'confirmed'; hash: Hash }> | Readonly<{ phase: 'failed'; failure: TransactionFailure; hash?: Hash | undefined }>

export type TransactionLifecycleEvent = Readonly<{ type: 'review-confirmed' }> | Readonly<{ type: 'submitted'; hash: Hash }> | Readonly<{ type: 'receipt'; hash: Hash; status: 'success' | 'reverted' }> | Readonly<{ type: 'failed'; failure: TransactionFailure }>

const revertedMessage = 'Transaction reverted.'

export function startTransactionLifecycle(reviewInApp: boolean): TransactionLifecycle {
	return reviewInApp ? { phase: 'review' } : { phase: 'wallet' }
}

/** Pure transition; events that do not apply to the current phase leave it unchanged. */
export function transitionTransactionLifecycle(state: TransactionLifecycle, event: TransactionLifecycleEvent): TransactionLifecycle {
	if (event.type === 'review-confirmed') return state.phase === 'review' ? { phase: 'wallet' } : state
	// A replacement or a recovered broadcast re-reports the hash while the transaction stays pending.
	if (event.type === 'submitted') return state.phase === 'wallet' || state.phase === 'pending' ? { phase: 'pending', hash: event.hash } : state
	if (event.type === 'receipt') {
		if (state.phase !== 'wallet' && state.phase !== 'pending') return state
		if (state.phase === 'pending' && state.hash !== event.hash) return state
		return event.status === 'success' ? { phase: 'confirmed', hash: event.hash } : { phase: 'failed', failure: { kind: 'reverted', message: revertedMessage }, hash: event.hash }
	}
	if (state.phase === 'confirmed') return state
	// A later diagnosis refines the message of an already failed transaction but never its cause.
	if (state.phase === 'failed') return { ...state, failure: { kind: state.failure.kind, message: event.failure.message } }
	return { phase: 'failed', failure: event.failure, hash: state.phase === 'pending' ? state.hash : undefined }
}

export function getTransactionLifecycleHash(state: TransactionLifecycle) {
	return state.phase === 'pending' || state.phase === 'confirmed' || state.phase === 'failed' ? state.hash : undefined
}

/** The user still has to act: the app review or the wallet prompt is open. */
export function isTransactionAwaitingUser(state: TransactionLifecycle) {
	return state.phase === 'review' || state.phase === 'wallet'
}

export function isTransactionSettled(state: TransactionLifecycle) {
	return state.phase === 'confirmed' || state.phase === 'failed'
}

type TransactionFailureMarker = Readonly<{ transactionFailureKind: TransactionFailureKind }>

function isTransactionFailureMarker(value: unknown): value is TransactionFailureMarker {
	if (typeof value !== 'object' || value === null || !('transactionFailureKind' in value)) return false
	const kind = value.transactionFailureKind
	return kind === 'rejected' || kind === 'reverted' || kind === 'replaced' || kind === 'error'
}

/** An error that carries its failure kind, so callers can classify it without parsing the message. */
export function createTransactionFailureError(kind: TransactionFailureKind, message: string) {
	const marker: TransactionFailureMarker = { transactionFailureKind: kind }
	return new Error(message, { cause: marker })
}

export function getTransactionFailureKind(error: unknown): TransactionFailureKind {
	if (isWalletRejection(error)) return 'rejected'
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (isTransactionFailureMarker(current)) return current.transactionFailureKind
		current = 'cause' in current ? current.cause : undefined
	}
	return 'error'
}

export function createTransactionFailure(error: unknown, message: string): TransactionFailure {
	return { kind: getTransactionFailureKind(error), message }
}
