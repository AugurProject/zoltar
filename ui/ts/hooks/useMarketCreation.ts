import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { createMarket as createMarketTransaction } from '../contracts.js'
import { createWalletWriteClient, getRequiredInjectedEthereum } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState } from '../lib/marketForm.js'
import type { MarketFormState } from '../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '../types/contracts.js'
import { useZoltarOperations } from './useZoltarOperations.js'

type UseMarketCreationParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	onTransaction: (hash: Hash) => void
	onTransactionFinished: () => void
	onTransactionRequested: () => void
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useMarketCreation({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState }: UseMarketCreationParameters) {
	const zoltar = useZoltarOperations({ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, onTransaction, onTransactionFinished, onTransactionRequested, onTransactionSubmitted, refreshState })
	const marketForm = useSignal<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)

	const createMarket = async () => {
		try {
			getRequiredInjectedEthereum()
		} catch {
			marketError.value = 'No injected wallet found'
			return
		}
		if (accountAddress === undefined) {
			marketError.value = 'Connect a wallet before creating a question'
			return
		}
		const marketParameters = createMarketParameters(marketForm.value)
		if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
			marketError.value = 'Deploy ZoltarQuestionData before creating a question'
			return
		}

		marketCreating.value = true
		marketError.value = undefined
		marketResult.value = undefined

		try {
			onTransactionRequested()
			const result = await createMarketTransaction(createWalletWriteClient(accountAddress, { onTransactionSubmitted }), marketParameters)
			marketResult.value = result
			zoltar.setZoltarForkQuestionId(result.questionId)
			onTransaction(result.createQuestionHash)
			await refreshState()
			await zoltar.loadZoltarQuestions()
		} catch (error) {
			marketError.value = getErrorMessage(error, 'Failed to create question')
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
		...zoltar,
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
