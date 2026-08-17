import { jsx as _jsx } from "preact/jsx-runtime";
import { SectionBlock } from './SectionBlock.js';
export function WorkflowSubsection({ badge, children, className = '', title }) {
    return (_jsx(SectionBlock, { badge: badge, className: `workflow-subsection ${className}`.trim(), headingLevel: 4, title: title, variant: 'embedded', children: children }));
}
//# sourceMappingURL=WorkflowSubsection.js.map