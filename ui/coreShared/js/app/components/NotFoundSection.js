import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as appCopy from '../../copy/app.js';
import * as commonCopy from '../../copy/common.js';
import { SectionBlock } from '../../components/SectionBlock.js';
export function NotFoundSection() {
    return (_jsx(SectionBlock, { className: 'not-found-shell', title: appCopy.pageNotFoundTitle, children: _jsxs("div", { className: 'actions', children: [_jsx("a", { className: 'button-link', href: '#/deploy', children: commonCopy.deploy }), _jsx("a", { className: 'button-link secondary-link', href: '#/zoltar', children: commonCopy.zoltar }), _jsx("a", { className: 'button-link secondary-link', href: '#/security-pools', children: commonCopy.securityPools })] }) }));
}
//# sourceMappingURL=NotFoundSection.js.map