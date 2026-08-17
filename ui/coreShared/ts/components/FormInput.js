import { jsx as _jsx } from "preact/jsx-runtime";
export function FormInput({ className = '', invalid = false, ...props }) {
    const nextClassName = ['form-input', invalid ? 'is-invalid' : '', className].filter(Boolean).join(' ');
    return _jsx("input", { ...props, "aria-invalid": invalid ? 'true' : undefined, className: nextClassName });
}
//# sourceMappingURL=FormInput.js.map