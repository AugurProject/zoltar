import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { useId } from 'preact/hooks';
import { FormInput } from './FormInput.js';
export function LookupFieldRow({ action, disabled = false, inputClassName = '', inputMode, invalid = false, label, onInput, placeholder, resolvedValue, resolvedValueLabel, value }) {
    const inputId = useId();
    return (_jsxs("div", { className: 'field lookup-field-row', children: [_jsx("label", { className: 'lookup-field-label', for: inputId, children: label }), _jsxs("div", { className: `lookup-field-controls ${action === undefined ? '' : 'has-action'}`.trim(), children: [_jsx(FormInput, { id: inputId, className: inputClassName, value: value, inputMode: inputMode, invalid: invalid, disabled: disabled, onInput: event => onInput(event.currentTarget.value), placeholder: placeholder }), action === undefined ? undefined : _jsx("div", { className: 'actions', children: action })] }), resolvedValue === undefined ? undefined : (_jsxs("div", { className: 'lookup-field-resolved-value', children: [resolvedValueLabel === undefined ? undefined : _jsx("span", { className: 'lookup-field-resolved-label', children: resolvedValueLabel }), resolvedValue] }))] }));
}
//# sourceMappingURL=LookupFieldRow.js.map