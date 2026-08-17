import { jsx as _jsx } from "preact/jsx-runtime";
export function OutcomeChipRow({ className = '', items }) {
    return (_jsx("div", { className: ['outcome-chip-row', className].filter(Boolean).join(' '), children: items.map(item => (_jsx("span", { className: ['outcome-chip', `tone-${item.tone ?? 'default'}`].join(' '), children: item.label }, item.key))) }));
}
//# sourceMappingURL=OutcomeChipRow.js.map