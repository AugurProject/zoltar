import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { loadDeploymentStatuses } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { getErrorMessage } from '../lib/errors.js'
import { setSignalValue } from '../lib/signals.js'
import type { DeploymentStatus, DeploymentStepId } from '../types/contracts.js'

type UseDeploymentFlowParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseDeploymentFlowParameters) {
	const busyStepId = useSignal<DeploymentStepId | undefined>(undefined)
	const errorMessage = useSignal<string | undefined>(undefined)

	const deployStep = async (stepId: DeploymentStepId) => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			setSignalValue(errorMessage, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(errorMessage, 'Connect a wallet before deploying')
			return
		}

		const latestStatuses = await loadDeploymentStatuses(createReadClient())
		const stepIndex = latestStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(latestStatuses, stepIndex)
		if (prerequisiteLabel !== undefined) {
			setSignalValue(errorMessage, `Deploy ${ prerequisiteLabel } first`)
			return
		}

		const step = latestStatuses[stepIndex]
		if (step === undefined || step.deployed) {
			await refreshState()
			return
		}

		setSignalValue(busyStepId, step.id)
		setSignalValue(errorMessage, undefined)

		try {
			const client = createWriteClient(ethereum, accountAddress)
			const hash = await step.deploy(client)
			onTransaction(hash)
			await refreshState()
		} catch (error) {
			setSignalValue(errorMessage, getErrorMessage(error, `Failed to deploy ${ step.label }`))
		} finally {
			setSignalValue(busyStepId, undefined)
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
