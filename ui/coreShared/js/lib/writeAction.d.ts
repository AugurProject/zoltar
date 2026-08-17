import type { Address, Hash } from '@zoltar/shared/ethereum';
import { type ActiveWalletContext } from './assertActiveWallet.js';
import type { WriteOperationsParameters } from '../types/app.js';
import type { TransactionIntent } from '../types/components.js';
type RunWriteActionParameters = {
    accountAddress: Address | undefined;
    formatErrorMessage?: ((error: unknown, fallbackMessage: string) => string) | undefined;
    missingWalletMessage: string;
    onRefreshError?: ((message: string, hash?: Hash) => void) | undefined;
    onTransactionCanceled?: (() => void) | undefined;
    onTransactionFailed?: ((message: string) => void) | undefined;
    onTransactionFinished: () => void;
    onTransactionRequested: () => void;
    onWriteCanceled?: (() => void) | undefined;
    onWriteError?: ((message: string) => void) | undefined;
    refreshErrorFallback?: string;
    refreshState: WriteOperationsParameters['refreshState'];
    setErrorMessage: (message: string | undefined) => void;
};
type BuildWriteActionConfigParameters = {
    accountAddress: WriteOperationsParameters['accountAddress'];
    onTransactionCanceled: WriteOperationsParameters['onTransactionCanceled'];
    onTransactionFailed: WriteOperationsParameters['onTransactionFailed'] | undefined;
    onTransactionFinished: WriteOperationsParameters['onTransactionFinished'];
    onTransactionPresented: WriteOperationsParameters['onTransactionPresented'];
    onTransactionPrepared: WriteOperationsParameters['onTransactionPrepared'];
    onTransactionRequested: WriteOperationsParameters['onTransactionRequested'];
    refreshState: WriteOperationsParameters['refreshState'];
};
export declare function buildWriteActionConfig(params: BuildWriteActionConfigParameters, errorSignal: {
    value: string | undefined;
}, missingWalletMessage: string, transactionIntent: TransactionIntent): {
    accountAddress: `0x${string}` | undefined;
    onTransactionCanceled: (() => void) | undefined;
    onTransactionFinished: () => void;
    onTransactionFailed: ((message: string) => void) | undefined;
    onTransactionRequested: () => void;
    refreshState: (options?: import("../types/app.js").RefreshStateOptions) => Promise<void>;
    setErrorMessage: (message: string | undefined) => void;
    missingWalletMessage: string;
};
export declare function runWriteAction<TResult extends {
    hash: Hash;
}>(parameters: RunWriteActionParameters, action: (walletAddress: Address, activeWallet: ActiveWalletContext) => Promise<TResult | undefined>, errorFallback: string, onSuccess?: (result: TResult, walletAddress: Address) => Promise<void> | void): Promise<void>;
export {};
//# sourceMappingURL=writeAction.d.ts.map