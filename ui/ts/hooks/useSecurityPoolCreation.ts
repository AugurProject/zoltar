import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createSecurityPool, loadMarketDetails } from '../contracts.js'
import { createReadClient, createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createSecurityPoolParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultSecurityPoolFormState } from '../lib/marketForm.js'
import type { SecurityPoolFormState } from '../types/app.js'
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '../types/contracts.js'

type UseSecurityPoolCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseSecurityPoolCreationParameters) {
	const loadingMarketDetails = useSignal(false)
	const marketDetailsLoadCount = useSignal(0)
	const marketDetailsRequestId = useSignal(0)
	const marketDetails = useSignal<MarketDetails | undefined>(undefined)
	const securityPoolCreating = useSignal(false)
	const securityPoolError = useSignal<string | undefined>(undefined)
	const securityPoolForm = useSignal<SecurityPoolFormState>(getDefaultSecurityPoolFormState())
	const securityPoolResult = useSignal<SecurityPoolCreationResult | undefined>(undefined)

	const loadMarketById = async (marketId: string) => {
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			securityPoolError.value = 'Deploy ZoltarQuestionData before loading a market'
			return
		}

		const requestId = marketDetailsRequestId.value + 1
		marketDetailsRequestId.value = requestId
		marketDetailsLoadCount.value += 1
		loadingMarketDetails.value = true
		securityPoolError.value = undefined
		try {
			const { questionId } = createSecurityPoolParameters({
				...securityPoolForm.value,
				marketId,
			})
			const details = await loadMarketDetails(createReadClient(), questionId)
			if (requestId !== marketDetailsRequestId.value) return
			if (!details.exists) {
				marketDetails.value = undefined
				securityPoolError.value = 'No market found for that ID'
				return
			}

			marketDetails.value = details
		} catch (error) {
			if (requestId !== marketDetailsRequestId.value) return
			marketDetails.value = undefined
			securityPoolError.value = getErrorMessage(error, 'Failed to load market')
		} finally {
			marketDetailsLoadCount.value = Math.max(0, marketDetailsLoadCount.value - 1)
			loadingMarketDetails.value = marketDetailsLoadCount.value > 0
		}
	}

	const loadMarket = async () => await loadMarketById(securityPoolForm.value.marketId)

	const createPool = async () => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			securityPoolError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			securityPoolError.value = 'Connect a wallet before creating a security pool'
			return
		}
		if (!hasDeployedStep(deploymentStatuses, 'securityPoolFactory')) {
			securityPoolError.value = 'Deploy SecurityPoolFactory before creating a security pool'
			return
		}
		if (securityPoolCreating.value) {
			securityPoolError.value = 'Security pool creation already in progress'
			return
		}

		securityPoolCreating.value = true
		securityPoolError.value = undefined
		securityPoolResult.value = undefined
		try {
			const parameters = createSecurityPoolParameters(securityPoolForm.value)
			const details = marketDetails.value?.questionId === parameters.questionId.toString() ? marketDetails.value : await loadMarketDetails(createReadClient(), parameters.questionId)
			if (!details.exists) {
				securityPoolError.value = 'No market found for that ID'
				return
			}
			if (details.marketType !== 'binary') {
				securityPoolError.value = 'Security pools can only be deployed for binary markets'
				marketDetails.value = details
				return
			}

			onTransactionRequested()
			const result = await createSecurityPool(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), parameters)
			marketDetails.value = details
			securityPoolResult.value = result
			onTransaction(result.deployPoolHash)
			await refreshState()
		} catch (error) {
			securityPoolError.value = getErrorMessage(error, 'Failed to create security pool')
		} finally {
			securityPoolCreating.value = false
			onTransactionFinished()
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
			securityPoolForm.value = updater(securityPoolForm.value)
		},
		createPool,
	}
}
