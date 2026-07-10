import type { BadgeTone, DeploymentSectionProps } from '../types/components.js'
import { Badge } from './Badge.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'
import { UI_STRINGS } from '../lib/uiStrings.js'

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
			detail: UI_STRINGS.deploymentSection.codeFoundAtExpectedAddressDetail,
			label: UI_STRINGS.deploymentSection.deployedBadgeLabel,
			buttonLabel: UI_STRINGS.deploymentSection.deployedBadgeLabel,
		}

	if (isBusy)
		return {
			badgeTone: 'pending',
			detail: UI_STRINGS.deploymentSection.deployingDetail,
			label: UI_STRINGS.deploymentSection.deployingBadgeLabel,
			buttonLabel: UI_STRINGS.deploymentSection.deployingPendingLabel,
		}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined)
			return {
				badgeTone: 'pending',
				detail: UI_STRINGS.deploymentSection.connectWalletToContinueDetail,
				label: UI_STRINGS.deploymentSection.notDeployedBadgeLabel,
				buttonLabel: UI_STRINGS.deploymentSection.deployButtonLabel,
			}
		if (!isMainnet)
			return {
				badgeTone: 'pending',
				label: UI_STRINGS.deploymentSection.notDeployedBadgeLabel,
				buttonLabel: UI_STRINGS.deploymentSection.deployButtonLabel,
			}
		return {
			badgeTone: 'pending',
			detail: UI_STRINGS.deploymentSection.canDeployNowDetail,
			label: UI_STRINGS.deploymentSection.notDeployedBadgeLabel,
			buttonLabel: UI_STRINGS.deploymentSection.deployButtonLabel,
		}
	}

	return {
		badgeTone: 'blocked',
		detail: UI_STRINGS.deploymentSection.waitingForPrerequisiteDetail(prerequisiteLabel),
		label: UI_STRINGS.deploymentSection.waitingBadgeLabel,
		buttonLabel: UI_STRINGS.deploymentSection.deployButtonLabel,
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
							<TransactionActionButton idleLabel={stepStatus.buttonLabel} pendingLabel={UI_STRINGS.deploymentSection.deployingPendingLabel} onClick={() => void onDeploy(step.id)} pending={isBusy} availability={availability} />
						</div>
					)
				})}
			</div>
		</SectionBlock>
	)
}
