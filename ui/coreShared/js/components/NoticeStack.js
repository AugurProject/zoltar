import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { orderNoticeItems } from '../lib/noticeStack.js';
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js';
import { WarningSurface } from './WarningSurface.js';
export function NoticeStack({ items }) {
    if (items.length === 0)
        return undefined;
    return (_jsx("div", { className: 'page-notices', children: orderNoticeItems(items).map(item => {
            const liveRegion = item.tone === 'blocking' ? { ariaLive: 'assertive', role: 'alert' } : { ariaLive: 'polite', role: 'status' };
            const content = (_jsxs(_Fragment, { children: [item.title === undefined ? undefined : _jsx("strong", { className: 'notice-title', children: item.title }), _jsx("div", { children: item.detail }), item.technicalDetails === undefined ? undefined : _jsx(ReadOnlyDetailAccordion, { title: commonCopy.technicalDetails, children: item.technicalDetails })] }));
            return item.tone === 'warning' ? (_jsx(WarningSurface, { ariaLive: liveRegion.ariaLive, role: liveRegion.role, as: 'div', className: 'notice notice-stack-item', children: content }, item.id)) : (_jsx("div", { className: `notice notice-stack-item ${item.tone}`, role: liveRegion.role, "aria-live": liveRegion.ariaLive, children: content }, item.id));
        }) }));
}
//# sourceMappingURL=NoticeStack.js.map