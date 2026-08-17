import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { createContext } from 'preact';
import { useContext, useId } from 'preact/hooks';
import { LoadingAwareText, LoadingText } from './LoadingText.js';
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js';
const TransactionActionButtonLockContext = createContext(undefined);
export function TransactionActionButtonLockProvider({ children, disabledReason }) {
    return _jsx(TransactionActionButtonLockContext.Provider, { value: disabledReason, children: children });
}
export function TransactionActionButton({ ariaLabel, availability, className = '', disabled = false, disabledReasonElementId, idleLabel, onClick, pending = false, pendingLabel, showDisabledReason = true, tone = 'primary', type = 'button' }) {
    const disabledReasonId = useId();
    const globalTransaction = useGlobalTransactionPresentation();
    const globalDisabledReason = useContext(TransactionActionButtonLockContext);
    const blockedByPendingRequest = globalDisabledReason !== undefined && !pending;
    const isDisabled = disabled || pending || availability?.disabled === true || blockedByPendingRequest;
    const disabledReason = isDisabled ? (availability?.reason ?? (blockedByPendingRequest ? globalDisabledReason : undefined)) : undefined;
    const shouldShowDisabledReason = showDisabledReason && isDisabled && disabledReason !== undefined;
    let describedBy;
    if (shouldShowDisabledReason)
        describedBy = disabledReasonId;
    else if (isDisabled && disabledReason !== undefined)
        describedBy = disabledReasonElementId;
    const handleClick = () => {
        if (isDisabled)
            return;
        onClick();
    };
    return (_jsxs("div", { className: `tx-action ${className}`.trim(), children: [_jsx("button", { "aria-label": ariaLabel, className: `tx-action-button ${tone}`, type: type, onClick: handleClick, disabled: isDisabled, title: disabledReason, "aria-describedby": describedBy, children: pending ? _jsx(LoadingText, { announce: !isPendingGlobalTransactionPresentation(globalTransaction), children: pendingLabel }) : idleLabel }), shouldShowDisabledReason ? (_jsx("p", { id: disabledReasonId, className: 'detail disabled-reason', children: _jsx(LoadingAwareText, { children: disabledReason }) })) : undefined] }));
}
//# sourceMappingURL=TransactionActionButton.js.map