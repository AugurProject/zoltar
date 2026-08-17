import type { ComponentChildren } from 'preact';
import type { TransactionContextItem } from '../types/components.js';
type TransactionReviewRow = {
    label: ComponentChildren;
    value: ComponentChildren;
};
type TransactionReviewProps = {
    className?: string;
    context?: TransactionContextItem[];
    details?: TransactionReviewRow[];
    disclosures?: Array<{
        rows: TransactionReviewRow[];
        title: string;
    }>;
    primary: TransactionReviewRow[];
    risks?: ComponentChildren[];
    variant?: 'card' | 'inline';
};
export declare function TransactionReview({ className, context, details, disclosures, primary, risks, variant }: TransactionReviewProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TransactionReview.d.ts.map