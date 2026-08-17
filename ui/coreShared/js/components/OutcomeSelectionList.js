import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
export function OutcomeSelectionList({ className = '', emptyMessage, items }) {
    if (items.length === 0)
        return emptyMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: emptyMessage });
    return (_jsx("div", { className: ['migration-outcome-list', className].filter(Boolean).join(' '), children: items.map(item => (_jsx("button", { "aria-pressed": item.selected, className: `migration-outcome-row ${item.selected ? 'active' : ''}`, disabled: item.disabled, onClick: item.onSelect, type: 'button', children: _jsxs("span", { className: 'migration-outcome-copy', children: [_jsx("span", { className: 'migration-outcome-label', children: item.label }), item.details === undefined ? undefined : _jsx("span", { className: 'migration-outcome-metrics', children: item.details })] }) }, item.key))) }));
}
//# sourceMappingURL=OutcomeSelectionList.js.map