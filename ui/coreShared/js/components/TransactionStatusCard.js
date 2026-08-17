import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { EntityCard } from './EntityCard.js';
export function TransactionStatusCard({ actions, badge, className = '', detail, metrics, secondaryDetail, surface = 'card', title }) {
    return (_jsxs(EntityCard, { actions: actions, badge: badge, className: `transaction-status-card ${className}`.trim(), surface: surface, title: title, variant: 'compact', children: [detail === undefined ? undefined : _jsx("p", { className: 'detail', children: detail }), secondaryDetail === undefined ? undefined : _jsx("p", { className: 'detail', children: secondaryDetail }), metrics] }));
}
//# sourceMappingURL=TransactionStatusCard.js.map