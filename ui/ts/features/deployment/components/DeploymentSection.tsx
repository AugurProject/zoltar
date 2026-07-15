import * as commonCopy from '../../../copy/common.js'
import * as deploymentCopy from '../../../copy/deployment.js'
import type { BadgeTone, DeploymentSectionProps } from '../../types.js'
import { Badge } from '../../../components/Badge.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeTone: BadgeTone
	label: string | undefined
	detail?: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean, accountAddress: string | undefined, isMainnet: boolean): StepStatus {
	if (stepDeployed)
		return {
			badgeTone: 'ok',
			detail: deploymentCopy.expectedCodeFoundStatus,
			label: commonCopy.deployed,
			buttonLabel: commonCopy.deployed,
		}

	if (isBusy)
		return {
			badgeTone: 'pending',
			detail: deploymentCopy.deploymentRunningStatus,
			label: deploymentCopy.deploying,
			buttonLabel: deploymentCopy.deploying,
		}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined)
			return {
				badgeTone: 'pending',
				detail: commonCopy.walletConnectionRequired,
				label: deploymentCopy.notDeployedBadgeLabel,
				buttonLabel: commonCopy.deploy,
			}
		if (!isMainnet)
			return {
				badgeTone: 'pending',
				label: deploymentCopy.notDeployedBadgeLabel,
				buttonLabel: commonCopy.deploy,
			}
		return {
			badgeTone: 'pending',
			detail: deploymentCopy.deploymentReadyStatus,
			label: deploymentCopy.notDeployedBadgeLabel,
			buttonLabel: commonCopy.deploy,
		}
	}

	return {
		badgeTone: 'blocked',
		detail: deploymentCopy.formatWaitingForPrerequisiteDetail(prerequisiteLabel),
		label: deploymentCopy.waiting,
		buttonLabel: commonCopy.deploy,
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
								{stepStatus.detail === undefined ? undefined : <p className='detail'>{stepStatus.detail}</p>}
							</div>
							<TransactionActionButton idleLabel={stepStatus.buttonLabel} pendingLabel={deploymentCopy.deploying} onClick={() => void onDeploy(step.id)} pending={isBusy} availability={availability} />
						</div>
					)
				})}
			</div>
		</SectionBlock>
	)
}
