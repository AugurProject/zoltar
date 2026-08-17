import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as forkAuctionCopy from '../../../copy/forkAuction.js';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '@zoltar/ui-core-shared/lib/pagination.js';
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js';
const ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE = 25;
export function EscalationDepositSelectionList({ disabled = false, items, onSelectionChange, selectedDepositIndexes }) {
    const [pageIndex, setPageIndex] = useState(0);
    const pageCount = getPaginationPageCount(BigInt(items.length), ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE);
    const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, pageCount);
    const hasNextPage = getHasNextPaginationPage(resolvedPageIndex, pageCount);
    const hasPreviousPage = resolvedPageIndex > 0;
    const pageStartIndex = resolvedPageIndex * ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE;
    const pageEndIndex = Math.min(items.length, pageStartIndex + ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE);
    const visibleItems = useMemo(() => items.slice(pageStartIndex, pageEndIndex), [items, pageEndIndex, pageStartIndex]);
    const paginationPageSummary = formatPaginationSummary(resolvedPageIndex, pageCount);
    const paginationSummary = items.length > ESCALATION_DEPOSIT_SELECTION_PAGE_SIZE && paginationPageSummary !== undefined ? forkAuctionCopy.formatEscalationDepositPageSummary((pageStartIndex + 1).toString(), pageEndIndex.toString(), items.length.toString(), paginationPageSummary) : undefined;
    useEffect(() => {
        if (resolvedPageIndex !== pageIndex)
            setPageIndex(resolvedPageIndex);
    }, [pageIndex, resolvedPageIndex]);
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: 'withdraw-deposit-list', children: visibleItems.map(item => {
                    const { deposit, details, secondaryDetails = [] } = item;
                    const isChecked = selectedDepositIndexes.includes(deposit.depositIndex);
                    return (_jsxs("div", { className: 'withdraw-deposit-option', children: [_jsxs("label", { className: 'withdraw-deposit-selection', children: [_jsx("input", { type: 'checkbox', checked: isChecked, disabled: disabled, onChange: event => {
                                            const nextSelectedDepositIndexes = event.currentTarget.checked ? [...selectedDepositIndexes, deposit.depositIndex] : selectedDepositIndexes.filter(index => index !== deposit.depositIndex);
                                            onSelectionChange(nextSelectedDepositIndexes);
                                        } }), _jsxs("span", { className: 'withdraw-deposit-copy', children: [_jsxs("strong", { children: [forkAuctionCopy.depositNumber, deposit.depositIndex.toString()] }), details.map((detail, detailIndex) => (_jsx("span", { children: detail }, `${deposit.depositIndex.toString()}:${detailIndex.toString()}`)))] })] }), secondaryDetails.length === 0 ? undefined : (_jsxs("details", { className: 'withdraw-deposit-details', children: [_jsx("summary", { children: commonCopy.technicalDetails }), _jsx("div", { children: secondaryDetails.map((detail, detailIndex) => (_jsx("span", { children: detail }, `${deposit.depositIndex.toString()}:secondary:${detailIndex.toString()}`))) })] }))] }, deposit.depositIndex.toString()));
                }) }), paginationSummary === undefined ? undefined : (_jsx(PaginationControls, { hasNextPage: hasNextPage, hasPreviousPage: hasPreviousPage, nextLabel: forkAuctionCopy.nextDeposits, onNextPage: () => setPageIndex(currentPageIndex => currentPageIndex + 1), onPreviousPage: () => setPageIndex(currentPageIndex => Math.max(0, currentPageIndex - 1)), previousLabel: forkAuctionCopy.previousDeposits, summary: paginationSummary }))] }));
}
//# sourceMappingURL=EscalationDepositSelectionList.js.map