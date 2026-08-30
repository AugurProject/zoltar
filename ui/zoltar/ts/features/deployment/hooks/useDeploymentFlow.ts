import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { formatWriteErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createDeploymentSuccessPresentation, createDeploymentTransactionIntent } from '../../zoltarTransactionPresentations.js'
import { requireWallet } from '@zoltar/ui-core-shared/lib/requireWalletConnection.js'
import { assertActiveWallet } from '@zoltar/ui-core-shared/lib/assertActiveWallet.js'
import type { TransactionLifecycleParameters } from '../../../types/app.js'
import type { DeploymentStatus, DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'
import { assertDeploymentStepRuntimeCode } from '../../../protocol/deployment.js'
import { readWithRpcStateRetries, type RpcStateRetryWait } from '../../../protocol/core.js'
import { createActiveEnvironmentGuard } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

type UseDeploymentFlowParameters = TransactionLifecycleParameters & {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	environmentRefreshKey: number
	setDeploymentStatuses: (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => void
	rpcStateRetryWait?: RpcStateRetryWait
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, rpcStateRetryWait, setDeploymentStatuses }: UseDeploymentFlowParameters) {
	const busyStepId = useSignal<DeploymentStepId | undefined>(undefined)
	const deploymentFeedback = useSignal<ActionFeedback<DeploymentStepId | 'deployNextMissing'> | undefined>(undefined)
	const deployNextMissingPending = useSignal(false)
	const errorMessage = useSignal<string | undefined>(undefined)
	useEffect(() => {
		busyStepId.value = undefined
		deploymentFeedback.value = undefined
		deployNextMissingPending.value = false
		errorMessage.value = undefined
	}, [environmentRefreshKey])

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
		const environmentGuard = createActiveEnvironmentGuard()

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
			if (!environmentGuard.isCurrent()) return
			if (step.expectedRuntimeCodeHash === undefined && !step.trustedSimulationCodePresence) throw new Error(`Exact runtime-code verification is unavailable for ${step.label} on the active network`)
			const client = createWalletWriteClient(accountAddress, { onTransactionPrepared, onTransactionSubmitted })
			const existingCode = await client.getCode({ address: step.address })
			if (!environmentGuard.isCurrent()) return
			if (assertDeploymentStepRuntimeCode(step, existingCode)) {
				setDeploymentStatuses(current => current.map(currentStep => (currentStep.id === step.id ? { ...currentStep, deployed: true } : currentStep)))
				deploymentFeedback.value = undefined
				return
			}
			onTransactionRequested(createDeploymentTransactionIntent(step.label))
			const hash = await step.deploy(client)
			if (!environmentGuard.isCurrent()) return
			const code = await readWithRpcStateRetries(
				() => client.getCode({ address: step.address }),
				candidate => candidate !== undefined && candidate !== '0x',
				rpcStateRetryWait,
			)
			if (!environmentGuard.isCurrent()) return
			if (!assertDeploymentStepRuntimeCode(step, code)) {
				const message = 'Deployment verification failed: no contract code was found at the expected address. Check the selected network and retry.'
				errorMessage.value = message
				onTransactionFailed?.(message)
				deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', message)
				return
			}
			setDeploymentStatuses(current => current.map(currentStep => (currentStep.id === step.id ? { ...currentStep, deployed: true } : currentStep)))
			deploymentFeedback.value = createSuccessActionFeedback(feedbackAction, `${step.label} deployed`, hash)
			onTransactionPresented(createDeploymentSuccessPresentation(step.label, hash))
		} catch (error) {
			if (!environmentGuard.isCurrent()) {
				errorMessage.value = undefined
				deploymentFeedback.value = undefined
				return
			}
			const message = formatWriteErrorMessage(error, `Failed to deploy ${step.label}`)
			errorMessage.value = message
			onTransactionFailed?.(message)
			deploymentFeedback.value = createErrorActionFeedback(feedbackAction, 'Deployment failed', message)
		} finally {
			if (environmentGuard.isCurrent()) {
				busyStepId.value = undefined
				onTransactionFinished()
			}
		}
	}

	const deployNextMissing = async () => {
		if (deployNextMissingPending.value) return
		const environmentGuard = createActiveEnvironmentGuard()
		deployNextMissingPending.value = true
		try {
			const nextMissing = findNextDeployableStep(deploymentStatuses)
			if (nextMissing === undefined) return
			await deployStep(nextMissing.id, 'deployNextMissing')
		} finally {
			if (environmentGuard.isCurrent()) deployNextMissingPending.value = false
		}
	}

	return {
		busyStepId: busyStepId.value,
		deploymentFeedback: deploymentFeedback.value,
		deployNextMissing,
		deployNextMissingPending: deployNextMissingPending.value,
		deployStep,
		errorMessage: errorMessage.value,
	}
}
