import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as deploymentCopy from '../../../copy/deployment.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js';
function getStepStatus(stepDeployed, prerequisiteLabel, isBusy, accountAddress, isOnActiveAppChain) {
    if (stepDeployed)
        return {
            badgeTone: 'ok',
            label: commonCopy.deployed,
            buttonLabel: commonCopy.deployed,
        };
    if (isBusy)
        return {
            badgeTone: 'pending',
            detail: deploymentCopy.deploymentRunningStatus,
            label: deploymentCopy.deploying,
            buttonLabel: deploymentCopy.deploying,
        };
    if (prerequisiteLabel === undefined) {
        if (accountAddress === undefined)
            return {
                badgeTone: 'pending',
                detail: commonCopy.walletConnectionRequired,
                label: deploymentCopy.notDeployedBadgeLabel,
                buttonLabel: commonCopy.deploy,
            };
        if (!isOnActiveAppChain)
            return {
                badgeTone: 'pending',
                label: deploymentCopy.notDeployedBadgeLabel,
                buttonLabel: commonCopy.deploy,
            };
        return {
            badgeTone: 'pending',
            detail: deploymentCopy.deploymentReadyStatus,
            label: deploymentCopy.notDeployedBadgeLabel,
            buttonLabel: commonCopy.deploy,
        };
    }
    return {
        badgeTone: 'blocked',
        detail: deploymentCopy.formatPrerequisiteDetail(prerequisiteLabel),
        label: deploymentCopy.waiting,
        buttonLabel: commonCopy.deploy,
    };
}
export function DeploymentSection({ title, completedGroup = false, steps, allSteps, accountAddress, busyStepId, deploymentStateReady, deploymentStatusReasonElementId, isOnActiveAppChain, onDeploy }) {
    return (_jsx(SectionBlock, { className: 'contract-panel', title: completedGroup ? undefined : title, variant: 'plain', children: _jsx("div", { className: 'contract-list', children: steps.map(step => {
                const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id);
                const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex);
                const isBusy = busyStepId === step.id;
                const stepStatus = deploymentStateReady
                    ? getStepStatus(step.deployed, prerequisiteLabel, isBusy, accountAddress, isOnActiveAppChain)
                    : {
                        badgeTone: 'muted',
                        buttonLabel: commonCopy.deploy,
                        label: commonCopy.unavailable,
                    };
                const availability = deploymentStateReady
                    ? getDeploymentStepAvailability({
                        accountAddress,
                        busyStepId,
                        isOnActiveAppChain,
                        prerequisiteLabel,
                        step,
                    })
                    : { disabled: true, reason: deploymentCopy.deploymentStatusUnavailableReason };
                const statusDetailId = stepStatus.detail === undefined ? undefined : `deployment-${step.id}-status-detail`;
                return (_jsxs("div", { className: 'contract-row', children: [_jsxs("div", { className: 'contract-copy', children: [_jsxs("div", { className: 'contract-topline', children: [stepStatus.label === undefined || (completedGroup && step.deployed) ? undefined : _jsx(Badge, { tone: stepStatus.badgeTone, children: stepStatus.label }), _jsx("h3", { children: step.label })] }), _jsx("p", { className: 'address', children: step.address }), stepStatus.detail === undefined ? undefined : (_jsx("p", { className: 'detail', id: statusDetailId, children: stepStatus.detail }))] }), step.deployed ? undefined : (_jsx(TransactionActionButton, { ariaLabel: isBusy ? deploymentCopy.formatDeployingContract(step.label) : deploymentCopy.formatDeployContract(step.label), idleLabel: stepStatus.buttonLabel, pendingLabel: deploymentCopy.deploying, onClick: () => void onDeploy(step.id), pending: isBusy, availability: availability, disabledReasonElementId: deploymentStateReady ? statusDetailId : deploymentStatusReasonElementId, showDisabledReason: deploymentStateReady && accountAddress !== undefined && prerequisiteLabel === undefined }))] }, step.id));
            }) }) }));
}
//# sourceMappingURL=DeploymentSection.js.map