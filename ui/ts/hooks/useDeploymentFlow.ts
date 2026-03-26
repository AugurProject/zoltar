import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadDeploymentStatuses } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { getErrorMessage } from '../lib/errors.js'
import type { DeploymentStatus, DeploymentStepId } from '../types/contracts.js'

type UseDeploymentFlowParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseDeploymentFlowParameters) {
	const busyStepId = useSignal<DeploymentStepId | undefined>(undefined)
	const errorMessage = useSignal<string | undefined>(undefined)

	const deployStep = async (stepId: DeploymentStepId) => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			errorMessage.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			errorMessage.value = 'Connect a wallet before deploying'
			return
		}

		const latestStatuses = await loadDeploymentStatuses(createReadClient())
		const stepIndex = latestStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(latestStatuses, stepIndex)
		if (prerequisiteLabel !== undefined) {
			errorMessage.value = `Deploy ${ prerequisiteLabel } first`
			return
		}

		const step = latestStatuses[stepIndex]
		if (step === undefined || step.deployed) {
			await refreshState()
			return
		}

		busyStepId.value = step.id
		errorMessage.value = undefined

		try {
			onTransactionRequested()
			const client = createWriteClient(ethereum, accountAddress, { onTransactionSubmitted })
			const hash = await step.deploy(client)
			onTransaction(hash)
			await refreshState()
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
