import type { Hash } from '@zoltar/shared/ethereum';
import type { TransactionRequestPreview } from './chainBackend.js';
import type { GlobalTransactionPresentation, GlobalTransactionRow, TransactionIntent } from '../types/components.js';
export declare function buildPresentation({ detail, hash, rows, title, tone }: {
    detail?: GlobalTransactionPresentation['detail'];
    hash: Hash;
    rows?: GlobalTransactionRow[] | undefined;
    title: GlobalTransactionPresentation['title'];
    tone: GlobalTransactionPresentation['tone'];
}): GlobalTransactionPresentation;
export declare function buildIntent({ action, rows, source, submittedDetail, submittedTitle }: {
    action: string;
    rows?: GlobalTransactionRow[] | undefined;
    source: string;
    submittedDetail?: TransactionIntent['submittedDetail'];
    submittedTitle: TransactionIntent['submittedTitle'];
}): TransactionIntent;
export declare function withWarning(base: GlobalTransactionPresentation, detail: string): GlobalTransactionPresentation;
export declare function createAwaitingWalletPresentation(intent: TransactionIntent, dismissKey: string): GlobalTransactionPresentation;
export declare function createPreparedWalletPresentation(intent: TransactionIntent, preview: TransactionRequestPreview, dismissKey: string): GlobalTransactionPresentation;
export declare function createTransactionFailurePresentation(intent: TransactionIntent, message: string, dismissKey: string): GlobalTransactionPresentation;
//# sourceMappingURL=transactionPresentations.d.ts.map