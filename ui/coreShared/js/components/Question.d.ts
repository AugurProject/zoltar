import type { MarketDetails } from '../types/contracts.js';
type QuestionProps = {
    className?: string;
    loading?: boolean;
    question: MarketDetails | undefined;
    showTitle?: boolean;
    variant?: 'full' | 'preview';
};
type QuestionSummaryField = {
    kind: 'text';
    label: string;
    value: string;
} | {
    kind: 'identifier';
    label: string;
    value: string;
} | {
    kind: 'timestamp';
    label: string;
    value: bigint;
};
export declare function getQuestionTitle(question: MarketDetails): string;
export declare function getQuestionSummaryFields(question: MarketDetails): QuestionSummaryField[];
export declare function Question({ className, loading, question, showTitle, variant }: QuestionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=Question.d.ts.map