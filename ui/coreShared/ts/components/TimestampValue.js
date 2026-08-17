import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import { LoadingText } from './LoadingText.js';
import { useChainTimestamp } from '../lib/chainTimestamp.js';
import { formatRelativeTimestamp, formatTimestamp, formatTimestampDateTime } from '../lib/formatters.js';
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js';
export function TimestampValue({ className = '', currentTimestamp, loading = false, timestamp, undefinedText = getMetricPlaceholderPresentation(undefined)?.placeholder, zeroText }) {
    const chainCurrentTimestamp = useChainTimestamp();
    const resolvedCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp;
    if (loading)
        return _jsx(LoadingText, { className: `timestamp-value loading ${className}` });
    if (timestamp === undefined)
        return _jsx("span", { className: `timestamp-value unavailable ${className}`, children: undefinedText });
    if (timestamp === 0n)
        return (_jsx("span", { className: `timestamp-value zero ${className}`, title: typeof zeroText === 'string' ? zeroText : undefined, children: zeroText ?? formatTimestamp(timestamp) }));
    const absoluteTimestamp = formatTimestamp(timestamp);
    const dateTime = formatTimestampDateTime(timestamp);
    if (dateTime === undefined)
        return (_jsx("span", { className: `timestamp-value error ${className}`, title: absoluteTimestamp, children: absoluteTimestamp }));
    const relativeTimestamp = resolvedCurrentTimestamp === undefined ? undefined : formatRelativeTimestamp(timestamp, resolvedCurrentTimestamp);
    return (_jsxs("time", { className: `timestamp-value ${className}`, dateTime: dateTime, title: absoluteTimestamp, children: [absoluteTimestamp, relativeTimestamp === undefined ? null : (_jsxs(_Fragment, { children: [' ', _jsxs("span", { className: 'timestamp-value-relative', children: ["(", relativeTimestamp, ")"] })] }))] }));
}
//# sourceMappingURL=TimestampValue.js.map