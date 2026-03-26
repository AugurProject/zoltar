import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createMarket as createMarketTransaction } from '../contracts.js'
import { createWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState } from '../lib/marketForm.js'
import { setSignalValue, updateSignalValue } from '../lib/signals.js'
import type { MarketFormState } from '../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '../types/contracts.js'

type UseMarketCreationParameters = {
	accountAddress: Address | undefined
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useMarketCreation({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseMarketCreationParameters) {
	const marketForm = useSignal<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)

	const createMarket = async () => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			setSignalValue(marketError, 'No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setSignalValue(marketError, 'Connect a wallet before creating a market')
			return
		}
		const marketParameters = createMarketParameters(marketForm.value)
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			setSignalValue(marketError, 'Deploy ZoltarQuestionData before creating a market')
			return
		}

		setSignalValue(marketCreating, true)
		setSignalValue(marketError, undefined)
		setSignalValue(marketResult, undefined)

		try {
			const result = await createMarketTransaction(createWriteClient(ethereum, accountAddress), marketParameters)
			setSignalValue(marketResult, result)
			onTransaction(result.createQuestionHash)
			await refreshState()
		} catch (error) {
			setSignalValue(marketError, getErrorMessage(error, 'Failed to create market'))
		} finally {
			setSignalValue(marketCreating, false)
		}
	}

	const resetMarket = () => {
		setSignalValue(marketForm, getDefaultMarketFormState())
		setSignalValue(marketError, undefined)
		setSignalValue(marketResult, undefined)
	}

	return {
		createMarket,
		marketCreating: marketCreating.value,
		marketError: marketError.value,
		marketForm: marketForm.value,
		marketResult: marketResult.value,
		resetMarket,
		setMarketForm: (updater: (current: MarketFormState) => MarketFormState) => {
			updateSignalValue(marketForm, updater)
		},
	}
}
