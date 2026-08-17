import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { clampVisualRatio, getVisualRatio, takeTopRankedItems } from '../lib/visualMetrics.js';
export function RankedBarList({ className = '', emptyMessage = commonCopy.emptyStateDetail, items }) {
    if (items.length === 0)
        return _jsx("p", { className: ['ranked-bar-list-empty', className].filter(Boolean).join(' '), children: emptyMessage });
    const rankedItems = takeTopRankedItems({ items, limit: items.length });
    const maxValue = rankedItems.reduce((currentMax, item) => {
        if (item.value === undefined)
            return currentMax;
        if (currentMax === undefined || item.value > currentMax)
            return item.value;
        return currentMax;
    }, undefined);
    return (_jsx("div", { className: ['ranked-bar-list', className].filter(Boolean).join(' '), children: rankedItems.map(item => (_jsxs("div", { className: ['ranked-bar-item', `tone-${item.tone ?? 'default'}`].join(' '), children: [_jsxs("div", { className: 'ranked-bar-item-header', children: [_jsx("span", { className: 'ranked-bar-item-label', children: item.label }), _jsx("strong", { className: 'ranked-bar-item-value', children: item.valueText })] }), _jsx("div", { className: 'ranked-bar-item-track', "aria-hidden": 'true', children: _jsx("div", { className: 'ranked-bar-item-fill', style: { width: `${(clampVisualRatio(getVisualRatio({ value: item.value, maxValue })) * 100).toFixed(2)}%` } }) }), item.detail === undefined ? undefined : _jsx("p", { className: 'ranked-bar-item-detail', children: item.detail })] }, item.key))) }));
}
//# sourceMappingURL=RankedBarList.js.map