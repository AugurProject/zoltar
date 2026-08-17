import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { CopyErrorMessage } from './CopyErrorMessage.js';
export function IdentifierValue({ className = '', value }) {
    const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(value);
    const classes = ['identifier-value', 'copyable', className].filter(Boolean).join(' ');
    return (_jsxs("span", { className: 'copy-value-wrap', children: [_jsx("button", { className: classes, type: 'button', title: value, "aria-label": commonCopy.formatCopyIdentifierValue(value), "aria-describedby": copyError.value === undefined ? undefined : copyErrorId, onClick: () => copyText(value), children: copied.value ? commonCopy.copied : value }), _jsx(CopyErrorMessage, { id: copyErrorId, manualValue: value, message: copyError.value })] }));
}
//# sourceMappingURL=IdentifierValue.js.map