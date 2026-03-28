import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { getErrorMessage } from '../lib/errors.js'
import type { DeploymentStatus, DeploymentStepId } from '../types/contracts.js'

type UseDeploymentFlowParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	setDeploymentStatuses: (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => void
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: (options?: { loadDeploymentStatuses?: boolean }) => Promise<void>
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState, setDeploymentStatuses }: UseDeploymentFlowParameters) {
	const busyStepId = useSignal<DeploymentStepId | undefined>(undefined)
	const errorMessage = useSignal<string | undefined>(undefined)

	const deployStep = async (stepId: DeploymentStepId) => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			errorMessage.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			errorMessage.value = 'Connect a wallet before deploying'
			return
		}

		const stepIndex = deploymentStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(deploymentStatuses, stepIndex)
		if (prerequisiteLabel !== undefined) {
			errorMessage.value = `Deploy ${ prerequisiteLabel } first`
			return
		}

		const step = deploymentStatuses[stepIndex]
		if (step === undefined || step.deployed) {
			return
		}

		busyStepId.value = step.id
		errorMessage.value = undefined

		try {
			onTransactionRequested()
			const client = createWalletWriteClient(accountAddress, { onTransactionSubmitted })
			const hash = await step.deploy(client)
			onTransaction(hash)
			setDeploymentStatuses(current => current.map(currentStep => (currentStep.id === step.id ? { ...currentStep, deployed: true } : currentStep)))
			await refreshState({ loadDeploymentStatuses: false })
		} catch (error) {
			errorMessage.value = getErrorMessage(error, `Failed to deploy ${ step.label }`)
		} finally {
			busyStepId.value = undefined
			onTransactionFinished()
		}
	}

	const deployNextMissing = async () => {
		const nextMissing = findNextDeployableStep(deploymentStatuses)
		if (nextMissing === undefined) return
		await deployStep(nextMissing.id)
	}

	return {
		busyStepId: busyStepId.value,
		deployNextMissing,
		deployStep,
		errorMessage: errorMessage.value,
	}
}
