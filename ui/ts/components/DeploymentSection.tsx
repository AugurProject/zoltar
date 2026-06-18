import type { BadgeTone, DeploymentSectionProps } from '../types/components.js'
import { Badge } from './Badge.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeTone: BadgeTone
	label: string | undefined
	detail: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean, accountAddress: string | undefined, isMainnet: boolean): StepStatus {
	if (stepDeployed)
		return {
			badgeTone: 'ok',
			detail: 'Code found at expected address.',
			label: 'Deployed',
			buttonLabel: 'Deployed',
		}

	if (isBusy)
		return {
			badgeTone: 'pending',
			detail: 'Deployment in progress.',
			label: 'Deploying...',
			buttonLabel: 'Deploying...',
		}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined)
			return {
				badgeTone: 'pending',
				detail: 'Connect wallet to continue.',
				label: 'Not Deployed',
				buttonLabel: 'Deploy',
			}
		if (!isMainnet)
			return {
				badgeTone: 'pending',
				detail: 'Switch to Ethereum mainnet.',
				label: 'Not Deployed',
				buttonLabel: 'Deploy',
			}
		return {
			badgeTone: 'pending',
			detail: 'Can deploy now.',
			label: 'Not Deployed',
			buttonLabel: 'Deploy',
		}
	}

	return {
		badgeTone: 'blocked',
		detail: `Waiting for ${prerequisiteLabel}.`,
		label: 'Waiting',
		buttonLabel: 'Deploy',
	}
}

export function DeploymentSection({ title, steps, allSteps, accountAddress, busyStepId, isMainnet, onDeploy }: DeploymentSectionProps) {
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
									{stepStatus.label === undefined ? undefined : <Badge tone={stepStatus.badgeTone}>{stepStatus.label}</Badge>}
									<h3>{step.label}</h3>
								</div>
								<p className='address'>{step.address}</p>
								<p className='detail'>{stepStatus.detail}</p>
							</div>
							<TransactionActionButton idleLabel={stepStatus.buttonLabel} pendingLabel='Deploying...' onClick={() => void onDeploy(step.id)} pending={isBusy} availability={availability} />
						</div>
					)
				})}
			</div>
		</SectionBlock>
	)
}
