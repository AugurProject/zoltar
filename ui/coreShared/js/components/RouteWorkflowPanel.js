import { jsx as _jsx } from "preact/jsx-runtime";
import { SectionBlock } from './SectionBlock.js';
export function RouteWorkflowPanel({ children, className = '', description, showHeader = true, title }) {
    return (_jsx(SectionBlock, { className: ['panel', 'market-panel', className].filter(Boolean).join(' '), description: showHeader ? description : undefined, headingLevel: 2, title: showHeader ? title : undefined, variant: 'surface', children: _jsx("div", { className: 'workflow-stack route-workflow-stack', children: children }) }));
}
//# sourceMappingURL=RouteWorkflowPanel.js.map