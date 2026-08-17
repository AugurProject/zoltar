/// <reference lib="webworker" />
import { getDeploymentSteps } from '@zoltar/ui-zoltar/protocol/deployment.js';
import { getZoltarAddress } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js';
const dependencies = {
    getDeploymentSteps,
    getZoltarAddress,
};
globalThis.zoltarSimulationEngineDependencies = dependencies;
import '@zoltar/ui-core-shared/simulation/tevmWorker.js';
//# sourceMappingURL=tevmWorker.js.map