import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import * as transactionCopy from '../copy/transaction.js';
import { Badge } from './Badge.js';
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js';
import { TransactionHashLink } from './TransactionHashLink.js';
function getTransactionBadge(tone) {
    if (tone === 'preparing')
        return { tone: 'pending', label: transactionCopy.preparing };
    if (tone === 'awaiting-wallet')
        return { tone: 'pending', label: transactionCopy.awaitingWallet };
    if (tone === 'pending')
        return { tone: 'pending', label: commonCopy.pending };
    if (tone === 'success')
        return { tone: 'ok', label: transactionCopy.confirmed };
    if (tone === 'error')
        return { tone: 'danger', label: commonCopy.failed };
    return { tone: 'warning', label: transactionCopy.attention };
}
export function TransactionPresentationNotice({ className = '', compact = false, dismissible = false, noticeRef, onDismiss, transaction }) {
    const badge = getTransactionBadge(transaction.tone);
    const transactionHash = transaction.hash;
    const rows = transaction.rows ?? [];
    const technicalRows = transaction.technicalRows ?? [];
    const noticeClassName = ['global-transaction-notice', compact ? 'global-transaction-notice-compact' : '', className].filter(Boolean).join(' ');
    const transactionDetails = (_jsxs(_Fragment, { children: [transaction.detail === undefined ? undefined : _jsx("div", { className: 'global-transaction-notice-detail', children: transaction.detail }), rows.length === 0 ? undefined : (_jsx("dl", { className: 'global-transaction-notice-rows', children: rows.map((row, rowIndex) => (_jsxs("div", { className: 'global-transaction-notice-row', children: [_jsx("dt", { children: row.label }), _jsx("dd", { children: row.value })] }, `${row.label}:${rowIndex.toString()}`))) })), technicalRows.length === 0 ? undefined : (_jsx(ReadOnlyDetailAccordion, { title: commonCopy.technicalDetails, children: _jsx("dl", { className: 'global-transaction-notice-rows', children: technicalRows.map((row, rowIndex) => (_jsxs("div", { className: 'global-transaction-notice-row', children: [_jsx("dt", { children: row.label }), _jsx("dd", { children: row.value })] }, `${row.label}:${rowIndex.toString()}`))) }) })), transactionHash === undefined ? undefined : _jsx(TransactionHashLink, { hash: transactionHash })] }));
    return (_jsxs("div", { ...(noticeRef === undefined ? {} : { ref: noticeRef }), className: noticeClassName, role: transaction.tone === 'error' ? 'alert' : 'status', "aria-live": transaction.tone === 'error' ? 'assertive' : 'polite', children: [!dismissible ? undefined : (_jsx("button", { className: 'quiet global-transaction-close', type: 'button', "aria-label": transactionCopy.closeStatus, onClick: onDismiss, children: _jsx("span", { "aria-hidden": 'true', children: "\u00D7" }) })), _jsxs("div", { className: 'global-transaction-notice-copy', children: [_jsxs("div", { className: 'global-transaction-notice-header', children: [_jsx(Badge, { tone: badge.tone, children: badge.label }), transaction.tone === 'awaiting-wallet' ? _jsx("span", { className: 'spinner global-transaction-spinner', "aria-hidden": 'true' }) : undefined, _jsx("strong", { children: transaction.title })] }), compact ? (_jsxs("details", { className: 'global-transaction-compact-details', children: [_jsx("summary", { children: transactionCopy.viewTransactionDetails }), _jsx("div", { className: 'global-transaction-compact-details-content', children: transactionDetails })] })) : (transactionDetails)] }), !dismissible || compact ? undefined : (_jsx("div", { className: 'global-transaction-actions', children: _jsx("button", { className: 'secondary global-transaction-dismiss', type: 'button', onClick: onDismiss, children: transactionCopy.dismiss }) }))] }));
}
//# sourceMappingURL=TransactionPresentationNotice.js.map