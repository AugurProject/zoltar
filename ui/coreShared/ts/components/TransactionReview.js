import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as transactionReviewCopy from '../copy/transactionReview.js';
import { useId } from 'preact/hooks';
import { TransactionObjectContext } from './TransactionObjectContext.js';
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js';
function renderDetailRows(rows) {
    return (_jsx("div", { className: 'transaction-review-details', role: 'list', children: rows.map((row, index) => (_jsxs("div", { className: 'transaction-review-detail-row', role: 'listitem', children: [_jsx("span", { children: row.label }), _jsx("strong", { children: row.value })] }, `${index}`))) }));
}
export function TransactionReview({ className = '', context = [], details = [], disclosures = [], primary, risks = [], variant = 'card' }) {
    const titleId = useId();
    const contents = (_jsxs(_Fragment, { children: [_jsx(TransactionObjectContext, { items: context }), _jsx("div", { className: 'transaction-review-primary', role: 'list', children: primary.map((row, index) => (_jsxs("div", { className: 'transaction-review-row', role: 'listitem', children: [_jsx("span", { children: row.label }), _jsx("strong", { children: row.value })] }, `${index}`))) }), details.length === 0 ? undefined : renderDetailRows(details), risks.length === 0 ? undefined : (_jsxs("div", { className: 'transaction-review-risks', children: [_jsx("strong", { children: transactionReviewCopy.risksAndConsequences }), _jsx("ul", { children: risks.map((risk, index) => (_jsx("li", { children: risk }, `${index}`))) })] })), disclosures.map(disclosure => (_jsx(ReadOnlyDetailAccordion, { title: disclosure.title, children: renderDetailRows(disclosure.rows) }, disclosure.title)))] }));
    if (variant === 'inline')
        return contents;
    return (_jsxs("section", { className: `transaction-review ${className}`.trim(), "aria-labelledby": titleId, children: [_jsx("div", { className: 'transaction-review-header', children: _jsx("h4", { id: titleId, children: transactionReviewCopy.transactionReview }) }), contents] }));
}
//# sourceMappingURL=TransactionReview.js.map