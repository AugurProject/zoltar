/// <reference lib="webworker" />
import { getDeploymentSteps } from '../protocol/deployment.js';
import { getZoltarAddress } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js';
import { applyStatoblastScenario } from './statoblastScenarios.js';
const dependencies = {
    applyScenario: applyStatoblastScenario,
    getDeploymentSteps,
    getZoltarAddress,
};
globalThis.zoltarSimulationEngineDependencies = dependencies;
import '@zoltar/ui-core-shared/simulation/tevmWorker.js';
//# sourceMappingURL=tevmWorker.js.map