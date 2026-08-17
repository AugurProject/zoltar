import { jsx as _jsx } from "preact/jsx-runtime";
export function Badge({ ariaLabel, children, className = '', title, tone = 'muted' }) {
    const classes = ['badge', tone, className].filter(Boolean).join(' ');
    return (_jsx("span", { "aria-label": ariaLabel, className: classes, title: title, children: children }));
}
//# sourceMappingURL=Badge.js.map