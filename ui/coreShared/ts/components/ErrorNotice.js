import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { useEffect, useState } from 'preact/hooks';
import { isCloseableErrorMessage } from '../lib/errors.js';
export function ErrorNotice({ id, message }) {
    const [dismissed, setDismissed] = useState(false);
    const isCloseable = isCloseableErrorMessage(message);
    useEffect(() => {
        setDismissed(false);
    }, [message]);
    if (message === undefined)
        return undefined;
    if (isCloseable && dismissed)
        return undefined;
    return (_jsxs("div", { id: id, className: `notice error${isCloseable ? ' closeable' : ''}`, role: 'alert', "aria-live": 'assertive', "aria-atomic": 'true', children: [isCloseable ? (_jsx("button", { type: 'button', className: 'notice-dismiss', "aria-label": commonCopy.dismissErrorActionLabel, onClick: () => setDismissed(true), children: _jsx("span", { className: 'notice-dismiss-icon', "aria-hidden": 'true' }) })) : undefined, _jsx("p", { children: message })] }));
}
//# sourceMappingURL=ErrorNotice.js.map