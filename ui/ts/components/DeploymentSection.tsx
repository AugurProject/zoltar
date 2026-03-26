import type { DeploymentSectionProps } from '../types/components.js'
import { getPrerequisiteLabel } from '../lib/deployment.js'

export function DeploymentSection({ title, steps, allSteps, accountAddress, isMainnet, busyStepId, onDeploy }: DeploymentSectionProps) {
	return (
		<section className="panel contract-panel">
			<div className="contract-panel-header">
				<div>
					<p className="panel-label">{title}</p>
					<h2>{title}</h2>
				</div>
			</div>
			<div className="contract-list">
				{steps.map(step => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const canDeploy = accountAddress !== undefined && isMainnet && prerequisiteLabel === undefined && !step.deployed && busyStepId === undefined

					return (
						<div className="contract-row" key={step.id}>
							<div className="contract-copy">
								<div className="contract-topline">
									<span className={`badge ${ step.deployed ? 'ok' : prerequisiteLabel === undefined ? 'pending' : 'blocked' }`}>{step.deployed ? 'Deployed' : prerequisiteLabel === undefined ? 'Ready' : 'Blocked'}</span>
									<h3>{step.label}</h3>
								</div>
								<p className="address">{step.address}</p>
								<p className="detail">{step.deployed ? 'Code found at expected address.' : prerequisiteLabel === undefined ? 'Ready to deploy.' : `Waiting for ${ prerequisiteLabel }.`}</p>
							</div>
							<button onClick={() => void onDeploy(step.id)} disabled={!canDeploy}>
								{step.deployed ? 'Deployed' : isBusy ? 'Deploying...' : 'Deploy'}
							</button>
						</div>
					)
				})}
			</div>
		</section>
	)
}
