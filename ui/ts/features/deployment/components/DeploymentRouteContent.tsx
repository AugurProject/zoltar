import * as commonCopy from '../../../copy/common.js'
import * as deploymentCopy from '../../../copy/deployment.js'
import type { ComponentChildren } from 'preact'
import { LoadableValue } from '../../../components/LoadableValue.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { DeploymentSection } from './DeploymentSection.js'
import { ReadOnlyDetailAccordion } from '../../../components/ReadOnlyDetailAccordion.js'
import { RouteHeader } from '../../../components/RouteHeader.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../../types.js'

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
	let buttonContent: ComponentChildren = deploymentCopy.deployNextMissing
	if (deployNextMissingPending) {
		buttonContent = deploymentCopy.deploying
	} else if (busyStepId !== undefined) buttonContent = deploymentCopy.deploymentRunningStatusLabel

	return (
		<>
			<RouteHeader
				eyebrow={commonCopy.deploy}
				title={deploymentCopy.deterministicContractDeployment}
				description={deploymentCopy.deploymentOverviewDetail}
				actions={<TransactionActionButton idleLabel={buttonContent} pendingLabel={deploymentCopy.deploying} onClick={onDeployNextMissing} pending={deployNextMissingPending} availability={deployNextAvailability} />}
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>{deploymentCopy.contractsDeployed}</p>
							<strong>
								<LoadableValue loading={isLoadingDeploymentStatuses} placeholder={deploymentCopy.loadingDeploymentStatus}>
									{deployedContractCount} / {totalContractCount}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<p className='detail'>{deploymentCopy.nextDeployable}</p>
							<strong>{isLoadingDeploymentStatuses ? <LoadingText /> : (nextMissingStep?.label ?? deploymentCopy.allDeployed)}</strong>
						</div>
					</DataGrid>
				}
			/>
			<SectionBlock title={deploymentCopy.deploymentGroups}>
				<div className='workflow-stack'>
					{deploymentSections.map(section => {
						const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed)
						const sectionContent = <DeploymentSection title={section.title} completedGroup={allDeployed} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />

						if (!allDeployed) return <div key={section.title}>{sectionContent}</div>

						return (
							<ReadOnlyDetailAccordion key={section.title} title={deploymentCopy.formatCompletedSectionTitle(section.title)}>
								{sectionContent}
							</ReadOnlyDetailAccordion>
						)
					})}
				</div>
			</SectionBlock>
		</>
	)
}
