import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { LoadingAwareText } from './LoadingText.js';
export function MetricField({ children, className = '', label, valueClassName = '', valueTagName = 'strong' }) {
    const ValueTag = valueTagName;
    const resolvedValueClassName = ['metric-field-value', valueClassName].filter(value => value !== '').join(' ');
    return (_jsxs("div", { className: className === '' ? undefined : className, children: [_jsx("span", { className: 'metric-label', children: label }), _jsx(ValueTag, { className: resolvedValueClassName, children: _jsx(LoadingAwareText, { children: children }) })] }));
}
//# sourceMappingURL=MetricField.js.map