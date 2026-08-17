import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
function getSectionBlockHeadingTag(headingLevel) {
    if (headingLevel === 2)
        return 'h2';
    if (headingLevel === 4)
        return 'h4';
    return 'h3';
}
export function SectionBlock({ actions, badge, children, className = '', description, density = 'balanced', headingLevel = 3, title, tone = 'default', variant = 'default' }) {
    const HeadingTag = getSectionBlockHeadingTag(headingLevel);
    const classes = ['section-block', `tone-${tone}`, `density-${density}`, variant, className].filter(Boolean).join(' ');
    return (_jsxs("section", { className: classes, children: [title === undefined && badge === undefined && actions === undefined && description === undefined ? undefined : (_jsxs("div", { className: 'section-block-header', children: [_jsxs("div", { className: 'section-block-copy', children: [_jsx("div", { className: 'section-block-title-row', children: title === undefined ? undefined : _jsx(HeadingTag, { children: title }) }), description === undefined ? undefined : _jsx("p", { className: 'detail', children: description })] }), badge === undefined ? undefined : _jsx("div", { className: 'section-block-badge', children: badge }), actions === undefined ? undefined : _jsx("div", { className: 'section-block-actions', children: actions })] })), _jsx("div", { className: 'section-block-body', children: children })] }));
}
//# sourceMappingURL=SectionBlock.js.map