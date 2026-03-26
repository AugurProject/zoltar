import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createMarket as createMarketTransaction } from '../contracts.js'
import { createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState } from '../lib/marketForm.js'
import type { MarketFormState } from '../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '../types/contracts.js'

type UseMarketCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useMarketCreation({ accountAddress, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseMarketCreationParameters) {
	const marketForm = useSignal<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)

	const createMarket = async () => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			marketError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			marketError.value = 'Connect a wallet before creating a market'
			return
		}
		const marketParameters = createMarketParameters(marketForm.value)
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			marketError.value = 'Deploy ZoltarQuestionData before creating a market'
			return
		}

		marketCreating.value = true
		marketError.value = undefined
		marketResult.value = undefined

		try {
			onTransactionRequested()
			const result = await createMarketTransaction(createWriteClient(ethereum, accountAddress, { onTransactionSubmitted }), marketParameters)
			marketResult.value = result
			onTransaction(result.createQuestionHash)
			await refreshState()
		} catch (error) {
			marketError.value = getErrorMessage(error, 'Failed to create market')
		} finally {
			marketCreating.value = false
			onTransactionFinished()
		}
	}

	const resetMarket = () => {
		marketForm.value = getDefaultMarketFormState()
		marketError.value = undefined
		marketResult.value = undefined
	}

	return {
		createMarket,
		marketCreating: marketCreating.value,
		marketError: marketError.value,
		marketForm: marketForm.value,
		marketResult: marketResult.value,
		resetMarket,
		setMarketForm: (updater: (current: MarketFormState) => MarketFormState) => {
			marketForm.value = updater(marketForm.value)
		},
	}
}
