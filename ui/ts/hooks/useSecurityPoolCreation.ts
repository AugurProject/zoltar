import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createSecurityPool, loadMarketDetails } from '../contracts.js'
import { createReadClient, createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createSecurityPoolParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultSecurityPoolFormState } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
import type { SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../types/contracts.js'

type UseSecurityPoolCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseSecurityPoolCreationParameters) {
	const loadingMarketDetails = useSignal(false)
	const marketDetails = useSignal<MarketDetails | undefined>(undefined)
	const securityPoolCreating = useSignal(false)
	const securityPoolError = useSignal<string | undefined>(undefined)
	const securityPoolForm = useSignal<SecurityPoolFormState>(getDefaultSecurityPoolFormState())
	const securityPoolResult = useSignal<SecurityPoolCreationResult | undefined>(undefined)

	const loadMarketById = async (marketId: string) => {
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			setSignalValue(securityPoolError, 'Deploy ZoltarQuestionData before loading a market')
			return
		}

		setSignalValue(loadingMarketDetails, true)
		setSignalValue(securityPoolError, undefined)
		try {
			const { questionId } = createSecurityPoolParameters({
				...securityPoolForm.value,
				marketId,
			})
			const details = await loadMarketDetails(createReadClient(), questionId)
			if (!details.exists) {
				setSignalValue(marketDetails, undefined)
				setSignalValue(securityPoolError, 'No market found for that ID')
				return
			}

			setSignalValue(marketDetails, details)
		} catch (error) {
			setSignalValue(marketDetails, undefined)
			setSignalValue(securityPoolError, getErrorMessage(error, 'Failed to load market'))
		} finally {
			setSignalValue(loadingMarketDetails, false)
		}
	}

	const loadMarket = async () => await loadMarketById(securityPoolForm.value.marketId)

	const createPool = async () => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			setSignalValue(securityPoolError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(securityPoolError, 'Connect a wallet before creating a security pool')
			return
		}
		if (!hasDeployedStep(deploymentStatuses, 'securityPoolFactory')) {
			setSignalValue(securityPoolError, 'Deploy SecurityPoolFactory before creating a security pool')
			return
		}

		const parameters = createSecurityPoolParameters(securityPoolForm.value)
		const details = marketDetails.value ?? (await loadMarketDetails(createReadClient(), parameters.questionId))
		if (!details.exists) {
			setSignalValue(securityPoolError, 'No market found for that ID')
			return
		}
		if (details.marketType !== 'binary') {
			setSignalValue(securityPoolError, 'Security pools can only be deployed for binary markets')
			setSignalValue(marketDetails, details)
			return
		}

		setSignalValue(securityPoolCreating, true)
		setSignalValue(securityPoolError, undefined)
		setSignalValue(securityPoolResult, undefined)
		try {
			const result = await createSecurityPool(createWriteClient(ethereum, accountAddress), parameters)
			setSignalValue(marketDetails, details)
			setSignalValue(securityPoolResult, result)
			onTransaction(result.deployPoolHash)
			await refreshState()
		} catch (error) {
			setSignalValue(securityPoolError, getErrorMessage(error, 'Failed to create security pool'))
		} finally {
			setSignalValue(securityPoolCreating, false)
		}
	}

	return {
		loadMarketById,
		loadMarket,
		loadingMarketDetails: loadingMarketDetails.value,
		marketDetails: marketDetails.value,
		securityPoolCreating: securityPoolCreating.value,
		securityPoolError: securityPoolError.value,
		securityPoolForm: securityPoolForm.value,
		securityPoolResult: securityPoolResult.value,
		setSecurityPoolForm: (updater: (current: SecurityPoolFormState) => SecurityPoolFormState) => {
			updateSignalValue(securityPoolForm, updater)
		},
		createPool,
	}
}
