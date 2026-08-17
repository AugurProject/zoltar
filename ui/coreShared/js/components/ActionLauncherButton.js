import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { LoadingAwareText, LoadingText } from './LoadingText.js';
import { isPendingGlobalTransactionPresentation, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js';
import { useId } from 'preact/hooks';
export function ActionLauncherButton({ availability, className = '', describedBy, disabled = false, idleLabel, onClick, pending = false, pendingLabel, showDisabledReason = false, tone = 'primary', type = 'button' }) {
    const disabledReasonId = useId();
    const globalTransaction = useGlobalTransactionPresentation();
    const isDisabled = disabled || pending || availability?.disabled === true;
    const disabledReason = isDisabled ? availability?.reason : undefined;
    const rendersDisabledReason = showDisabledReason && disabledReason !== undefined;
    const descriptionIds = [describedBy, rendersDisabledReason ? disabledReasonId : undefined].filter(value => value !== undefined).join(' ') || undefined;
    return (_jsxs("div", { className: `tx-action ${className}`.trim(), children: [_jsx("button", { "aria-describedby": descriptionIds, className: `tx-action-button ${tone}`, type: type, onClick: onClick, disabled: isDisabled, title: disabledReason, children: pending ? _jsx(LoadingText, { announce: !isPendingGlobalTransactionPresentation(globalTransaction), children: pendingLabel }) : idleLabel }), (() => {
                if (showDisabledReason && disabledReason === undefined)
                    return undefined;
                if (showDisabledReason && isDisabled)
                    return (_jsx("p", { className: 'detail disabled-reason', id: disabledReasonId, children: _jsx(LoadingAwareText, { children: disabledReason }) }));
                return undefined;
            })()] }));
}
//# sourceMappingURL=ActionLauncherButton.js.map