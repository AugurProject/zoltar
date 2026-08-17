import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as forkAuctionCopy from '../../../copy/forkAuction.js';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '@zoltar/ui-core-shared/lib/pagination.js';
import { getImportedEscalationDepositClaimAmount } from '../lib/reportingDomain.js';
const IMPORTED_FORK_SETTLEMENT_PAGE_SIZE = 25;
function ImportedForkSettlementSide({ activeReportingDetails, disabled, onDepositSelectionChange, renderSettlementAction, resolved, selectedDepositIndexes, side }) {
    const [pageIndex, setPageIndex] = useState(0);
    const pageCount = getPaginationPageCount(BigInt(side.importedUserDeposits.length), IMPORTED_FORK_SETTLEMENT_PAGE_SIZE);
    const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, pageCount);
    const hasNextPage = getHasNextPaginationPage(resolvedPageIndex, pageCount);
    const hasPreviousPage = resolvedPageIndex > 0;
    const pageStartIndex = resolvedPageIndex * IMPORTED_FORK_SETTLEMENT_PAGE_SIZE;
    const pageEndIndex = Math.min(side.importedUserDeposits.length, pageStartIndex + IMPORTED_FORK_SETTLEMENT_PAGE_SIZE);
    const visibleDeposits = useMemo(() => side.importedUserDeposits.slice(pageStartIndex, pageEndIndex), [pageEndIndex, pageStartIndex, side.importedUserDeposits]);
    const paginationPageSummary = formatPaginationSummary(resolvedPageIndex, pageCount);
    const paginationSummary = side.importedUserDeposits.length > IMPORTED_FORK_SETTLEMENT_PAGE_SIZE && paginationPageSummary !== undefined ? forkAuctionCopy.formatImportedForkDepositPageSummary((pageStartIndex + 1).toString(), pageEndIndex.toString(), side.importedUserDeposits.length.toString(), paginationPageSummary) : undefined;
    const settlementGuardMessage = (() => {
        if (!resolved)
            return forkAuctionCopy.forkDepositSettlementAvailabilityDetail;
        if (selectedDepositIndexes.length === 0)
            return forkAuctionCopy.formatDepositSelectionRequired(side.label.toLowerCase());
        return undefined;
    })();
    useEffect(() => {
        if (resolvedPageIndex !== pageIndex)
            setPageIndex(resolvedPageIndex);
    }, [pageIndex, resolvedPageIndex]);
    return (_jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: side.label, variant: 'embedded', children: [_jsxs("div", { className: 'field', children: [_jsx("span", { children: forkAuctionCopy.importedFromParentUniverse }), _jsx("div", { className: 'escalation-selection-list', children: visibleDeposits.map(deposit => {
                            const selected = selectedDepositIndexes.includes(deposit.parentDepositIndex);
                            const claimAmount = getImportedEscalationDepositClaimAmount(activeReportingDetails, side.key, deposit);
                            return (_jsxs("div", { className: 'escalation-selection-item', children: [_jsxs("label", { className: 'escalation-selection-control', children: [_jsx("input", { checked: selected, disabled: disabled, onChange: event => onDepositSelectionChange(side.key, deposit.parentDepositIndex, event.currentTarget.checked), type: 'checkbox' }), _jsxs("span", { className: 'escalation-selection-item-copy', children: [_jsxs("strong", { children: [forkAuctionCopy.parentDepositNumber, deposit.parentDepositIndex.toString()] }), _jsxs("span", { children: [forkAuctionCopy.initiallyDepositedLead, _jsx(CurrencyValue, { value: deposit.amountAttoRep, suffix: commonCopy.rep })] }), _jsx("span", { children: claimAmount === undefined ? (forkAuctionCopy.worthNowPendingFinalSettlement) : (_jsxs(_Fragment, { children: [forkAuctionCopy.worthNowLead, _jsx(CurrencyValue, { value: claimAmount, suffix: commonCopy.rep })] })) })] })] }), _jsxs("details", { className: 'escalation-selection-details', children: [_jsx("summary", { children: commonCopy.technicalDetails }), _jsxs("span", { children: [forkAuctionCopy.importedEntryDepthLead, _jsx(CurrencyValue, { value: deposit.cumulativeAmountAttoRep, suffix: commonCopy.rep })] })] })] }, deposit.parentDepositIndex.toString()));
                        }) }), paginationSummary === undefined ? undefined : (_jsx(PaginationControls, { hasNextPage: hasNextPage, hasPreviousPage: hasPreviousPage, nextLabel: forkAuctionCopy.nextParentDeposits, onNextPage: () => setPageIndex(currentPageIndex => currentPageIndex + 1), onPreviousPage: () => setPageIndex(currentPageIndex => Math.max(0, currentPageIndex - 1)), previousLabel: forkAuctionCopy.previousParentDeposits, summary: paginationSummary }))] }), _jsx("div", { className: 'actions', children: renderSettlementAction({
                    guardMessage: settlementGuardMessage,
                    outcome: side.key,
                    sideLabel: side.label,
                }) })] }, side.key));
}
export function ImportedForkSettlementSection({ activeReportingDetails, disabled, onDepositSelectionChange, renderSettlementAction, resolved, selectedDepositIndexesByOutcome, sides, winningOutcome }) {
    const settleableSides = resolved && winningOutcome !== undefined ? sides.filter(side => side.key === winningOutcome) : sides;
    if (settleableSides.length === 0)
        return undefined;
    return (_jsxs(SectionBlock, { density: 'compact', title: forkAuctionCopy.settleForkCarriedEscalationDeposits, variant: 'embedded', children: [_jsx("p", { className: 'detail', children: forkAuctionCopy.importedDepositSettlementDetail }), resolved ? undefined : _jsx("p", { className: 'detail', children: forkAuctionCopy.forkDepositSettlementAvailabilityDetail }), _jsx("p", { className: 'detail', children: forkAuctionCopy.escalationAuctionHaircutDetail }), settleableSides.map(side => (_jsx(ImportedForkSettlementSide, { activeReportingDetails: activeReportingDetails, disabled: disabled, onDepositSelectionChange: onDepositSelectionChange, renderSettlementAction: renderSettlementAction, resolved: resolved, selectedDepositIndexes: selectedDepositIndexesByOutcome[side.key], side: side }, side.key)))] }));
}
//# sourceMappingURL=ImportedForkSettlementSection.js.map