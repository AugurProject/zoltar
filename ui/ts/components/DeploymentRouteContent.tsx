import type { ComponentChildren } from 'preact'
import { LoadableValue } from './LoadableValue.js'
import { DeploymentSection } from './DeploymentSection.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { DataGrid } from './DataGrid.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
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
	let buttonContent: ComponentChildren = UI_STRINGS.deploymentRouteContent.deployButtonIdleLabel
	if (deployNextMissingPending) {
		buttonContent = UI_STRINGS.deploymentRouteContent.deployButtonPendingLabel
	} else if (busyStepId !== undefined) buttonContent = UI_STRINGS.deploymentRouteContent.deploymentInProgressLabel

	return (
		<>
			<RouteHeader
				eyebrow={UI_STRINGS.deploymentRouteContent.deployRouteEyebrow}
				title={UI_STRINGS.deploymentRouteContent.deterministicContractDeploymentTitle}
				description={UI_STRINGS.deploymentRouteContent.deterministicContractDeploymentDescription}
				actions={<TransactionActionButton safetyId='deployment.deployNextMissing' idleLabel={buttonContent} pendingLabel={UI_STRINGS.deploymentRouteContent.deployButtonPendingLabel} onClick={onDeployNextMissing} pending={deployNextMissingPending} availability={deployNextAvailability} />}
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>{UI_STRINGS.deploymentRouteContent.contractsDeployedLabel}</p>
							<strong>
								<LoadableValue loading={isLoadingDeploymentStatuses} placeholder={UI_STRINGS.deploymentRouteContent.loadingDeploymentStatusLabel}>
									{deployedContractCount} / {totalContractCount}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<p className='detail'>{UI_STRINGS.deploymentRouteContent.nextDeployableLabel}</p>
							<strong>{isLoadingDeploymentStatuses ? UI_STRINGS.deploymentRouteContent.loadingLabel : (nextMissingStep?.label ?? UI_STRINGS.deploymentRouteContent.allDeployedLabel)}</strong>
						</div>
					</DataGrid>
				}
			/>
			<SectionBlock title={UI_STRINGS.deploymentRouteContent.deploymentGroupsTitle} description={!isLoadingDeploymentStatuses && nextMissingStep !== undefined ? `${UI_STRINGS.deploymentRouteContent.nextDeployablePrefix} ${nextMissingStep.label}` : UI_STRINGS.deploymentRouteContent.deploymentGroupsDescription}>
				<div className='workflow-stack'>
					{deploymentSections.map(section => {
						const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed)
						const sectionContent = <DeploymentSection title={section.title} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />

						if (!allDeployed) return <div key={section.title}>{sectionContent}</div>

						return (
							<ReadOnlyDetailAccordion key={section.title} title={UI_STRINGS.deploymentRouteContent.completedSectionTitle(section.title)}>
								{sectionContent}
							</ReadOnlyDetailAccordion>
						)
					})}
				</div>
			</SectionBlock>
		</>
	)
}
