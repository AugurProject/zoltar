import type { ComponentChildren } from 'preact'
import { LoadableValue } from './LoadableValue.js'
import { DeploymentSection } from './DeploymentSection.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { DataGrid } from './DataGrid.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js'
import {
	UI_STRING_ALL_DEPLOYED,
	UI_STRING_ALL_DETERMINISTIC_CONTRACTS_ARE_DEPLOYED_IN_GROUPED_SECTIONS,
	UI_STRING_CONTRACTS_DEPLOYED,
	UI_STRING_DEPLOY,
	UI_STRING_DEPLOY_AND_VERIFY_THE_SHARED_DETERMINISTIC_CONTRACTS_THAT_BACK_THE_APPLICATION,
	UI_STRING_DEPLOY_NEXT_MISSING,
	UI_STRING_DEPLOYING,
	UI_STRING_DEPLOYMENT_GROUPS,
	UI_STRING_DEPLOYMENT_IN_PROGRESS_DEPLOYMENT_ROUTE_CONTENT_DEPLOYMENT_IN_PROGRESS_LABEL,
	UI_STRING_DETERMINISTIC_CONTRACT_DEPLOYMENT,
	UI_STRING_LOADING_DEPLOYMENT_STATUS,
	UI_STRING_LOADING_WITH_ELLIPSIS,
	UI_STRING_NEXT_DEPLOYABLE,
	UI_STRING_NEXT_DEPLOYABLE_CONTRACT,
	UI_TEMPLATE_COMPLETED_SECTION_TITLE,
} from '../lib/uiStrings.js'
import type { DeploymentRouteContentProps } from '../types/components.js'

export function DeploymentRouteContent({ accountAddress, busyStepId, deployNextMissingPending, deploymentSections, deploymentStatuses, isLoadingDeploymentStatuses, isMainnet, onDeploy, onDeployNextMissing }: DeploymentRouteContentProps) {
	const nextMissingStep = findNextDeployableStep(deploymentStatuses)
	const deployedContractCount = deploymentStatuses.filter(step => step.deployed).length
	const totalContractCount = deploymentStatuses.length
	const deployNextAvailability = getDeployNextMissingAvailability({
		accountAddress,
		busyStepId,
		deployNextMissingPending,
		isMainnet,
		nextMissingStep,
	})
	let buttonContent: ComponentChildren = UI_STRING_DEPLOY_NEXT_MISSING
	if (deployNextMissingPending) {
		buttonContent = UI_STRING_DEPLOYING
	} else if (busyStepId !== undefined) buttonContent = UI_STRING_DEPLOYMENT_IN_PROGRESS_DEPLOYMENT_ROUTE_CONTENT_DEPLOYMENT_IN_PROGRESS_LABEL

	return (
		<>
			<RouteHeader
				eyebrow={UI_STRING_DEPLOY}
				title={UI_STRING_DETERMINISTIC_CONTRACT_DEPLOYMENT}
				description={UI_STRING_DEPLOY_AND_VERIFY_THE_SHARED_DETERMINISTIC_CONTRACTS_THAT_BACK_THE_APPLICATION}
				actions={<TransactionActionButton idleLabel={buttonContent} pendingLabel={UI_STRING_DEPLOYING} onClick={onDeployNextMissing} pending={deployNextMissingPending} availability={deployNextAvailability} />}
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>{UI_STRING_CONTRACTS_DEPLOYED}</p>
							<strong>
								<LoadableValue loading={isLoadingDeploymentStatuses} placeholder={UI_STRING_LOADING_DEPLOYMENT_STATUS}>
									{deployedContractCount} / {totalContractCount}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<p className='detail'>{UI_STRING_NEXT_DEPLOYABLE}</p>
							<strong>{isLoadingDeploymentStatuses ? UI_STRING_LOADING_WITH_ELLIPSIS : (nextMissingStep?.label ?? UI_STRING_ALL_DEPLOYED)}</strong>
						</div>
					</DataGrid>
				}
			/>
			<SectionBlock title={UI_STRING_DEPLOYMENT_GROUPS} description={!isLoadingDeploymentStatuses && nextMissingStep !== undefined ? `${UI_STRING_NEXT_DEPLOYABLE_CONTRACT} ${nextMissingStep.label}` : UI_STRING_ALL_DETERMINISTIC_CONTRACTS_ARE_DEPLOYED_IN_GROUPED_SECTIONS}>
				<div className='workflow-stack'>
					{deploymentSections.map(section => {
						const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed)
						const sectionContent = <DeploymentSection title={section.title} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />

						if (!allDeployed) return <div key={section.title}>{sectionContent}</div>

						return (
							<ReadOnlyDetailAccordion key={section.title} title={UI_TEMPLATE_COMPLETED_SECTION_TITLE(section.title)}>
								{sectionContent}
							</ReadOnlyDetailAccordion>
						)
					})}
				</div>
			</SectionBlock>
		</>
	)
}
