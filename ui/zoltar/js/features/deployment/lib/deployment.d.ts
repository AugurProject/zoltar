import type { ActionAvailability } from '../../types.js';
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js';
type DeploymentStepAvailabilityState = Pick<DeploymentStatus, 'id' | 'deployed' | 'dependencies' | 'label'>;
export declare function getPrerequisiteLabel(steps: DeploymentStatus[], index: number): any;
export declare function findNextDeployableStep(steps: DeploymentStatus[]): any;
export declare function getDeploymentStepAvailability({ accountAddress, busyStepId, isOnActiveAppChain, prerequisiteLabel, step, }: {
    accountAddress: string | undefined;
    busyStepId: DeploymentStatus['id'] | undefined;
    isOnActiveAppChain: boolean;
    prerequisiteLabel: string | undefined;
    step: DeploymentStepAvailabilityState;
}): ActionAvailability;
export declare function getDeployNextMissingAvailability({ accountAddress, busyStepId, deployNextMissingPending, isOnActiveAppChain, nextMissingStep, }: {
    accountAddress: string | undefined;
    busyStepId: DeploymentStatus['id'] | undefined;
    deployNextMissingPending: boolean;
    isOnActiveAppChain: boolean;
    nextMissingStep: Pick<DeploymentStatus, 'id' | 'label'> | undefined;
}): ActionAvailability;
export declare function getDeploymentSections(steps: DeploymentStatus[]): {
    title: string;
    steps: DeploymentStatus[];
}[];
export {};
//# sourceMappingURL=deployment.d.ts.map