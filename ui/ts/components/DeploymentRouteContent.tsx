import { LoadableValue } from './LoadableValue.js'
import { DeploymentSection } from './DeploymentSection.js'
import { findNextDeployableStep } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../types/components.js'

export function DeploymentRouteContent({ accountAddress, busyStepId, deployNextMissingPending, deploymentSections, deploymentStatuses, isLoadingDeploymentStatuses, isMainnet, onDeploy, onDeployNextMissing }: DeploymentRouteContentProps) {
	const nextMissingStep = findNextDeployableStep(deploymentStatuses)
	const deployedCount = deploymentStatuses.filter(step => step.deployed).length

	return (
		<>
			<section className="panel">
				<h2>
					<LoadableValue loading={isLoadingDeploymentStatuses} placeholder="Loading deployment status...">
						{deployedCount} / {deploymentStatuses.length} Ready
					</LoadableValue>
				</h2>
				<p className="detail">
					<LoadableValue loading={isLoadingDeploymentStatuses} placeholder="Checking deterministic deployments...">
						{nextMissingStep === undefined ? 'All deterministic contracts are deployed.' : `Next deployable contract: ${ nextMissingStep.label }`}
					</LoadableValue>
				</p>
				<div className="actions">
					<button onClick={onDeployNextMissing} disabled={accountAddress === undefined || !isMainnet || nextMissingStep === undefined || busyStepId !== undefined || deployNextMissingPending}>
						{deployNextMissingPending ? (
							<>
								<span className="spinner" aria-hidden="true" />
								Deploying...
							</>
						) : busyStepId === undefined ? (
							'Deploy Next Missing'
						) : (
							'Deployment In Progress'
						)}
					</button>
				</div>
			</section>
			{deploymentSections.map(section => (
				<DeploymentSection title={section.title} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />
			))}
		</>
	)
}
