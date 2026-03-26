import { useState } from 'preact/hooks'
import type { Address, Hash } from 'viem'
import { createSecurityPool, loadMarketDetails } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createSecurityPoolParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultSecurityPoolFormState } from '../lib/marketForm.js'
import type { SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../types/contracts.js'

type UseSecurityPoolCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseSecurityPoolCreationParameters) {
	const [loadingMarketDetails, setLoadingMarketDetails] = useState(false)
	const [marketDetails, setMarketDetails] = useState<MarketDetails | undefined>(undefined)
	const [securityPoolCreating, setSecurityPoolCreating] = useState(false)
	const [securityPoolError, setSecurityPoolError] = useState<string | undefined>(undefined)
	const [securityPoolForm, setSecurityPoolForm] = useState<SecurityPoolFormState>(() => getDefaultSecurityPoolFormState())
	const [securityPoolResult, setSecurityPoolResult] = useState<SecurityPoolCreationResult | undefined>(undefined)

	const loadMarketById = async (marketId: string) => {
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			setSecurityPoolError('Deploy ZoltarQuestionData before loading a market')
			return
		}

		setLoadingMarketDetails(true)
		setSecurityPoolError(undefined)
		try {
			const { questionId } = createSecurityPoolParameters({
				...securityPoolForm,
				marketId,
			})
			const details = await loadMarketDetails(createReadClient(), questionId)
			if (!details.exists) {
				setMarketDetails(undefined)
				setSecurityPoolError('No market found for that ID')
				return
			}

			setMarketDetails(details)
		} catch (error) {
			setMarketDetails(undefined)
			setSecurityPoolError(getErrorMessage(error, 'Failed to load market'))
		} finally {
			setLoadingMarketDetails(false)
		}
	}

	const loadMarket = async () => await loadMarketById(securityPoolForm.marketId)

	const createPool = async () => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			setSecurityPoolError('No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSecurityPoolError('Connect a wallet before creating a security pool')
			return
		}
		if (!hasDeployedStep(deploymentStatuses, 'securityPoolFactory')) {
			setSecurityPoolError('Deploy SecurityPoolFactory before creating a security pool')
			return
		}

		const parameters = createSecurityPoolParameters(securityPoolForm)
		const details = marketDetails ?? (await loadMarketDetails(createReadClient(), parameters.questionId))
		if (!details.exists) {
			setSecurityPoolError('No market found for that ID')
			return
		}
		if (details.marketType !== 'binary') {
			setSecurityPoolError('Security pools can only be deployed for binary markets')
			setMarketDetails(details)
			return
		}

		setSecurityPoolCreating(true)
		setSecurityPoolError(undefined)
		setSecurityPoolResult(undefined)
		try {
			const result = await createSecurityPool(createWriteClient(ethereum, accountAddress), parameters)
			setMarketDetails(details)
			setSecurityPoolResult(result)
			onTransaction(result.deployPoolHash)
			await refreshState()
		} catch (error) {
			setSecurityPoolError(getErrorMessage(error, 'Failed to create security pool'))
		} finally {
			setSecurityPoolCreating(false)
		}
	}

	return {
		loadMarketById,
		loadMarket,
		loadingMarketDetails,
		marketDetails,
		securityPoolCreating,
		securityPoolError,
		securityPoolForm,
		securityPoolResult,
		setSecurityPoolForm,
		createPool,
	}
}
