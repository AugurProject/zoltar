import type { Hash } from '@zoltar/shared/ethereum';
import type { TransactionRequestPreview } from './chainBackend.js';
import type { GlobalTransactionPresentation, TransactionIntent } from '../types/components.js';
export type TransactionTrayState = {
    active: GlobalTransactionPresentation | undefined;
    inFlightCount: number;
    pendingIntent: TransactionIntent | undefined;
    pendingRequestKey: string | undefined;
    requestSequence: number;
};
export declare const TRANSACTION_ACTION_LOCK_REASON = "Finish the current transaction before starting another transaction.";
export declare function createInitialTransactionTrayState(): TransactionTrayState;
export declare function markTransactionRequested(state: TransactionTrayState, pendingIntent: TransactionIntent): TransactionTrayState;
export declare function markTransactionPrepared(state: TransactionTrayState, preview: TransactionRequestPreview): TransactionTrayState;
export declare function markTransactionSubmitted(state: TransactionTrayState, hash: Hash): TransactionTrayState;
export declare function markTransactionFailed(state: TransactionTrayState, message: string): TransactionTrayState;
export declare function markTransactionCanceled(state: TransactionTrayState): TransactionTrayState;
export declare function markTransactionPresented(state: TransactionTrayState, active: GlobalTransactionPresentation): TransactionTrayState;
export declare function getTransactionActionLockReason(state: TransactionTrayState): string | undefined;
export declare function markTransactionFinished(state: TransactionTrayState): TransactionTrayState;
//# sourceMappingURL=transactionTray.d.ts.map