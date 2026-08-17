import type { Address, Hash } from '@zoltar/shared/ethereum';
import type { WriteOperationsParameters } from '../../../types/app.js';
import type { DeploymentStatus, DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js';
import { type RpcStateRetryWait } from '../../../protocol/core.js';
type UseDeploymentFlowParameters = {
    accountAddress: Address | undefined;
    deploymentStatuses: DeploymentStatus[];
    onTransactionFailed?: WriteOperationsParameters['onTransactionFailed'];
    setDeploymentStatuses: (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => void;
    onTransactionFinished: () => void;
    onTransactionPresented: WriteOperationsParameters['onTransactionPresented'];
    onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
    onTransactionRequested: WriteOperationsParameters['onTransactionRequested'];
    onTransactionSubmitted: (hash: Hash) => void;
    rpcStateRetryWait?: RpcStateRetryWait;
};
export declare function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, rpcStateRetryWait, setDeploymentStatuses }: UseDeploymentFlowParameters): {
    busyStepId: any;
    deploymentFeedback: any;
    deployNextMissing: () => Promise<void>;
    deployStep: (stepId: DeploymentStepId, feedbackAction?: DeploymentStepId | "deployNextMissing") => Promise<void>;
    errorMessage: string | undefined;
};
export {};
//# sourceMappingURL=useDeploymentFlow.d.ts.map