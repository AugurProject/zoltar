import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createWalletWriteClient } from '../lib/clients.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { formatWriteErrorMessage } from '../lib/errors.js'
import { createDeploymentSuccessPresentation, createDeploymentTransactionIntent } from '../lib/transactionPresentations.js'
import { requireWallet } from '../lib/walletGuard.js'
import { assertActiveWallet } from '../lib/walletGuards.js'
import type { WriteOperationsParameters } from '../types/app.js'
import type { DeploymentStatus, DeploymentStepId } from '../types/contracts.js'

type UseDeploymentFlowParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	setDeploymentStatuses: (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => void
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, setDeploymentStatuses }: UseDeploymentFlowParameters) {
	const busyStepId = useSignal<DeploymentStepId | undefined>(undefined)
	const deploymentFeedback = useSignal<ActionFeedback<DeploymentStepId | 'deployNextMissing'> | undefined>(undefined)
	const errorMessage = useSignal<string | undefined>(undefined)

	const deployStep = async (stepId: DeploymentStepId, feedbackAction: DeploymentStepId | 'deployNextMissing' = stepId) => {
		if (
			!requireWallet(
				accountAddress,
				message => {
					const resolvedMessage = message ?? 'Connect wallet to continue.'
					errorMessage.value = resolvedMessage
					deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', resolvedMessage)
				},
				'deploying',
			)
		)
			return

		const stepIndex = deploymentStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(deploymentStatuses, stepIndex)
		if (prerequisiteLabel !== undefined) {
			const message = `Deploy ${prerequisiteLabel} first`
			errorMessage.value = message
			deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment blocked', message)
			return
		}

		const step = deploymentStatuses[stepIndex]
		if (step === undefined || step.deployed) return

		busyStepId.value = step.id
		errorMessage.value = undefined
		deploymentFeedback.value = createPendingActionFeedback(feedbackAction, `Deploying ${step.label}`)

		try {
			await assertActiveWallet(accountAddress)
			onTransactionRequested(createDeploymentTransactionIntent(step.label))
			const client = createWalletWriteClient(accountAddress, { onTransactionPrepared, onTransactionSubmitted })
			const hash = await step.deploy(client)
			setDeploymentStatuses(current => current.map(currentStep => (currentStep.id === step.id ? { ...currentStep, deployed: true } : currentStep)))
			deploymentFeedback.value = createSuccessActionFeedback(feedbackAction, `${step.label} deployed`, hash)
			onTransactionPresented(createDeploymentSuccessPresentation(step.label, hash))
		} catch (error) {
			const message = formatWriteErrorMessage(error, `Failed to deploy ${step.label}`)
			onTransactionFailed?.(message)
			deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', message)
		} finally {
			busyStepId.value = undefined
			onTransactionFinished()
		}
	}

	const deployNextMissing = async () => {
		const nextMissing = findNextDeployableStep(deploymentStatuses)
		if (nextMissing === undefined) return
		await deployStep(nextMissing.id, 'deployNextMissing')
	}

	return {
		busyStepId: busyStepId.value,
		deploymentFeedback: deploymentFeedback.value,
		deployNextMissing,
		deployStep,
		errorMessage: errorMessage.value,
	}
}
