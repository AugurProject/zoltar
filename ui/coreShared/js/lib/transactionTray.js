import { getActiveBackend } from './activeEnvironment.js';
import { createAwaitingWalletPresentation, createPreparedWalletPresentation, createTransactionFailurePresentation } from './transactionPresentations.js';
export const TRANSACTION_ACTION_LOCK_REASON = 'Finish the current transaction before starting another transaction.';
export function createInitialTransactionTrayState() {
    return {
        active: undefined,
        inFlightCount: 0,
        pendingIntent: undefined,
        pendingRequestKey: undefined,
        requestSequence: 1,
    };
}
function applyActiveBackendTransactionIntentDefaults(intent) {
    return {
        ...intent,
        requiresWalletConfirmation: intent.requiresWalletConfirmation ?? getActiveBackend().id !== 'simulation',
    };
}
export function markTransactionRequested(state, pendingIntent) {
    const requestKey = `transaction-request-${state.requestSequence}`;
    const resolvedIntent = applyActiveBackendTransactionIntentDefaults(pendingIntent);
    return {
        ...state,
        active: {
            ...createAwaitingWalletPresentation(resolvedIntent, requestKey),
            operationKey: requestKey,
        },
        inFlightCount: state.inFlightCount + 1,
        pendingIntent: resolvedIntent,
        pendingRequestKey: requestKey,
        requestSequence: state.requestSequence + 1,
    };
}
export function markTransactionPrepared(state, preview) {
    const pendingIntent = state.pendingIntent;
    const pendingRequestKey = state.pendingRequestKey;
    if (pendingIntent === undefined || pendingRequestKey === undefined)
        return state;
    const prepared = createPreparedWalletPresentation(pendingIntent, preview, pendingRequestKey);
    return {
        ...state,
        active: {
            ...prepared,
            operationKey: pendingRequestKey,
        },
        pendingIntent: {
            ...pendingIntent,
            ...(prepared.rows === undefined ? {} : { rows: prepared.rows }),
            ...(prepared.technicalRows === undefined ? {} : { technicalRows: prepared.technicalRows }),
        },
    };
}
export function markTransactionSubmitted(state, hash) {
    const pendingIntent = state.pendingIntent;
    if (pendingIntent === undefined) {
        const active = state.active;
        if (active?.tone !== 'pending')
            return state;
        return {
            ...state,
            active: {
                ...active,
                dismissKey: hash,
                hash,
            },
        };
    }
    return {
        ...state,
        active: {
            dismissKey: hash,
            hash,
            operationKey: state.pendingRequestKey ?? state.active?.operationKey ?? hash,
            ...(pendingIntent.submittedDetail === undefined ? {} : { detail: pendingIntent.submittedDetail }),
            ...(pendingIntent.rows === undefined ? {} : { rows: pendingIntent.rows }),
            ...(pendingIntent.technicalRows === undefined ? {} : { technicalRows: pendingIntent.technicalRows }),
            title: pendingIntent.submittedTitle,
            tone: 'pending',
        },
    };
}
export function markTransactionFailed(state, message) {
    const active = state.active;
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
        };
    }
    const pendingIntent = state.pendingIntent;
    const pendingRequestKey = state.pendingRequestKey;
    if (pendingIntent !== undefined && pendingRequestKey !== undefined) {
        return {
            ...state,
            active: {
                ...createTransactionFailurePresentation(pendingIntent, message, pendingRequestKey),
                operationKey: pendingRequestKey,
            },
            pendingIntent: undefined,
            pendingRequestKey: undefined,
        };
    }
    return state;
}
export function markTransactionCanceled(state) {
    const pendingRequestKey = state.pendingRequestKey;
    if (pendingRequestKey === undefined)
        return state;
    return {
        ...state,
        active: state.active?.dismissKey === pendingRequestKey ? undefined : state.active,
        pendingIntent: undefined,
        pendingRequestKey: undefined,
    };
}
export function markTransactionPresented(state, active) {
    const previousActive = state.active;
    const isSameTransaction = previousActive !== undefined && ((active.hash !== undefined && active.hash === previousActive.hash) || (active.dismissKey !== undefined && active.dismissKey === previousActive.dismissKey));
    const operationKey = isSameTransaction ? (previousActive.operationKey ?? active.operationKey ?? active.dismissKey ?? active.hash) : (active.operationKey ?? active.dismissKey ?? active.hash);
    const technicalRows = active.technicalRows ?? (isSameTransaction ? previousActive.technicalRows : undefined);
    return {
        ...state,
        active: {
            ...active,
            ...(operationKey === undefined ? {} : { operationKey }),
            ...(technicalRows === undefined ? {} : { technicalRows }),
        },
    };
}
export function getTransactionActionLockReason(state) {
    return state.inFlightCount > 0 ? TRANSACTION_ACTION_LOCK_REASON : undefined;
}
export function markTransactionFinished(state) {
    const inFlightCount = Math.max(0, state.inFlightCount - 1);
    return {
        ...state,
        inFlightCount,
        ...(inFlightCount > 0
            ? {}
            : {
                pendingIntent: undefined,
                pendingRequestKey: undefined,
            }),
    };
}
//# sourceMappingURL=transactionTray.js.map