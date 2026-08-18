/// <reference lib="webworker" />
import { getDeploymentSteps } from '../protocol/deployment.js';
import { getZoltarAddress } from '../protocol/deploymentHelpers.js';
const dependencies = {
    getDeploymentSteps,
    getZoltarAddress,
};
globalThis.zoltarSimulationEngineDependencies = dependencies;
import '@zoltar/ui-core-shared/simulation/tevmWorker.js';
//# sourceMappingURL=tevmWorker.js.map