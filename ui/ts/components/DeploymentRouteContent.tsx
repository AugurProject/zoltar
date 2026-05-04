import type { ComponentChildren } from 'preact'
import { LoadableValue } from './LoadableValue.js'
import { DeploymentSection } from './DeploymentSection.js'
import { findNextDeployableStep } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../types/components.js'

export function DeploymentRouteContent({
	accountAddress,
	activeNetworkLabel = 'Ethereum mainnet',
	busyStepId,
	deploymentBlockedNotice,
	deployNextMissingPending,
	deploymentSections,
	deploymentStatuses,
	isLoadingDeploymentStatuses,
	onDeploy,
	onDeployNextMissing,
	walletMatchesActiveNetwork = true,
	zoltarExternalPrerequisiteLabel,
}: DeploymentRouteContentProps) {
	const nextMissingStep = findNextDeployableStep(deploymentStatuses, zoltarExternalPrerequisiteLabel)
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
				{deploymentBlockedNotice === undefined ? undefined : <p className='detail'>{deploymentBlockedNotice}</p>}
				{accountAddress !== undefined && !walletMatchesActiveNetwork ? <p className='detail'>{`Switch wallet to ${activeNetworkLabel} to deploy contracts.`}</p> : undefined}
				<div className='actions'>
					<button className='primary' onClick={onDeployNextMissing} disabled={accountAddress === undefined || !walletMatchesActiveNetwork || nextMissingStep === undefined || busyStepId !== undefined || deployNextMissingPending}>
						{buttonContent}
					</button>
				</div>
			</section>
			{deploymentSections.map(section => (
				<DeploymentSection
					title={section.title}
					steps={section.steps}
					allSteps={deploymentStatuses}
					accountAddress={accountAddress}
					activeNetworkLabel={activeNetworkLabel}
					busyStepId={busyStepId}
					onDeploy={onDeploy}
					walletMatchesActiveNetwork={walletMatchesActiveNetwork}
					zoltarExternalPrerequisiteLabel={zoltarExternalPrerequisiteLabel}
				/>
			))}
		</>
	)
}
