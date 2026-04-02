import type { DeploymentSectionProps } from '../types/components.js'
import { getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeClass: string
	label: string
	detail: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean): StepStatus {
	if (stepDeployed) {
		return {
			badgeClass: 'ok',
			detail: 'Code found at expected address.',
			label: 'Deployed',
			buttonLabel: 'Deployed',
		}
	}

	if (prerequisiteLabel === undefined) {
		return {
			badgeClass: 'pending',
			detail: 'Ready to deploy.',
			label: isBusy ? 'Deploying...' : 'Ready',
			buttonLabel: isBusy ? 'Deploying...' : 'Deploy',
		}
	}

	return {
		badgeClass: 'blocked',
		detail: `Waiting for ${prerequisiteLabel}.`,
		label: 'Blocked',
		buttonLabel: isBusy ? 'Deploying...' : 'Deploy',
	}
}

export function DeploymentSection({ title, steps, allSteps, accountAddress, isMainnet, busyStepId, onDeploy }: DeploymentSectionProps) {
	return (
		<section className='panel contract-panel'>
			<div className='contract-panel-header'>
				<div>
					<h2>{title}</h2>
				</div>
			</div>
			<div className='contract-list'>
				{steps.map(step => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const canDeploy = accountAddress !== undefined && isMainnet && prerequisiteLabel === undefined && !step.deployed && busyStepId === undefined
					const stepStatus = getStepStatus(step.deployed, prerequisiteLabel, isBusy)

					return (
						<div className='contract-row' key={step.id}>
							<div className='contract-copy'>
								<div className='contract-topline'>
									<span className={`badge ${stepStatus.badgeClass}`}>{stepStatus.label}</span>
									<h3>{step.label}</h3>
								</div>
								<p className='address'>{step.address}</p>
								<p className='detail'>{stepStatus.detail}</p>
							</div>
							<button onClick={() => void onDeploy(step.id)} disabled={!canDeploy}>
								{stepStatus.buttonLabel}
							</button>
						</div>
					)
				})}
			</div>
		</section>
	)
}
