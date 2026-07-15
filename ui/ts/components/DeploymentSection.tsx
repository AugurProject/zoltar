import type { BadgeTone, DeploymentSectionProps } from '../types/components.js'
import { Badge } from './Badge.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'
import {
	UI_STRING_CAN_DEPLOY_NOW,
	UI_STRING_CODE_FOUND_AT_EXPECTED_ADDRESS,
	UI_STRING_CONNECT_WALLET_TO_CONTINUE,
	UI_STRING_DEPLOY,
	UI_STRING_DEPLOYED,
	UI_STRING_DEPLOYING,
	UI_STRING_DEPLOYMENT_IN_PROGRESS,
	UI_STRING_NOT_DEPLOYED_DEPLOYMENT_SECTION_NOT_DEPLOYED_BADGE_LABEL,
	UI_STRING_WAITING,
	UI_TEMPLATE_WAITING_FOR_PREREQUISITE_DETAIL,
} from '../lib/uiStrings.js'

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
			detail: UI_STRING_CODE_FOUND_AT_EXPECTED_ADDRESS,
			label: UI_STRING_DEPLOYED,
			buttonLabel: UI_STRING_DEPLOYED,
		}

	if (isBusy)
		return {
			badgeTone: 'pending',
			detail: UI_STRING_DEPLOYMENT_IN_PROGRESS,
			label: UI_STRING_DEPLOYING,
			buttonLabel: UI_STRING_DEPLOYING,
		}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined)
			return {
				badgeTone: 'pending',
				detail: UI_STRING_CONNECT_WALLET_TO_CONTINUE,
				label: UI_STRING_NOT_DEPLOYED_DEPLOYMENT_SECTION_NOT_DEPLOYED_BADGE_LABEL,
				buttonLabel: UI_STRING_DEPLOY,
			}
		if (!isMainnet)
			return {
				badgeTone: 'pending',
				label: UI_STRING_NOT_DEPLOYED_DEPLOYMENT_SECTION_NOT_DEPLOYED_BADGE_LABEL,
				buttonLabel: UI_STRING_DEPLOY,
			}
		return {
			badgeTone: 'pending',
			detail: UI_STRING_CAN_DEPLOY_NOW,
			label: UI_STRING_NOT_DEPLOYED_DEPLOYMENT_SECTION_NOT_DEPLOYED_BADGE_LABEL,
			buttonLabel: UI_STRING_DEPLOY,
		}
	}

	return {
		badgeTone: 'blocked',
		detail: UI_TEMPLATE_WAITING_FOR_PREREQUISITE_DETAIL(prerequisiteLabel),
		label: UI_STRING_WAITING,
		buttonLabel: UI_STRING_DEPLOY,
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
							<TransactionActionButton idleLabel={stepStatus.buttonLabel} pendingLabel={UI_STRING_DEPLOYING} onClick={() => void onDeploy(step.id)} pending={isBusy} availability={availability} />
						</div>
					)
				})}
			</div>
		</SectionBlock>
	)
}
