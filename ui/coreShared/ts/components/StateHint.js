import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { LoadingAwareText, LoadingText } from './LoadingText.js';
export function StateHint({ actions, announcement, className = '', id, presentation, title }) {
    const hasVisibleCopy = title !== undefined || presentation.detail !== undefined || presentation.actionHint !== undefined || actions !== undefined;
    const fallbackTitle = hasVisibleCopy ? undefined : presentation.badgeLabel;
    let announcementRole;
    if (announcement === 'assertive')
        announcementRole = 'alert';
    if (announcement === 'polite')
        announcementRole = 'status';
    return (_jsxs("div", { id: id, "aria-atomic": announcement === undefined ? undefined : 'true', "aria-live": announcement, className: `state-hint ${className}`.trim(), role: announcementRole, children: [title === undefined ? undefined : _jsx("h3", { children: title }), fallbackTitle === undefined ? undefined : _jsx("h3", { children: fallbackTitle }), presentation.detail === undefined ? undefined : _jsx("p", { className: 'detail', children: presentation.detailIsLoading ? _jsx(LoadingText, { children: presentation.detail }) : _jsx(LoadingAwareText, { children: presentation.detail }) }), presentation.actionHint === undefined ? undefined : (_jsx("p", { className: 'detail', children: _jsx(LoadingAwareText, { children: presentation.actionHint }) })), actions === undefined ? undefined : _jsx("div", { className: 'actions state-hint-actions', children: actions })] }));
}
//# sourceMappingURL=StateHint.js.map