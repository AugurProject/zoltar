import { jsx as _jsx } from "preact/jsx-runtime";
import { DataGrid } from './DataGrid.js';
function getMetricGridVariantClassName(variant = 'default') {
    switch (variant) {
        case 'context':
            return 'selected-pool-context-grid';
        case 'default':
            return 'workflow-metric-grid';
        case 'question':
            return 'question-summary-grid';
        case 'summary':
            return 'overview-summary-grid';
        case 'vault':
            return 'workflow-vault-grid';
        default:
            return 'workflow-metric-grid';
    }
}
export function MetricGrid({ children, className = '', columns = 'auto', dense = false, variant = 'default' }) {
    const classes = [getMetricGridVariantClassName(variant), className].filter(Boolean).join(' ');
    return (_jsx(DataGrid, { className: classes, columns: columns, dense: dense, children: children }));
}
//# sourceMappingURL=MetricGrid.js.map