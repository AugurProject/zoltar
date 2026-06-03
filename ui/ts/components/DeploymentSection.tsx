import type { DeploymentSectionProps } from '../types/components.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeClass: string
	label: string | undefined
	detail: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean, accountAddress: string | undefined, isMainnet: boolean): StepStatus {
	if (stepDeployed)
		return {
			badgeClass: 'ok',
			detail: 'Code found at expected address.',
			label: 'Deployed',
			buttonLabel: 'Deployed',
		}

	if (isBusy)
		return {
			badgeClass: 'pending',
			detail: 'Deployment in progress.',
			label: 'Deploying...',
			buttonLabel: 'Deploying...',
		}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined)
			return {
				badgeClass: 'pending',
				detail: 'Connect wallet to continue.',
				label: 'Not Deployed',
				buttonLabel: 'Deploy',
			}
		if (!isMainnet)
			return {
				badgeClass: 'pending',
				detail: 'Switch to Ethereum mainnet.',
				label: 'Not Deployed',
				buttonLabel: 'Deploy',
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
		label: 'Waiting',
		buttonLabel: 'Deploy',
	}
}

export function DeploymentSection({ title, steps, allSteps, accountAddress, busyStepId, deploymentFeedback, isMainnet, onDeploy }: DeploymentSectionProps) {
	return (
		<SectionBlock className='contract-panel' title={title}>
			<div className='contract-list'>
				{steps.map(step => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const stepStatus = getStepStatus(step.deployed, prerequisiteLabel, isBusy, accountAddress, isMainnet)
					const availability = getDeploymentStepAvailability({
						accountAddress,
						busyStepId,
						isMainnet,
						prerequisiteLabel,
						step,
					})

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
							<TransactionActionButton idleLabel={stepStatus.buttonLabel} pendingLabel='Deploying...' onClick={() => void onDeploy(step.id)} pending={isBusy} status={deploymentFeedback?.action === step.id ? deploymentFeedback.status : undefined} availability={availability} />
						</div>
					)
				})}
			</div>
		</SectionBlock>
	)
}
