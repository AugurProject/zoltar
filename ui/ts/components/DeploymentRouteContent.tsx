import { DeploymentSection } from './DeploymentSection.js'
import { findNextDeployableStep } from '../lib/deployment.js'
import type { DeploymentRouteContentProps } from '../types/components.js'

export function DeploymentRouteContent({ accountAddress, busyStepId, deploymentSections, deploymentStatuses, isMainnet, onDeploy, onDeployNextMissing }: DeploymentRouteContentProps) {
	const nextMissingStep = findNextDeployableStep(deploymentStatuses)
	const deployedCount = deploymentStatuses.filter(step => step.deployed).length

	return (
		<>
			<section className="panel">
				<p className="panel-label">Deployment Progress</p>
				<h2>
					{deployedCount} / {deploymentStatuses.length} Ready
				</h2>
				<p className="detail">{nextMissingStep === undefined ? 'All deterministic contracts are deployed.' : `Next deployable contract: ${ nextMissingStep.label }`}</p>
				<div className="actions">
					<button onClick={onDeployNextMissing} disabled={accountAddress === undefined || !isMainnet || nextMissingStep === undefined || busyStepId !== undefined}>
						{busyStepId === undefined ? 'Deploy Next Missing' : 'Deployment In Progress'}
					</button>
				</div>
			</section>
			{deploymentSections.map(section => (
				<DeploymentSection title={section.title} steps={section.steps} allSteps={deploymentStatuses} accountAddress={accountAddress} isMainnet={isMainnet} busyStepId={busyStepId} onDeploy={onDeploy} />
			))}
		</>
	)
}
