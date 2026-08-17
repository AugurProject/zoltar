import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { useRef, useState } from 'preact/hooks';
import * as appCopy from '../../copy/app.js';
import * as commonCopy from '../../copy/common.js';
export function ApplicationErrorNotice({ errorMessage, onRetry }) {
    const retryInProgressRef = useRef(false);
    const [retryInProgress, setRetryInProgress] = useState(false);
    const retry = async () => {
        if (retryInProgressRef.current)
            return;
        retryInProgressRef.current = true;
        setRetryInProgress(true);
        try {
            await onRetry();
        }
        finally {
            retryInProgressRef.current = false;
            setRetryInProgress(false);
        }
    };
    return (_jsx("main", { children: _jsxs("section", { className: 'notice error', role: 'alert', children: [_jsx("h1", { children: appCopy.applicationErrorTitle }), _jsx("p", { children: errorMessage }), _jsxs("div", { className: 'actions', children: [_jsx("button", { type: 'button', disabled: retryInProgress, onClick: retry, children: retryInProgress ? commonCopy.retrying : commonCopy.retry }), _jsx("button", { type: 'button', className: 'secondary', onClick: () => window.location.reload(), children: appCopy.reloadApplication })] })] }) }));
}
//# sourceMappingURL=ApplicationErrorNotice.js.map