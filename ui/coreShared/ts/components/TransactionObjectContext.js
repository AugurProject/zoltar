import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { useId } from 'preact/hooks';
export function TransactionObjectContext({ className = '', items, title }) {
    const titleId = useId();
    if (items.length === 0)
        return undefined;
    return (_jsxs("section", { className: `transaction-object-context ${className}`.trim(), ...(title === undefined ? {} : { 'aria-labelledby': titleId }), children: [title === undefined ? undefined : _jsx("strong", { id: titleId, children: title }), _jsx("dl", { children: items.map((item, index) => (_jsxs("div", { children: [_jsx("dt", { children: item.label }), _jsx("dd", { children: item.value })] }, `${index}`))) })] }));
}
//# sourceMappingURL=TransactionObjectContext.js.map