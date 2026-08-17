import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { ActionLauncherButton } from './ActionLauncherButton.js';
export function ActionLauncherCard({ action, children, pending = false, pendingLabel = commonCopy.opening, tone = 'secondary' }) {
    if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked')
        return undefined;
    const disabled = action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined;
    const showTitle = action.title.trim().toLowerCase() !== action.actionLabel.trim().toLowerCase();
    const showCopy = action.description !== undefined || showTitle || children !== undefined;
    return (_jsxs("section", { className: `action-launcher-card ${action.readiness} ${showCopy ? '' : 'compact'}`.trim(), children: [showCopy ? (_jsxs("div", { className: 'action-launcher-card-copy', children: [showTitle ? _jsx("h4", { children: action.title }) : undefined, action.description === undefined ? undefined : _jsx("p", { className: 'detail', children: action.description }), children] })) : undefined, _jsx("div", { className: 'action-launcher-card-actions', children: _jsx(ActionLauncherButton, { ...(action.disabledReasonId === undefined ? {} : { describedBy: action.disabledReasonId }), idleLabel: action.actionLabel, pendingLabel: pendingLabel, onClick: () => action.onAction?.(), pending: pending, tone: tone, availability: { disabled, reason: action.blocker }, showDisabledReason: true }) })] }));
}
//# sourceMappingURL=ActionLauncherCard.js.map