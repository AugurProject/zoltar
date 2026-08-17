import { jsx as _jsx } from "preact/jsx-runtime";
export function DataGrid({ children, className = '', columns = 'auto', dense = false }) {
    const classes = ['data-grid', dense ? 'is-dense' : '', className].filter(Boolean).join(' ');
    return (_jsx("div", { className: classes, "data-columns": columns, children: children }));
}
//# sourceMappingURL=DataGrid.js.map