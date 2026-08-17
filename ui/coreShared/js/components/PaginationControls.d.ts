import type { ComponentChildren } from 'preact';
type PaginationControlsProps = {
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
    loading?: boolean;
    loadMoreLabel?: ComponentChildren;
    nextLabel?: ComponentChildren;
    onLoadMore?: () => void;
    onNextPage?: () => void;
    onPreviousPage?: () => void;
    previousLabel?: ComponentChildren;
    summary?: ComponentChildren;
};
export declare function PaginationControls({ hasNextPage, hasPreviousPage, loading, loadMoreLabel, nextLabel, onLoadMore, onNextPage, onPreviousPage, previousLabel, summary }: PaginationControlsProps): import("preact").JSX.Element | undefined;
export {};
//# sourceMappingURL=PaginationControls.d.ts.map