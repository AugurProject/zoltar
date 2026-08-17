import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
export function isLoadingText(value) {
    return typeof value === 'string' && /^\s*loading\b/i.test(value);
}
export function LoadingText({ announce = true, children = commonCopy.loadingWithEllipsis, className = '' }) {
    return (_jsxs("span", { ...(announce ? { 'aria-live': 'polite', role: 'status' } : {}), className: `loading-value ${className}`, children: [_jsx("span", { className: 'spinner', "aria-hidden": 'true' }), children] }));
}
export function LoadingAwareText({ children }) {
    return isLoadingText(children) ? _jsx(LoadingText, { children: children }) : _jsx(_Fragment, { children: children });
}
//# sourceMappingURL=LoadingText.js.map