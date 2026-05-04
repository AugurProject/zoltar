import type { DeploymentSectionProps } from '../types/components.js'
import { getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeClass: string
	label: string | undefined
	detail: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean, accountAddress: string | undefined, activeNetworkLabel: string, walletMatchesActiveNetwork: boolean): StepStatus {
	if (stepDeployed) {
		return {
			badgeClass: 'ok',
			detail: 'Code found at expected address.',
			label: 'Deployed',
			buttonLabel: 'Deployed',
		}
	}

	if (isBusy) {
		return {
			badgeClass: 'pending',
			detail: 'Deployment in progress.',
			label: 'Deploying...',
			buttonLabel: 'Deploying...',
		}
	}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined) {
			return {
				badgeClass: 'pending',
				detail: 'Connect wallet to continue.',
				label: 'Not Deployed',
				buttonLabel: 'Deploy',
			}
		}
		if (!walletMatchesActiveNetwork) {
			return {
				badgeClass: 'pending',
				detail: `Switch wallet to ${activeNetworkLabel}.`,
				label: 'Not Deployed',
				buttonLabel: 'Deploy',
			}
		}
		return {
			badgeClass: 'pending',
			detail: 'Can deploy now.',
			label: 'Not Deployed',
			buttonLabel: 'Deploy',
		}
	}

	return {
		badgeClass: 'blocked',
		detail: `Waiting for ${prerequisiteLabel}.`,
		label: 'Blocked',
		buttonLabel: 'Deploy',
	}
}

export function DeploymentSection({ title, steps, allSteps, accountAddress, activeNetworkLabel = 'Ethereum mainnet', busyStepId, onDeploy, walletMatchesActiveNetwork = true, zoltarExternalPrerequisiteLabel }: DeploymentSectionProps) {
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
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex, zoltarExternalPrerequisiteLabel)
					const isBusy = busyStepId === step.id
					const canDeploy = accountAddress !== undefined && walletMatchesActiveNetwork && prerequisiteLabel === undefined && !step.deployed && busyStepId === undefined
					const stepStatus = getStepStatus(step.deployed, prerequisiteLabel, isBusy, accountAddress, activeNetworkLabel, walletMatchesActiveNetwork)

					return (
						<div className='contract-row' key={step.id}>
							<div className='contract-copy'>
								<div className='contract-topline'>
									{stepStatus.label === undefined ? undefined : <span className={`badge ${stepStatus.badgeClass}`}>{stepStatus.label}</span>}
									<h3>{step.label}</h3>
								</div>
								<p className='address'>{step.address}</p>
								<p className='detail'>{stepStatus.detail}</p>
							</div>
							<button className='primary' onClick={() => void onDeploy(step.id)} disabled={!canDeploy}>
								{stepStatus.buttonLabel}
							</button>
						</div>
					)
				})}
			</div>
		</section>
	)
}
