import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
export function ReadOnlyDetailAccordion({ children, defaultOpen = false, title }) {
    return (_jsxs("details", { className: 'read-only-detail-accordion', open: defaultOpen, children: [_jsx("summary", { children: title }), _jsx("div", { className: 'read-only-detail-accordion-content', children: children })] }));
}
//# sourceMappingURL=ReadOnlyDetailAccordion.js.map