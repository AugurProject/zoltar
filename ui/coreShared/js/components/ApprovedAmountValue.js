import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { CurrencyValue } from './CurrencyValue.js';
export const APPROVAL_MAX_DISPLAY_THRESHOLD = (1n << 200n) - 1n;
export function isApprovalAmountMaxDisplay(value) {
    return value !== undefined && value > APPROVAL_MAX_DISPLAY_THRESHOLD;
}
export function getApprovedAmountTone(value, requiredAmount) {
    if (value === undefined || requiredAmount === undefined)
        return undefined;
    return value >= requiredAmount ? 'sufficient' : 'insufficient';
}
export function ApprovedAmountValue({ className = '', copyable = true, decimals = 2, loading = false, requiredAmount, suffix = '', units = 18, value }) {
    const toneClassName = getApprovedAmountTone(value, requiredAmount);
    if (isApprovalAmountMaxDisplay(value))
        return (_jsx("span", { className: ['currency-value', 'approval-max', toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' '), title: commonCopy.unlimitedApproval, children: commonCopy.max }));
    return _jsx(CurrencyValue, { className: [toneClassName === undefined ? '' : `approval-${toneClassName}`, className].filter(Boolean).join(' '), copyable: copyable, decimals: decimals, loading: loading, suffix: suffix, units: units, value: value });
}
//# sourceMappingURL=ApprovedAmountValue.js.map