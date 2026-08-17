import { jsx as _jsx } from "preact/jsx-runtime";
import { useEffect, useRef, useState } from 'preact/hooks';
import { TransactionPresentationNotice } from '../../components/TransactionPresentationNotice.js';
const dismissedKeys = new Set();
const MAX_REMEMBERED_DISMISSALS = 100;
function getTransactionKey(transaction) {
    return transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash;
}
function getDismissalTransactionKey(transaction) {
    const dismissKey = transaction?.dismissKey;
    if (dismissKey !== undefined && !dismissKey.startsWith('transaction-request-'))
        return dismissKey;
    return transaction?.hash ?? dismissKey ?? transaction?.operationKey;
}
function getDismissKey(transaction) {
    const transactionKey = getDismissalTransactionKey(transaction);
    if (transactionKey === undefined || transaction === undefined)
        return undefined;
    return `${transaction.tone}:${transactionKey}`;
}
function shouldRememberDismissal(transaction) {
    const transactionKey = getDismissalTransactionKey(transaction);
    return transactionKey !== undefined && !transactionKey.startsWith('transaction-request-');
}
function rememberDismissal(dismissKey) {
    if (dismissedKeys.size >= MAX_REMEMBERED_DISMISSALS) {
        const oldestDismissedKey = dismissedKeys.values().next().value;
        if (oldestDismissedKey !== undefined)
            dismissedKeys.delete(oldestDismissedKey);
    }
    dismissedKeys.add(dismissKey);
}
export function GlobalTransactionTray({ routeKey, transaction }) {
    const [dismissedKey, setDismissedKey] = useState(() => {
        const transactionDismissKey = getDismissKey(transaction);
        if (transactionDismissKey === undefined || !dismissedKeys.has(transactionDismissKey))
            return undefined;
        return transactionDismissKey;
    });
    const dismissKeyRef = useRef(getDismissKey(transaction));
    const transactionOriginRef = useRef({ routeKey, transactionKey: getTransactionKey(transaction) });
    const noticeRef = useRef(null);
    useEffect(() => {
        const nextDismissKey = getDismissKey(transaction);
        if (nextDismissKey === dismissKeyRef.current)
            return;
        dismissKeyRef.current = nextDismissKey;
        if (nextDismissKey === undefined || !dismissedKeys.has(nextDismissKey)) {
            setDismissedKey(undefined);
            return;
        }
        setDismissedKey(nextDismissKey);
    }, [transaction]);
    useEffect(() => {
        const notice = noticeRef.current;
        if (notice === null)
            return;
        const main = notice.closest('main');
        if (!(main instanceof HTMLElement) || transaction === undefined)
            return;
        const updateReservedSpace = () => {
            const trayHeight = `${notice.getBoundingClientRect().height.toString()}px`;
            main.style.setProperty('--global-transaction-tray-height', trayHeight);
            document.documentElement.style.scrollPaddingBottom = `calc(${trayHeight} + 2rem + env(safe-area-inset-bottom, 0rem))`;
        };
        main.classList.add('global-transaction-tray-open');
        updateReservedSpace();
        const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateReservedSpace);
        resizeObserver?.observe(notice);
        return () => {
            resizeObserver?.disconnect();
            main.classList.remove('global-transaction-tray-open');
            main.style.removeProperty('--global-transaction-tray-height');
            document.documentElement.style.removeProperty('scroll-padding-bottom');
        };
    }, [transaction, dismissedKey]);
    if (transaction === undefined)
        return undefined;
    const transactionDismissKey = getDismissKey(transaction);
    const transactionKey = getTransactionKey(transaction);
    if (transactionOriginRef.current.transactionKey !== transactionKey)
        transactionOriginRef.current = { routeKey, transactionKey };
    if (transactionDismissKey !== undefined && transactionDismissKey === dismissedKey)
        return undefined;
    const canDismiss = transaction.tone !== 'awaiting-wallet' && transaction.tone !== 'pending' && transaction.tone !== 'preparing' && transactionDismissKey !== undefined;
    const compact = canDismiss && routeKey !== undefined && transactionOriginRef.current.routeKey !== undefined && routeKey !== transactionOriginRef.current.routeKey;
    const dismiss = () => {
        if (transactionDismissKey === undefined)
            return;
        if (shouldRememberDismissal(transaction))
            rememberDismissal(transactionDismissKey);
        setDismissedKey(transactionDismissKey);
    };
    return (_jsx("div", { className: 'global-transaction-tray', children: _jsx(TransactionPresentationNotice, { compact: compact, dismissible: canDismiss, noticeRef: noticeRef, onDismiss: dismiss, transaction: transaction }) }));
}
//# sourceMappingURL=GlobalTransactionTray.js.map