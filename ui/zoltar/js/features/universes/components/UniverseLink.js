import { jsx as _jsx } from "preact/jsx-runtime";
import { formatUniverseDisplayLabel, formatUniverseIdHex, formatUniverseLabel, getUniverseLinkHref, navigateToUniverse } from '../lib/universe.js';
export function UniverseLink({ children, className = '', format = 'default', universeId }) {
    const href = getUniverseLinkHref(universeId);
    const fullLabel = format === 'hex' ? formatUniverseIdHex(universeId) : formatUniverseLabel(universeId);
    const label = children ?? (format === 'hex' ? fullLabel : formatUniverseDisplayLabel(universeId));
    const accessibleLabel = children === undefined && label !== fullLabel ? fullLabel : undefined;
    return (_jsx("a", { "aria-label": accessibleLabel, className: `universe-link ${className}`, href: href, title: accessibleLabel, onClick: event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                return;
            event.preventDefault();
            navigateToUniverse(universeId);
        }, children: label }));
}
//# sourceMappingURL=UniverseLink.js.map