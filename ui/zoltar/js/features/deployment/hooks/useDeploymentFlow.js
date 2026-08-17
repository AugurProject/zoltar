import { useSignal } from '@preact/signals';
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js';
import { formatWriteErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js';
import { createDeploymentSuccessPresentation, createDeploymentTransactionIntent } from '../../transactionPresentations.js';
import { requireWallet } from '@zoltar/ui-core-shared/lib/requireWalletConnection.js';
import { assertActiveWallet } from '@zoltar/ui-core-shared/lib/assertActiveWallet.js';
import { assertDeploymentStepRuntimeCode } from '../../../protocol/deployment.js';
import { readWithRpcStateRetries } from '../../../protocol/core.js';
export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, rpcStateRetryWait, setDeploymentStatuses }) {
    const busyStepId = useSignal(undefined);
    const deploymentFeedback = useSignal(undefined);
    const errorMessage = useSignal(undefined);
    const deployStep = async (stepId, feedbackAction = stepId) => {
        if (!requireWallet(accountAddress, message => {
            const resolvedMessage = message ?? 'Connect wallet to continue.';
            errorMessage.value = resolvedMessage;
            deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', resolvedMessage);
        }, 'deploying'))
            return;
        const stepIndex = deploymentStatuses.findIndex(step => step.id === stepId);
        if (stepIndex === -1)
            return;
        const prerequisiteLabel = getPrerequisiteLabel(deploymentStatuses, stepIndex);
        if (prerequisiteLabel !== undefined) {
            const message = `Deploy ${prerequisiteLabel} first`;
            errorMessage.value = message;
            deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment blocked', message);
            return;
        }
        const step = deploymentStatuses[stepIndex];
        if (step === undefined || step.deployed)
            return;
        busyStepId.value = step.id;
        errorMessage.value = undefined;
        deploymentFeedback.value = createPendingActionFeedback(feedbackAction, `Deploying ${step.label}`);
        try {
            await assertActiveWallet(accountAddress);
            if (step.expectedRuntimeCodeHash === undefined && !step.trustedSimulationCodePresence)
                throw new Error(`Exact runtime-code verification is unavailable for ${step.label} on the active network`);
            const client = createWalletWriteClient(accountAddress, { onTransactionPrepared, onTransactionSubmitted });
            if (assertDeploymentStepRuntimeCode(step, await client.getCode({ address: step.address }))) {
                setDeploymentStatuses(current => current.map(currentStep => (currentStep.id === step.id ? { ...currentStep, deployed: true } : currentStep)));
                deploymentFeedback.value = undefined;
                return;
            }
            onTransactionRequested(createDeploymentTransactionIntent(step.label));
            const hash = await step.deploy(client);
            const code = await readWithRpcStateRetries(() => client.getCode({ address: step.address }), candidate => candidate !== undefined && candidate !== '0x', rpcStateRetryWait);
            if (!assertDeploymentStepRuntimeCode(step, code)) {
                const message = 'Deployment verification failed: no contract code was found at the expected address. Check the selected network and retry.';
                errorMessage.value = message;
                onTransactionFailed?.(message);
                deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', message);
                return;
            }
            setDeploymentStatuses(current => current.map(currentStep => (currentStep.id === step.id ? { ...currentStep, deployed: true } : currentStep)));
            deploymentFeedback.value = createSuccessActionFeedback(feedbackAction, `${step.label} deployed`, hash);
            onTransactionPresented(createDeploymentSuccessPresentation(step.label, hash));
        }
        catch (error) {
            const message = formatWriteErrorMessage(error, `Failed to deploy ${step.label}`);
            errorMessage.value = message;
            onTransactionFailed?.(message);
            deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', message);
        }
        finally {
            busyStepId.value = undefined;
            onTransactionFinished();
        }
    };
    const deployNextMissing = async () => {
        const nextMissing = findNextDeployableStep(deploymentStatuses);
        if (nextMissing === undefined)
            return;
        await deployStep(nextMissing.id, 'deployNextMissing');
    };
    return {
        busyStepId: busyStepId.value,
        deploymentFeedback: deploymentFeedback.value,
        deployNextMissing,
        deployStep,
        errorMessage: errorMessage.value,
    };
}
//# sourceMappingURL=useDeploymentFlow.js.map