import { useState } from 'preact/hooks'
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
	refreshState: () => Promise<void>
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseDeploymentFlowParameters) {
	const [busyStepId, setBusyStepId] = useState<DeploymentStepId | undefined>(undefined)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

	const deployStep = async (stepId: DeploymentStepId) => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			setErrorMessage('No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setErrorMessage('Connect a wallet before deploying')
			return
		}

		const latestStatuses = await loadDeploymentStatuses(createReadClient())
		const stepIndex = latestStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(latestStatuses, stepIndex)
		if (prerequisiteLabel !== undefined) {
			setErrorMessage(`Deploy ${ prerequisiteLabel } first`)
			return
		}

		const step = latestStatuses[stepIndex]
		if (step === undefined || step.deployed) {
			await refreshState()
			return
		}

		setBusyStepId(step.id)
		setErrorMessage(undefined)

		try {
			const client = createWriteClient(ethereum, accountAddress)
			const hash = await step.deploy(client)
			onTransaction(hash)
			await refreshState()
		} catch (error) {
			setErrorMessage(getErrorMessage(error, `Failed to deploy ${ step.label }`))
		} finally {
			setBusyStepId(undefined)
		}
	}

	const deployNextMissing = async () => {
		const nextMissing = findNextDeployableStep(deploymentStatuses)
		if (nextMissing === undefined) return
		await deployStep(nextMissing.id)
	}

	return {
		busyStepId,
		deployNextMissing,
		deployStep,
		errorMessage,
	}
}
