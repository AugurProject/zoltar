import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { loadDeploymentStatuses } from '../contracts.js'
import { getInjectedEthereum } from '../injectedEthereum.js'
import { createReadClient, createWriteClient } from '../lib/clients.js'
import { findNextDeployableStep, getPrerequisiteLabel } from '../lib/deployment.js'
import { getErrorMessage } from '../lib/errors.js'
import type { DeploymentStatus, DeploymentStepId } from '../types/contracts.js'

type UseDeploymentFlowParameters = {
	accountAddress: Address | null
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useDeploymentFlow({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseDeploymentFlowParameters) {
	const [busyStepId, setBusyStepId] = useState<DeploymentStepId | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const deployStep = async (stepId: DeploymentStepId) => {
		const ethereum = getInjectedEthereum()
		if (ethereum === undefined) {
			setErrorMessage('No injected wallet found')
			return
		}
		if (accountAddress === null) {
			setErrorMessage('Connect a wallet before deploying')
			return
		}

		const latestStatuses = await loadDeploymentStatuses(createReadClient())
		const stepIndex = latestStatuses.findIndex(step => step.id === stepId)
		if (stepIndex === -1) return

		const prerequisiteLabel = getPrerequisiteLabel(latestStatuses, stepIndex)
		if (prerequisiteLabel !== null) {
			setErrorMessage(`Deploy ${ prerequisiteLabel } first`)
			return
		}

		const step = latestStatuses[stepIndex]
		if (step === undefined || step.deployed) {
			await refreshState()
			return
		}

		setBusyStepId(step.id)
		setErrorMessage(null)

		try {
			const client = createWriteClient(ethereum, accountAddress)
			const hash = await step.deploy(client)
			onTransaction(hash)
			await refreshState()
		} catch (error) {
			setErrorMessage(getErrorMessage(error, `Failed to deploy ${ step.label }`))
		} finally {
			setBusyStepId(null)
		}
	}

	const deployNextMissing = async () => {
		const nextMissing = findNextDeployableStep(deploymentStatuses)
		if (nextMissing === null) return
		await deployStep(nextMissing.id)
	}

	return {
		busyStepId,
		deployNextMissing,
		deployStep,
		errorMessage,
		setErrorMessage,
	}
}
