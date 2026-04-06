import type { ComponentChildren } from 'preact'
import { LoadableValue } from './LoadableValue.js'
import { DeploymentSection } from './DeploymentSection.js'
import { findNextDeployableStep } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../types/components.js'

export function DeploymentRouteContent({ accountAddress, busyStepId, deployNextMissingPending, deploymentSections, deploymentStatuses, isLoadingDeploymentStatuses, isMainnet, onDeploy, onDeployNextMissing }: DeploymentRouteContentProps) {
	const nextMissingStep = findNextDeployableStep(deploymentStatuses)
	const deployedContractCount = deploymentStatuses.filter(step => step.deployed).length
	const totalContractCount = deploymentStatuses.length
	let buttonContent: ComponentChildren = 'Deploy Next Missing'
	if (deployNextMissingPending) {
		buttonContent = (
			<>
				<span className='spinner' aria-hidden='true' />
				Deploying...
			</>
		)
	} else if (busyStepId !== undefined) {
		buttonContent = 'Deployment In Progress'
	}

	return (
		<>
			<section className='panel'>
				<h2>
					<LoadableValue loading={isLoadingDeploymentStatuses} placeholder='Loading deployment status...'>
						{deployedContractCount} / {totalContractCount} contracts deployed
					</LoadableValue>
				</h2>
				{!isLoadingDeploymentStatuses && <p className='detail'>{nextMissingStep === undefined ? 'All deterministic contracts are deployed.' : `Next deployable contract: ${nextMissingStep.label}`}</p>}
				<div className='actions'>
					<button className='primary' onClick={onDeployNextMissing} disabled={accountAddress === undefined || !isMainnet || nextMissingStep === undefined || busyStepId !== undefined || deployNextMissingPending}>
						{buttonContent}
					</button>
				</div>
			</section>
			{deploymentSections.map(section => (
				<DeploymentSection title={section.title} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />
			))}
		</>
	)
}
