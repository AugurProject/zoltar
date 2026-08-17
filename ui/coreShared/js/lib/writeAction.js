import { formatRefreshErrorMessage, formatWriteErrorMessage } from './errors.js';
import { assertActiveWallet } from './assertActiveWallet.js';
export function buildWriteActionConfig(params, errorSignal, missingWalletMessage, transactionIntent) {
    return {
        accountAddress: params.accountAddress,
        onTransactionCanceled: params.onTransactionCanceled,
        onTransactionFinished: params.onTransactionFinished,
        onTransactionFailed: params.onTransactionFailed,
        onTransactionRequested: () => {
            params.onTransactionRequested(transactionIntent);
        },
        refreshState: params.refreshState,
        setErrorMessage: (message) => {
            errorSignal.value = message;
        },
        missingWalletMessage,
    };
}
export async function runWriteAction(parameters, action, errorFallback, onSuccess) {
    if (parameters.accountAddress === undefined) {
        if (parameters.onWriteError === undefined) {
            parameters.setErrorMessage(parameters.missingWalletMessage);
        }
        else {
            parameters.onWriteError(parameters.missingWalletMessage);
        }
        return;
    }
    try {
        let result;
        try {
            const activeWallet = await assertActiveWallet(parameters.accountAddress);
            parameters.onTransactionRequested();
            parameters.setErrorMessage(undefined);
            result = await action(parameters.accountAddress, activeWallet);
            if (result === undefined) {
                parameters.onWriteCanceled?.();
                parameters.onTransactionCanceled?.();
                return;
            }
        }
        catch (error) {
            const message = parameters.formatErrorMessage?.(error, errorFallback) ?? formatWriteErrorMessage(error, errorFallback);
            parameters.onTransactionFailed?.(message);
            if (parameters.onWriteError === undefined) {
                parameters.setErrorMessage(message);
            }
            else {
                parameters.onWriteError(message);
            }
            return;
        }
        try {
            await onSuccess?.(result, parameters.accountAddress);
            await parameters.refreshState();
        }
        catch (error) {
            const message = formatRefreshErrorMessage(error, parameters.refreshErrorFallback ?? 'Transaction succeeded, but refreshing the UI failed');
            if (parameters.onRefreshError === undefined) {
                parameters.setErrorMessage(message);
            }
            else {
                parameters.onRefreshError(message, result.hash);
            }
        }
    }
    finally {
        await Promise.resolve(parameters.onTransactionFinished());
    }
}
//# sourceMappingURL=writeAction.js.map