import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as appCopy from '../copy/app.js';
import { ViewTabs } from './ViewTabs.js';
import { buildRouteHref, getTopLevelRouteSearch } from '../lib/routing.js';
export function TabNavigation({ route, tabs, onRouteChange }) {
    const options = tabs.map(tab => ({
        value: tab.route,
        label: tab.label,
        href: buildRouteHref(tab.hash, getTopLevelRouteSearch(tab.route)),
        ...(tab.disabled ? { disabled: true } : {}),
        ...(tab.disabled && tab.disabledReason !== undefined ? { reason: tab.disabledReason } : {}),
    }));
    const disabledReason = tabs.find(tab => tab.disabled === true)?.disabledReason;
    const fallbackRoute = tabs[0]?.route ?? route;
    const effectiveRoute = route === 'not-found' ? fallbackRoute : route;
    return (_jsxs("nav", { className: 'tab-nav', "aria-label": appCopy.applicationSections, role: 'navigation', children: [_jsx(ViewTabs, { ariaLabel: appCopy.applicationSections, semantics: 'navigation', value: effectiveRoute, variant: 'route', onChange: value => onRouteChange(value), options: options }), _jsxs("label", { className: 'mobile-route-select', children: [_jsx("span", { children: appCopy.currentApplicationSection }), _jsx("select", { "aria-label": appCopy.currentApplicationSection, value: effectiveRoute, onChange: event => onRouteChange(event.currentTarget.value), children: options.map(option => (_jsx("option", { value: option.value, disabled: option.disabled, children: option.label }, option.value))) }), disabledReason !== undefined ? _jsx("span", { className: 'detail disabled-reason', children: disabledReason }) : undefined] }), _jsx("a", { className: 'protocol-guide-link', href: appCopy.protocolGuideHref, target: '_blank', rel: 'noreferrer', children: appCopy.protocolGuide })] }));
}
//# sourceMappingURL=TabNavigation.js.map