import { ActionReadinessPanel } from './ActionReadinessPanel.js'
import type { ComponentChildren } from 'preact'
import { LoadableValue } from './LoadableValue.js'
import { DeploymentSection } from './DeploymentSection.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { DataGrid } from './DataGrid.js'
import { findNextDeployableStep, getDeployNextMissingAvailability } from '../lib/deployment.js'
import type { ReadinessAction } from '../types/components.js'
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
	const nextDeployAction: ReadinessAction = {
		actionLabel: 'Deploy Next Missing',
		description: nextMissingStep === undefined ? 'Every deterministic contract is already deployed.' : `The next deployable step is ${nextMissingStep.label}. Deploy it first before using lower-priority per-step actions.`,
		key: 'deploy-next-missing',
		readiness: deployNextAvailability.disabled ? 'blocked' : 'ready',
		...(deployNextAvailability.disabled ? {} : { onAction: onDeployNextMissing }),
		...(deployNextAvailability.reason === undefined ? {} : { blocker: deployNextAvailability.reason }),
		title: nextMissingStep === undefined ? 'Deployment Complete' : `Next: ${nextMissingStep.label}`,
	}
	let buttonContent: ComponentChildren = 'Deploy Next Missing'
	if (deployNextMissingPending) {
		buttonContent = 'Deploying...'
	} else if (busyStepId !== undefined) {
		buttonContent = 'Deployment In Progress'
	}

	return (
		<>
			<RouteHeader
				eyebrow='Deploy'
				title='Deterministic contract deployment'
				description='Deploy and verify the shared deterministic contracts that back the application.'
				actions={<TransactionActionButton idleLabel={buttonContent} pendingLabel='Deploying...' onClick={onDeployNextMissing} pending={deployNextMissingPending} availability={deployNextAvailability} />}
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>Contracts deployed</p>
							<strong>
								<LoadableValue loading={isLoadingDeploymentStatuses} placeholder='Loading deployment status...'>
									{deployedContractCount} / {totalContractCount}
								</LoadableValue>
							</strong>
						</div>
						<div>
							<p className='detail'>Next deployable</p>
							<strong>{isLoadingDeploymentStatuses ? 'Loading...' : (nextMissingStep?.label ?? 'All deployed')}</strong>
						</div>
					</DataGrid>
				}
			/>
			<ActionReadinessPanel actions={[nextDeployAction]} title='Deployment Readiness' />
			<SectionBlock title='Deployment Groups' description={!isLoadingDeploymentStatuses && nextMissingStep !== undefined ? `Next deployable contract: ${nextMissingStep.label}` : 'All deterministic contracts are deployed in grouped sections.'}>
				<div className='workflow-stack'>
					{deploymentSections.map(section => {
						const allDeployed = section.steps.length > 0 && section.steps.every(step => step.deployed)
						const sectionContent = <DeploymentSection title={section.title} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />

						if (!allDeployed) return <div key={section.title}>{sectionContent}</div>

						return (
							<ReadOnlyDetailAccordion key={section.title} title={`${section.title} (Completed)`}>
								{sectionContent}
							</ReadOnlyDetailAccordion>
						)
					})}
				</div>
			</SectionBlock>
		</>
	)
}
