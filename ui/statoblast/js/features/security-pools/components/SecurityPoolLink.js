import { jsx as _jsx } from "preact/jsx-runtime";
import { getSecurityPoolLinkHref, navigateToSecurityPool } from '../lib/securityPoolNavigation.js';
export function SecurityPoolLink({ ariaLabel, children, className = '', securityPoolAddress, selectedPoolView, universeId }) {
    const href = getSecurityPoolLinkHref(securityPoolAddress, selectedPoolView, universeId);
    const label = children ?? securityPoolAddress;
    return (_jsx("a", { "aria-label": ariaLabel, className: `security-pool-link ${className}`, href: href, onClick: event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
            event.preventDefault();
            navigateToSecurityPool(securityPoolAddress, selectedPoolView, universeId);
        }, title: securityPoolAddress, children: label }));
}
//# sourceMappingURL=SecurityPoolLink.js.map