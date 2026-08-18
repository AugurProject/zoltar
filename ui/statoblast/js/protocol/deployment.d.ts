import type { NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js';
import type { DeploymentStatusSnapshot, DeploymentStep, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js';
import { getDeploymentSteps as getZoltarDeploymentSteps } from '@zoltar/ui-zoltar/protocol/deployment.js';
export { loadErc20Allowance, loadErc20Balance } from '@zoltar/ui-zoltar/protocol/deployment.js';
export declare function getDeploymentSteps(profile?: NetworkProfile, wait?: Parameters<typeof getZoltarDeploymentSteps>[1]): DeploymentStep[];
export declare function loadDeploymentStatusOracleSnapshot(client: Pick<ReadClient, 'readContract' | 'getCode'>): Promise<DeploymentStatusSnapshot>;
//# sourceMappingURL=deployment.d.ts.map