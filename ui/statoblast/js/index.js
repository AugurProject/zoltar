import { createElement } from 'preact';
import { installRouting } from '@zoltar/ui-core-shared/lib/routing.js';
import { mountApp } from '@zoltar/ui-core-shared/app/appRoot.js';
import { initializeActiveEnvironment } from '@zoltar/ui-core-shared/lib/activeEnvironment.js';
import { registerStatoblastSimulationScenarios } from './simulation/index.js';
import { App } from './app/App.js';
installRouting({
    defaultRoute: 'security-pools',
    routes: [
        { hash: '#/deploy', name: 'deploy' },
        { hash: '#/security-pools', name: 'security-pools', queryParameters: new Set(['questionId', 'securityPool', 'securityPoolsView', 'selectedPoolView']) },
        { hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(['openOracleReportId', 'openOracleView']) },
    ],
});
registerStatoblastSimulationScenarios();
void mountApp({ initialize: () => initializeActiveEnvironment(window.location, { appId: 'statoblast' }), root: () => createElement(App, {}) });
//# sourceMappingURL=index.js.map