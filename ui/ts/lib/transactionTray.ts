import type { Hash } from '@zoltar/shared/ethereum'
import { getActiveBackend } from './activeEnvironment.js'
import { createAwaitingWalletPresentation, createPreparedWalletPresentation, createTransactionFailurePresentation } from './transactionPresentations.js'
import type { TransactionRequestPreview } from './chainBackend.js'
import type { GlobalTransactionPresentation, TransactionIntent } from '../types/components.js'

export type TransactionTrayState = {
	active: GlobalTransactionPresentation | undefined
	inFlightCount: number
	pendingIntent: TransactionIntent | undefined
	pendingRequestKey: string | undefined
	requestSequence: number
}

export const TRANSACTION_ACTION_LOCK_REASON = 'Finish the current transaction before starting another transaction.'

export function createInitialTransactionTrayState(): TransactionTrayState {
	return {
		active: undefined,
		inFlightCount: 0,
		pendingIntent: undefined,
		pendingRequestKey: undefined,
		requestSequence: 1,
	}
}

function applyActiveBackendTransactionIntentDefaults(intent: TransactionIntent): TransactionIntent {
	return {
		...intent,
		requiresWalletConfirmation: intent.requiresWalletConfirmation ?? getActiveBackend().id !== 'simulation',
	}
}

export function markTransactionRequested(state: TransactionTrayState, pendingIntent: TransactionIntent): TransactionTrayState {
	const requestKey = `transaction-request-${state.requestSequence}`
	const resolvedIntent = applyActiveBackendTransactionIntentDefaults(pendingIntent)
	return {
		...state,
		active: createAwaitingWalletPresentation(resolvedIntent, requestKey),
		inFlightCount: state.inFlightCount + 1,
		pendingIntent: resolvedIntent,
		pendingRequestKey: requestKey,
		requestSequence: state.requestSequence + 1,
	}
}

export function markTransactionPrepared(state: TransactionTrayState, preview: TransactionRequestPreview): TransactionTrayState {
	const pendingIntent = state.pendingIntent
	const pendingRequestKey = state.pendingRequestKey
	if (pendingIntent === undefined || pendingRequestKey === undefined) return state
	const prepared = createPreparedWalletPresentation(pendingIntent, preview, pendingRequestKey)
	return {
		...state,
		active: prepared,
		pendingIntent: {
			...pendingIntent,
			...(prepared.rows === undefined ? {} : { rows: prepared.rows }),
			...(prepared.technicalRows === undefined ? {} : { technicalRows: prepared.technicalRows }),
		},
	}
}

export function markTransactionSubmitted(state: TransactionTrayState, hash: Hash): TransactionTrayState {
	const pendingIntent = state.pendingIntent
	if (pendingIntent === undefined) {
		const active = state.active
		if (active?.tone !== 'pending') return state
		return {
			...state,
			active: {
				...active,
				dismissKey: hash,
				hash,
			},
		}
	}

	return {
		...state,
		active: {
			dismissKey: hash,
			hash,
			...(pendingIntent.submittedDetail === undefined ? {} : { detail: pendingIntent.submittedDetail }),
			...(pendingIntent.rows === undefined ? {} : { rows: pendingIntent.rows }),
			...(pendingIntent.technicalRows === undefined ? {} : { technicalRows: pendingIntent.technicalRows }),
			title: pendingIntent.submittedTitle,
			tone: 'pending',
		},
	}
}

export function markTransactionFailed(state: TransactionTrayState, message: string): TransactionTrayState {
	const active = state.active
	if (active?.tone === 'pending' && active.hash !== undefined) {
		return {
			...state,
			active: {
				...active,
				detail: message,
				dismissKey: active.hash,
				tone: 'error',
			},
			pendingIntent: undefined,
			pendingRequestKey: undefined,
		}
	}

	const pendingIntent = state.pendingIntent
	const pendingRequestKey = state.pendingRequestKey
	if (pendingIntent !== undefined && pendingRequestKey !== undefined) {
		return {
			...state,
			active: createTransactionFailurePresentation(pendingIntent, message, pendingRequestKey),
			pendingIntent: undefined,
			pendingRequestKey: undefined,
		}
	}

	return state
}

export function markTransactionCanceled(state: TransactionTrayState): TransactionTrayState {
	const pendingRequestKey = state.pendingRequestKey
	if (pendingRequestKey === undefined) return state

	return {
		...state,
		active: state.active?.dismissKey === pendingRequestKey ? undefined : state.active,
		pendingIntent: undefined,
		pendingRequestKey: undefined,
	}
}

export function markTransactionPresented(state: TransactionTrayState, active: GlobalTransactionPresentation): TransactionTrayState {
	const previousActive = state.active
	const isSameTransaction = previousActive !== undefined && ((active.hash !== undefined && active.hash === previousActive.hash) || (active.dismissKey !== undefined && active.dismissKey === previousActive.dismissKey))
	const technicalRows = active.technicalRows ?? (isSameTransaction ? previousActive.technicalRows : undefined)
	return {
		...state,
		active: {
			...active,
			...(technicalRows === undefined ? {} : { technicalRows }),
		},
	}
}

export function getTransactionActionLockReason(state: TransactionTrayState): string | undefined {
	return state.inFlightCount > 0 ? TRANSACTION_ACTION_LOCK_REASON : undefined
}

export function markTransactionFinished(state: TransactionTrayState): TransactionTrayState {
	const inFlightCount = Math.max(0, state.inFlightCount - 1)
	return {
		...state,
		inFlightCount,
		...(inFlightCount > 0
			? {}
			: {
					pendingIntent: undefined,
					pendingRequestKey: undefined,
				}),
	}
}
