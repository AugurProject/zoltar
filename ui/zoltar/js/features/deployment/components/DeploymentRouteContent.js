import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as deploymentCopy from '../../../copy/deployment.js';
import { useId } from 'preact/hooks';
import { LoadableValue } from '@zoltar/ui-core-shared/components/LoadableValue.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { DeploymentSection } from './DeploymentSection.js';
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { buildRouteHref, getRouteHash, getTopLevelRouteSearch } from '@zoltar/ui-core-shared/lib/routing.js';
import { writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js';
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js';
export function DeploymentRouteContent({ accountAddress, busyStepId, deploymentStateReady, deploymentStatusError, deployNextMissingPending, deploymentSections, deploymentStatuses, isLoadingDeploymentStatuses, isOnActiveAppChain, onDeploy, onDeployNextMissing, onRetryDeploymentStatus }) {
    const deploymentStatusReasonId = useId();
    const nextMissingStep = findNextDeployableStep(deploymentStatuses);
    const deployedContractCount = deploymentStatuses.filter(step => step.deployed).length;
    const totalContractCount = deploymentStatuses.length;
    const deploymentComplete = deploymentStateReady && !isLoadingDeploymentStatuses && totalContractCount > 0 && deployedContractCount === totalContractCount;
    const questionsHref = buildRouteHref(getRouteHash('zoltar'), writeZoltarViewQueryParam(getTopLevelRouteSearch('zoltar'), 'questions'));
    const deployNextAvailability = deploymentStateReady
        ? getDeployNextMissingAvailability({
            accountAddress,
            busyStepId,
            deployNextMissingPending,
            isOnActiveAppChain,
            nextMissingStep,
        })
        : { disabled: true, reason: deploymentCopy.deploymentStatusUnavailableReason };
    let buttonContent = deploymentCopy.deployNextMissing;
    if (deployNextMissingPending) {
        buttonContent = deploymentCopy.deploying;
    }
    else if (busyStepId !== undefined)
        buttonContent = deploymentCopy.deploymentRunningStatusLabel;
    let nextDeployableContent = commonCopy.unavailable;
    if (isLoadingDeploymentStatuses)
        nextDeployableContent = _jsx(LoadingText, {});
    else if (deploymentStateReady)
        nextDeployableContent = nextMissingStep?.label ?? deploymentCopy.allDeployed;
    let deploymentStatusNotice;
    if (!deploymentStateReady && isLoadingDeploymentStatuses)
        deploymentStatusNotice = (_jsx("p", { id: deploymentStatusReasonId, className: 'detail', children: _jsx(LoadingText, { children: deploymentCopy.loadingDeploymentStatus }) }));
    else if (!deploymentStateReady)
        deploymentStatusNotice = (_jsxs(_Fragment, { children: [_jsx("p", { id: deploymentStatusReasonId, className: 'detail', children: deploymentCopy.deploymentStatusUnavailableReason }), _jsx(ErrorNotice, { message: deploymentStatusError }), deploymentStatusError === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: onRetryDeploymentStatus, children: commonCopy.retry }) }))] }));
    return (_jsxs(_Fragment, { children: [_jsx(RouteHeader, { className: 'deployment-route-header', eyebrow: commonCopy.deploy, title: deploymentCopy.deterministicContractDeployment, description: deploymentCopy.deploymentOverviewDetail, actions: deploymentComplete ? (_jsx("a", { className: 'button-link', href: questionsHref, children: deploymentCopy.browseQuestions })) : (_jsx(TransactionActionButton, { disabledReasonElementId: deploymentStateReady ? undefined : deploymentStatusReasonId, idleLabel: buttonContent, pendingLabel: deploymentCopy.deploying, onClick: onDeployNextMissing, pending: deployNextMissingPending, availability: deployNextAvailability, showDisabledReason: deploymentStateReady })), summary: _jsxs(DataGrid, { columns: 'auto', children: [_jsxs("div", { children: [_jsx("p", { className: 'detail', children: deploymentCopy.contractsDeployed }), _jsx("strong", { children: _jsx(LoadableValue, { loading: isLoadingDeploymentStatuses, placeholder: deploymentCopy.loadingDeploymentStatus, children: deploymentStateReady ? `${deployedContractCount.toString()} / ${totalContractCount.toString()}` : commonCopy.unavailable }) })] }), _jsxs("div", { children: [_jsx("p", { className: 'detail', children: deploymentCopy.nextDeployable }), _jsx("strong", { children: nextDeployableContent })] })] }) }), deploymentStatusNotice, _jsxs("details", { className: 'deployment-contract-details', children: [_jsx("summary", { children: _jsx("span", { children: deploymentCopy.allContracts }) }), _jsx("div", { className: 'workflow-stack deployment-contract-groups', children: deploymentSections.map(section => {
                            const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed);
                            const sectionContent = (_jsx(DeploymentSection, { title: section.title, completedGroup: allDeployed, steps: section.steps, allSteps: deploymentStatuses, accountAddress: accountAddress, isOnActiveAppChain: isOnActiveAppChain, busyStepId: busyStepId, deploymentStateReady: deploymentStateReady, deploymentStatusReasonElementId: deploymentStateReady ? undefined : deploymentStatusReasonId, onDeploy: onDeploy }));
                            return _jsx("div", { children: sectionContent }, section.title);
                        }) })] })] }));
}
//# sourceMappingURL=DeploymentRouteContent.js.map