import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { useEffect, useId, useRef } from 'preact/hooks';
import { useModalFocusIsolation } from '../hooks/useModalFocusIsolation.js';
import { useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js';
import { TransactionPresentationNotice } from './TransactionPresentationNotice.js';
import { TransactionObjectContext } from './TransactionObjectContext.js';
function getTransactionOperationKey(transaction) {
    return transaction?.operationKey ?? transaction?.dismissKey ?? transaction?.hash;
}
function getModalTransactionPresentation(transaction, context) {
    if (transaction === undefined)
        return undefined;
    const contextIdentityKeys = new Set(context.flatMap(item => (item.identityKey === undefined ? [] : [item.identityKey])));
    const contextLabels = new Set(context.flatMap(item => (typeof item.label === 'string' ? [item.label] : [])));
    const { technicalRows: _technicalRows, ...modalTransaction } = transaction;
    if (transaction.rows === undefined)
        return modalTransaction;
    return {
        ...modalTransaction,
        rows: transaction.rows.filter(row => (row.identityKey === undefined || !contextIdentityKeys.has(row.identityKey)) && !contextLabels.has(row.label)),
    };
}
export function OperationModal({ children, closeDisabled = false, closeOnSuccessKey, context = [], description, isOpen, onClose, title }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const activeTransaction = useGlobalTransactionPresentation();
    const activeTransactionOperationKey = getTransactionOperationKey(activeTransaction);
    const modalTransaction = getModalTransactionPresentation(activeTransaction, context);
    const titleId = useId();
    const descriptionElementId = useId();
    const descriptionId = description === undefined ? undefined : descriptionElementId;
    const modalOperationKeysRef = useRef(new Set());
    const transactionOperationKeyAtOpenRef = useRef();
    const wasOpenRef = useRef(false);
    const requestClose = () => {
        if (!closeDisabled)
            onClose();
    };
    useEffect(() => {
        if (!isOpen) {
            wasOpenRef.current = false;
            modalOperationKeysRef.current = new Set();
            return;
        }
        if (!wasOpenRef.current) {
            wasOpenRef.current = true;
            modalOperationKeysRef.current = new Set();
            transactionOperationKeyAtOpenRef.current = activeTransactionOperationKey;
            return;
        }
        if (activeTransactionOperationKey !== undefined && activeTransactionOperationKey !== transactionOperationKeyAtOpenRef.current) {
            modalOperationKeysRef.current.add(activeTransactionOperationKey);
        }
        const submittedActionSucceeded = activeTransaction?.tone === 'success' && activeTransaction.hash !== undefined && activeTransaction.hash === closeOnSuccessKey && activeTransactionOperationKey !== undefined && modalOperationKeysRef.current.has(activeTransactionOperationKey);
        if (submittedActionSucceeded)
            onClose();
    }, [activeTransaction?.hash, activeTransaction?.tone, activeTransactionOperationKey, closeOnSuccessKey, isOpen, onClose]);
    useModalFocusIsolation({
        dialogRef,
        initialFocusRef: closeButtonRef,
        isOpen,
        onClose: requestClose,
    });
    if (!isOpen)
        return undefined;
    return (_jsx("div", { className: 'modal-backdrop', role: 'presentation', onClick: requestClose, children: _jsxs("section", { ref: dialogRef, className: 'modal-panel operation-modal-panel', role: 'dialog', tabIndex: -1, "aria-busy": closeDisabled || undefined, "aria-modal": 'true', "aria-labelledby": titleId, "aria-describedby": descriptionId, onClick: event => event.stopPropagation(), children: [_jsxs("div", { className: 'modal-header', children: [_jsx("div", { className: 'modal-header-title', children: _jsx("h3", { id: titleId, children: title }) }), _jsx("button", { ref: closeButtonRef, className: 'quiet modal-close-button', type: 'button', "aria-label": commonCopy.close, title: commonCopy.close, disabled: closeDisabled, onClick: requestClose, children: "\u00D7" })] }), description === undefined ? undefined : (_jsx("p", { id: descriptionId, className: 'detail', children: description })), _jsx(TransactionObjectContext, { items: context }), !wasOpenRef.current || modalTransaction === undefined || activeTransactionOperationKey === undefined || activeTransactionOperationKey === transactionOperationKeyAtOpenRef.current ? undefined : _jsx(TransactionPresentationNotice, { className: 'operation-modal-transaction-notice', transaction: modalTransaction }), _jsx("div", { className: 'operation-modal-body', children: children })] }) }));
}
//# sourceMappingURL=OperationModal.js.map