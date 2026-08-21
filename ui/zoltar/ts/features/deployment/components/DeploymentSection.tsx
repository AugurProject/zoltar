import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as deploymentCopy from '../../../copy/deployment.js'
import type { BadgeTone, DeploymentSectionProps } from '../../types.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeTone: BadgeTone
	label: string | undefined
	detail?: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean, accountAddress: string | undefined, isOnActiveAppChain: boolean): StepStatus {
	if (stepDeployed)
		return {
			badgeTone: 'ok',
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
		if (!isOnActiveAppChain)
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
		detail: deploymentCopy.formatPrerequisiteDetail(prerequisiteLabel),
		label: deploymentCopy.waiting,
		buttonLabel: commonCopy.deploy,
	}
}

export function DeploymentSection({ title, completedGroup = false, steps, allSteps, accountAddress, busyStepId, deploymentStateReady, deploymentStatusReasonElementId, isOnActiveAppChain, onDeploy }: DeploymentSectionProps) {
	return (
		<SectionBlock className='contract-panel' title={completedGroup ? undefined : title} variant='plain'>
			<div className='contract-list'>
				{steps.map(step => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const stepStatus = deploymentStateReady
						? getStepStatus(step.deployed, prerequisiteLabel, isBusy, accountAddress, isOnActiveAppChain)
						: {
								badgeTone: 'muted' as const,
								buttonLabel: commonCopy.deploy,
								label: commonCopy.unavailable,
							}
					const availability = deploymentStateReady
						? getDeploymentStepAvailability({
								accountAddress,
								busyStepId,
								isOnActiveAppChain,
								prerequisiteLabel,
								step,
							})
						: { disabled: true, reason: deploymentCopy.deploymentStatusUnavailableReason }
					const statusDetailId = stepStatus.detail === undefined ? undefined : `deployment-${step.id}-status-detail`

					return (
						<div className='contract-row' key={step.id}>
							<div className='contract-copy'>
								<div className='contract-topline'>
									{stepStatus.label === undefined || (completedGroup && step.deployed) ? undefined : <Badge tone={stepStatus.badgeTone}>{stepStatus.label}</Badge>}
									<h3>{step.label}</h3>
								</div>
								<p className='address'>{step.address}</p>
								{stepStatus.detail === undefined ? undefined : (
									<p className='detail' id={statusDetailId}>
										{stepStatus.detail}
									</p>
								)}
							</div>
							{step.deployed ? undefined : (
								<TransactionActionButton
									ariaLabel={isBusy ? deploymentCopy.formatDeployingContract(step.label) : deploymentCopy.formatDeployContract(step.label)}
									idleLabel={stepStatus.buttonLabel}
									pendingLabel={deploymentCopy.deploying}
									onClick={() => void onDeploy(step.id)}
									pending={isBusy}
									availability={availability}
									disabledReasonElementId={deploymentStateReady ? statusDetailId : deploymentStatusReasonElementId}
									showDisabledReason={deploymentStateReady && accountAddress !== undefined && prerequisiteLabel === undefined}
								/>
							)}
						</div>
					)
				})}
			</div>
		</SectionBlock>
	)
}
