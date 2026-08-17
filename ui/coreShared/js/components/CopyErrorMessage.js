import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
export function CopyErrorMessage({ id, manualValue, message }) {
    if (message === undefined)
        return undefined;
    return (_jsxs("span", { className: 'copy-error-recovery-wrap', children: [_jsx("span", { className: 'visually-hidden', id: id, role: 'alert', "aria-live": 'assertive', children: message }), _jsxs("details", { className: 'copy-error-recovery', children: [_jsx("summary", { children: commonCopy.copyUnavailable }), _jsxs("span", { className: 'copy-error-recovery-panel', children: [_jsx("span", { className: 'copy-error-message', children: message }), manualValue === undefined ? undefined : _jsx("input", { "aria-label": commonCopy.manualCopyValue, className: 'copy-manual-value', onFocus: event => event.currentTarget.select(), readOnly: true, type: 'text', value: manualValue })] })] })] }));
}
//# sourceMappingURL=CopyErrorMessage.js.map