import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
export function PaginationControls({ hasNextPage = false, hasPreviousPage = false, loading = false, loadMoreLabel = commonCopy.loadMore, nextLabel = commonCopy.nextPage, onLoadMore, onNextPage, onPreviousPage, previousLabel = commonCopy.previousPage, summary }) {
    const hasPageNavigation = onPreviousPage !== undefined || onNextPage !== undefined;
    const hasLoadMore = onLoadMore !== undefined;
    if (!hasPageNavigation && !hasLoadMore && summary === undefined)
        return undefined;
    return (_jsxs("div", { className: 'actions', children: [summary === undefined ? undefined : _jsx("span", { className: 'detail', children: summary }), onPreviousPage === undefined ? undefined : (_jsx("button", { className: 'secondary', type: 'button', onClick: onPreviousPage, disabled: !hasPreviousPage || loading, children: previousLabel })), onNextPage === undefined ? undefined : (_jsx("button", { className: 'secondary', type: 'button', onClick: onNextPage, disabled: !hasNextPage || loading, children: nextLabel })), onLoadMore === undefined ? undefined : (_jsx("button", { className: 'secondary', type: 'button', onClick: onLoadMore, disabled: !hasLoadMore || !hasNextPage || loading, children: loadMoreLabel }))] }));
}
//# sourceMappingURL=PaginationControls.js.map