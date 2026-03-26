import type { DeploymentSectionProps } from '../types/components.js'
import { getPrerequisiteLabel } from '../lib/deployment.js'

export function DeploymentSection({ title, steps, allSteps, accountAddress, isMainnet, busyStepId, onDeploy }: DeploymentSectionProps) {
	return (
		<section class="panel contract-panel">
			<div class="contract-panel-header">
				<div>
					<p class="panel-label">{title}</p>
					<h2>{title}</h2>
				</div>
			</div>
			<div class="contract-list">
				{steps.map(step => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const canDeploy = accountAddress !== undefined && isMainnet && prerequisiteLabel === undefined && !step.deployed && busyStepId === undefined

					return (
						<div class="contract-row" key={step.id}>
							<div class="contract-copy">
								<div class="contract-topline">
									<span class={`badge ${ step.deployed ? 'ok' : prerequisiteLabel === undefined ? 'pending' : 'blocked' }`}>{step.deployed ? 'Deployed' : prerequisiteLabel === undefined ? 'Ready' : 'Blocked'}</span>
									<h3>{step.label}</h3>
								</div>
								<p class="address">{step.address}</p>
								<p class="detail">{step.deployed ? 'Code found at expected address.' : prerequisiteLabel === undefined ? 'Ready to deploy.' : `Waiting for ${ prerequisiteLabel }.`}</p>
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
