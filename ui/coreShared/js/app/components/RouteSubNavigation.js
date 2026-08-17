import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { ViewTabs } from '../../components/ViewTabs.js';
import { useCallback, useRef, useState } from 'preact/hooks';
import * as appCopy from '../../copy/app.js';
export function RouteSubNavigation({ ariaLabel, onChange, options, value }) {
    const navigationRef = useRef(null);
    const [overflowEdges, setOverflowEdges] = useState({ end: false, start: false });
    const unavailableOptions = options.filter(option => option.disabled === true && option.reason !== undefined);
    const onOverflowEdgesChange = useCallback((nextOverflowEdges) => {
        const activeElement = document.activeElement;
        const focusBoundaryTab = (edge) => {
            const tabElements = navigationRef.current?.querySelectorAll('.route-subtab-nav .view-tab:not(:disabled)');
            const tabs = tabElements === undefined ? [] : Array.from(tabElements);
            const boundaryTab = edge === 'start' ? tabs[0] : tabs[tabs.length - 1];
            boundaryTab?.focus();
        };
        if (!nextOverflowEdges.start && activeElement?.classList.contains('route-subnav-overflow-start'))
            focusBoundaryTab('start');
        if (!nextOverflowEdges.end && activeElement?.classList.contains('route-subnav-overflow-end'))
            focusBoundaryTab('end');
        setOverflowEdges(nextOverflowEdges);
    }, []);
    const scrollOptions = (direction) => {
        const tabStrip = navigationRef.current?.querySelector('.route-subtab-nav');
        if (tabStrip === undefined || tabStrip === null)
            return;
        const behavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        tabStrip.scrollBy({ behavior, left: direction * Math.max(160, tabStrip.clientWidth * 0.7) });
    };
    return (_jsxs("div", { className: 'route-subnav-region', children: [_jsxs("nav", { ref: navigationRef, className: `route-subnav-shell ${overflowEdges.start ? 'has-overflow-start' : ''} ${overflowEdges.end ? 'has-overflow-end' : ''}`.trim(), "aria-label": ariaLabel, role: 'navigation', children: [_jsxs("label", { className: 'route-subnav-mobile-select', children: [_jsx("span", { children: ariaLabel }), _jsx("select", { "aria-label": ariaLabel, value: value, onChange: event => onChange(event.currentTarget.value), children: options.map(option => (_jsx("option", { value: option.value, disabled: option.disabled, children: option.label }, option.value))) })] }), overflowEdges.start ? (_jsx("button", { className: 'quiet route-subnav-overflow-control route-subnav-overflow-start', type: 'button', "aria-label": appCopy.formatShowEarlierNavigationItems(ariaLabel), onClick: () => scrollOptions(-1), children: _jsx("span", { "aria-hidden": 'true', children: "\u2039" }) })) : undefined, _jsx(ViewTabs, { ariaLabel: ariaLabel, className: 'route-subtab-nav', semantics: 'navigation', size: 'compact', value: value, variant: 'subroute', onChange: onChange, onOverflowEdgesChange: onOverflowEdgesChange, options: options }), overflowEdges.end ? (_jsx("button", { className: 'quiet route-subnav-overflow-control route-subnav-overflow-end', type: 'button', "aria-label": appCopy.formatShowLaterNavigationItems(ariaLabel), onClick: () => scrollOptions(1), children: _jsx("span", { "aria-hidden": 'true', children: "\u203A" }) })) : undefined] }), unavailableOptions.length === 0 ? undefined : (_jsx("div", { className: 'route-subnav-unavailable', children: unavailableOptions.map(option => (_jsxs("p", { className: 'detail', children: [_jsxs("strong", { children: [option.label, ":"] }), " ", option.reason] }, option.value))) }))] }));
}
//# sourceMappingURL=RouteSubNavigation.js.map