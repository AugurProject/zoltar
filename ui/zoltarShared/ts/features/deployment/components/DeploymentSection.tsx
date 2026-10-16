import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as userMessagesCopy from '@zoltar/ui-core-shared/copy/userMessages.js'
import { useHasInjectedWallet } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import * as deploymentCopy from '../../../copy/deployment.js'
import type { BadgeTone, DeploymentSectionProps } from '../../types.js'
import { DeploymentStepList, type DeploymentStepRow } from '@zoltar/ui-core-shared/components/DeploymentStepList.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { getDeploymentStepAvailability, getPrerequisiteLabel } from '../lib/deployment.js'

type StepStatus = {
	badgeTone: BadgeTone
	label: string | undefined
	detail?: string
	buttonLabel: string
}

function getStepStatus(stepDeployed: boolean, prerequisiteLabel: string | undefined, isBusy: boolean, accountAddress: string | undefined, isOnActiveAppChain: boolean, hasInjectedWallet: boolean | undefined): StepStatus {
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
			// The pending button already reads "Deploying…"; a badge would state it a third time.
			label: undefined,
			buttonLabel: deploymentCopy.deploying,
		}

	if (prerequisiteLabel === undefined) {
		if (accountAddress === undefined)
			return {
				badgeTone: 'pending',
				// Without a browser wallet, connecting cannot help, so the step says what is missing instead.
				detail: hasInjectedWallet === false ? userMessagesCopy.walletInstallationRequired : commonCopy.walletConnectionRequired,
				label: commonCopy.notDeployed,
				buttonLabel: commonCopy.deploy,
			}
		if (!isOnActiveAppChain)
			return {
				badgeTone: 'pending',
				label: commonCopy.notDeployed,
				buttonLabel: commonCopy.deploy,
			}
		return {
			badgeTone: 'pending',
			detail: deploymentCopy.deploymentReadyStatus,
			label: commonCopy.notDeployed,
			buttonLabel: commonCopy.deploy,
		}
	}

	// Waiting on an earlier contract is the normal deployment order, not an error, so the badge stays neutral.
	return {
		badgeTone: 'muted',
		detail: deploymentCopy.formatPrerequisiteDetail(prerequisiteLabel),
		label: deploymentCopy.waiting,
		buttonLabel: commonCopy.deploy,
	}
}

export function DeploymentSection({ title, completedGroup = false, steps, allSteps, accountAddress, busyStepId, deploymentStateReady, deploymentStatusReasonElementId, isOnActiveAppChain, onDeploy }: DeploymentSectionProps) {
	const hasInjectedWallet = useHasInjectedWallet()
	return (
		<SectionBlock className='contract-panel' title={completedGroup ? undefined : title} variant='plain'>
			<DeploymentStepList
				steps={steps.map((step): DeploymentStepRow => {
					const stepIndex = allSteps.findIndex(candidate => candidate.id === step.id)
					const prerequisiteLabel = stepIndex === -1 ? undefined : getPrerequisiteLabel(allSteps, stepIndex)
					const isBusy = busyStepId === step.id
					const stepStatus = deploymentStateReady
						? getStepStatus(step.deployed, prerequisiteLabel, isBusy, accountAddress, isOnActiveAppChain, hasInjectedWallet)
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
					// Without a wallet the status detail already carries the wallet reason unless a prerequisite occupies it; with a wallet the detail explains a prerequisite.
					const showInlineDisabledReason = deploymentStateReady && (prerequisiteLabel === undefined ? accountAddress !== undefined : accountAddress === undefined)
					// A deployed step keeps its button in place, disabled and labelled with the result, so the button carries the status instead of a badge.
					const deployedStep = deploymentStateReady && step.deployed
					let ariaLabel = appCopy.formatDeployContract(step.label)
					if (deployedStep) ariaLabel = deploymentCopy.formatContractDeployed(step.label)
					else if (isBusy) ariaLabel = appCopy.formatDeployingContract(step.label)
					return {
						action: (
							<TransactionActionButton
								ariaLabel={ariaLabel}
								idleLabel={stepStatus.buttonLabel}
								pendingLabel={deploymentCopy.deploying}
								onClick={() => void onDeploy(step.id)}
								pending={isBusy}
								availability={availability}
								disabledReasonElementId={deploymentStateReady ? statusDetailId : deploymentStatusReasonElementId}
								showDisabledReason={showInlineDisabledReason && !deployedStep}
							/>
						),
						address: step.address,
						badge: stepStatus.label === undefined || deployedStep ? undefined : { label: stepStatus.label, tone: stepStatus.badgeTone },
						detail: stepStatus.detail,
						detailId: statusDetailId,
						key: step.id,
						label: step.label,
					}
				})}
			/>
		</SectionBlock>
	)
}
