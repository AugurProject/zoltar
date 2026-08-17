import type { RefObject } from 'preact';
import type { GlobalTransactionPresentation } from '../types/components.js';
type TransactionPresentationNoticeProps = {
    className?: string;
    compact?: boolean;
    dismissible?: boolean;
    noticeRef?: RefObject<HTMLDivElement>;
    onDismiss?: () => void;
    transaction: GlobalTransactionPresentation;
};
export declare function TransactionPresentationNotice({ className, compact, dismissible, noticeRef, onDismiss, transaction }: TransactionPresentationNoticeProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TransactionPresentationNotice.d.ts.map