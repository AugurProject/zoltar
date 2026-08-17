import { jsxs as _jsxs, jsx as _jsx } from "preact/jsx-runtime";
export function RequirementsChecklist({ items }) {
    const blockedItems = items.filter(item => !item.resolved);
    if (blockedItems.length === 0)
        return null;
    return (_jsx("ul", { className: 'requirements-checklist', children: blockedItems.map(item => (_jsxs("li", { className: 'blocked', children: [item.label, item.detail === undefined ? undefined : _jsxs("span", { children: [" ", item.detail] })] }, item.key))) }));
}
//# sourceMappingURL=RequirementsChecklist.js.map