import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as appCopy from '../../copy/app.js';
import { SimulationBanner } from '../../components/SimulationBanner.js';
import { TabNavigation } from '../../components/TabNavigation.js';
export function AppHeaderShell({ overview, simulationController, subNavigation, tabNavigation, onEnvironmentChanged = async () => undefined, onRefresh }) {
    const focusAppContent = () => {
        const appContent = document.getElementById('app-content');
        if (appContent instanceof HTMLElement)
            appContent.focus();
    };
    return (_jsxs(_Fragment, { children: [_jsx("button", { className: 'skip-link', type: 'button', onClick: focusAppContent, children: appCopy.skipToMainContent }), simulationController === undefined ? undefined : _jsx(SimulationBanner, { controller: simulationController, onEnvironmentChanged: onEnvironmentChanged, onRefresh: onRefresh }), _jsxs("div", { className: 'top-shell', children: [_jsx("div", { className: 'top-shell-content', children: overview }), _jsxs("div", { className: 'app-nav-stack', children: [_jsx(TabNavigation, { ...tabNavigation }), subNavigation] })] })] }));
}
//# sourceMappingURL=AppHeaderShell.js.map