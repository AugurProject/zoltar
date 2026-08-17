import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import * as pricingCopy from '../copy/pricing.js';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { LoadingText } from './LoadingText.js';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard.js';
import { formatCompactCurrencyBalance, formatCurrencyBalance, formatRoundedCurrencyBalance } from '../lib/formatters.js';
import { getMetricPlaceholderPresentation } from '../lib/userCopy.js';
import { CopyErrorMessage } from './CopyErrorMessage.js';
export function CurrencyValue({ className = '', compactWhenOverflow = false, copyable = true, decimals = 2, loading = false, precision = 'rounded', suffix = '', units = 18, value }) {
    const buttonRef = useRef(null);
    const spanRef = useRef(null);
    const measureRef = useRef(null);
    const [shouldCompact, setShouldCompact] = useState(false);
    const exactValue = value === undefined ? undefined : formatCurrencyBalance(value, units);
    const { copied, copyError, copyErrorId, copyText } = useCopyToClipboard(exactValue);
    const copiedValue = copied.value;
    const exactSuffix = suffix === '' ? '' : ` ${suffix}`;
    let displayValue;
    let compactDisplayValue;
    if (value !== undefined && exactValue !== undefined) {
        if (precision === 'exact') {
            displayValue = `${exactValue}${exactSuffix}`;
            compactDisplayValue = displayValue;
        }
        else {
            displayValue = `≈ ${formatRoundedCurrencyBalance(value, units, decimals)}${exactSuffix}`;
            compactDisplayValue = `≈ ${formatCompactCurrencyBalance(value, units)}${exactSuffix}`;
        }
    }
    useLayoutEffect(() => {
        if (!compactWhenOverflow || value === undefined || displayValue === undefined) {
            setShouldCompact(false);
            return;
        }
        const element = buttonRef.current ?? spanRef.current;
        const measureElement = measureRef.current;
        if (element === null || measureElement === null) {
            setShouldCompact(false);
            return;
        }
        const updateCompaction = () => {
            if (copied.value)
                return;
            measureElement.textContent = displayValue;
            const shouldUseCompactValue = measureElement.getBoundingClientRect().width > element.clientWidth + 1;
            measureElement.textContent = '';
            setShouldCompact(shouldUseCompactValue);
        };
        updateCompaction();
        if (typeof ResizeObserver === 'undefined')
            return;
        const observer = new ResizeObserver(() => {
            updateCompaction();
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, [compactWhenOverflow, copiedValue, displayValue, value]);
    if (loading)
        return _jsx(LoadingText, { className: `currency-value loading ${className}`, children: commonCopy.loadingWithEllipsis });
    if (value === undefined || exactValue === undefined || displayValue === undefined || compactDisplayValue === undefined)
        return _jsx("span", { className: `currency-value unavailable ${className}`, children: getMetricPlaceholderPresentation(value)?.placeholder });
    const resolvedDisplayValue = compactWhenOverflow && shouldCompact && !copiedValue ? compactDisplayValue : displayValue;
    const exactTitle = `${exactValue}${exactSuffix}`;
    const valueClassName = `currency-value${copyable ? ' copyable' : ''} ${className}`;
    const measureClassName = `currency-value currency-value-measure ${className}`;
    if (!copyable)
        return (_jsxs("span", { className: 'currency-value-wrap', children: [_jsx("span", { ref: spanRef, className: valueClassName, title: exactTitle, children: resolvedDisplayValue }), _jsx("span", { ref: measureRef, "aria-hidden": 'true', className: measureClassName })] }));
    return (_jsxs("span", { className: 'currency-value-wrap', children: [_jsx("button", { ref: buttonRef, type: 'button', className: valueClassName, title: exactTitle, "aria-label": pricingCopy.formatCopyExactCurrencyValue(exactValue), "aria-describedby": copyError.value === undefined ? undefined : copyErrorId, onClick: () => copyText(exactValue), children: copiedValue ? commonCopy.copied : resolvedDisplayValue }), _jsx(CopyErrorMessage, { id: copyErrorId, manualValue: exactValue, message: copyError.value }), _jsx("span", { ref: measureRef, "aria-hidden": 'true', className: measureClassName })] }));
}
//# sourceMappingURL=CurrencyValue.js.map