import { jsx as _jsx } from "preact/jsx-runtime";
export function WarningSurface({ ariaLive, as = 'section', children, className = '', role, surface = 'card', variant = 'default' }) {
    const Tag = as;
    const classes = ['warning-surface', variant === 'compact' ? 'compact' : undefined, surface === 'flat' ? 'flat' : undefined, className].filter(Boolean).join(' ');
    return (_jsx(Tag, { className: classes, role: role, "aria-live": ariaLive, children: children }));
}
//# sourceMappingURL=WarningSurface.js.map