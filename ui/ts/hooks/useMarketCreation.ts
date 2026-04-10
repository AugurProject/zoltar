import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import type { Address, Hash } from 'viem'
import { createMarket as createMarketTransaction } from '../contracts.js'
import { createWalletWriteClient } from '../lib/clients.js'
import { runWriteAction } from '../lib/writeAction.js'
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
	const { state: marketForm, setState: setMarketForm } = useFormState<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)

	const createMarket = async () => {
		marketResult.value = undefined
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before creating a question',
				onTransaction,
				onTransactionRequested: () => {
					marketCreating.value = true
					onTransactionRequested()
				},
				onTransactionFinished: () => {
					marketCreating.value = false
					onTransactionFinished()
				},
				refreshState: async () => {
					await refreshState()
					await zoltar.loadZoltarQuestions()
				},
				setErrorMessage: message => {
					marketError.value = message
				},
			},
			async walletAddress => {
				if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) throw new Error('Deploy ZoltarQuestionData before creating a question')
				const result = await createMarketTransaction(createWalletWriteClient(walletAddress, { onTransactionSubmitted }), createMarketParameters(marketForm.value))
				return { ...result, hash: result.createQuestionHash }
			},
			'Failed to create question',
			result => {
				marketResult.value = result
				zoltar.setZoltarForkQuestionId(result.questionId)
			},
		)
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
		setMarketForm,
	}
}
