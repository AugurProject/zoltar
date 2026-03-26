import { useState } from 'preact/hooks'
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
	refreshState: () => Promise<void>
}

export function useMarketCreation({ accountAddress, deploymentStatuses, onTransaction, refreshState }: UseMarketCreationParameters) {
	const [marketForm, setMarketForm] = useState<MarketFormState>(() => getDefaultMarketFormState())
	const [marketCreating, setMarketCreating] = useState(false)
	const [marketResult, setMarketResult] = useState<MarketCreationResult | undefined>(undefined)
	const [marketError, setMarketError] = useState<string | undefined>(undefined)

	const createMarket = async () => {
		let ethereum
		try {
			ethereum = getRequiredInjectedEthereum()
		} catch {
			setMarketError('No injected wallet found')
			return
		}
		if (accountAddress === undefined) {
			setMarketError('Connect a wallet before creating a market')
			return
		}
		const marketParameters = createMarketParameters(marketForm)
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			setMarketError('Deploy ZoltarQuestionData before creating a market')
			return
		}

		setMarketCreating(true)
		setMarketError(undefined)
		setMarketResult(undefined)

		try {
			const result = await createMarketTransaction(createWriteClient(ethereum, accountAddress), marketParameters)
			setMarketResult(result)
			onTransaction(result.createQuestionHash)
			await refreshState()
		} catch (error) {
			setMarketError(getErrorMessage(error, 'Failed to create market'))
		} finally {
			setMarketCreating(false)
		}
	}

	const resetMarket = () => {
		setMarketForm(getDefaultMarketFormState())
		setMarketError(undefined)
		setMarketResult(undefined)
	}

	return {
		createMarket,
		marketCreating,
		marketError,
		marketForm,
		marketResult,
		resetMarket,
		setMarketForm,
	}
}
