import { useSignal } from '@preact/signals'
import { useFormState } from './useFormState.js'
import type { Address, Hash } from 'viem'
import { createMarket as createMarketTransaction } from '../contracts.js'
import { createWalletWriteClient } from '../lib/clients.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../lib/actionFeedback.js'
import type { ActionFeedback } from '../lib/actionFeedback.js'
import { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createMarketCreationWarningPresentation } from '../lib/transactionPresentations.js'
import { runWriteAction } from '../lib/writeAction.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState } from '../lib/marketForm.js'
import type { MarketFormState, WriteOperationsParameters } from '../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '../types/contracts.js'
import { useZoltarOperations } from './useZoltarOperations.js'

type UseMarketCreationParameters = {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	activeZoltarView: 'create' | 'fork' | 'migrate' | 'questions'
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	environmentRefreshKey: number
	onTransactionFailed?: WriteOperationsParameters['onTransactionFailed']
	onTransactionFinished: () => void
	onTransactionPresented: WriteOperationsParameters['onTransactionPresented']
	onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']
	onTransactionRequested: WriteOperationsParameters['onTransactionRequested']
	onTransactionSubmitted: (hash: Hash) => void
	refreshState: () => Promise<void>
}

export function useMarketCreation({
	accountAddress,
	activeUniverseId,
	activeZoltarView,
	autoLoadInitialData,
	deploymentStatuses,
	environmentRefreshKey,
	onTransactionFailed,
	onTransactionFinished,
	onTransactionPresented,
	onTransactionPrepared,
	onTransactionRequested,
	onTransactionSubmitted,
	refreshState,
}: UseMarketCreationParameters) {
	const zoltar = useZoltarOperations({ accountAddress, activeUniverseId, activeZoltarView, autoLoadInitialData, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState })
	const { state: marketForm, setState: setMarketForm } = useFormState<MarketFormState>(getDefaultMarketFormState())
	const marketCreating = useSignal(false)
	const marketResult = useSignal<MarketCreationResult | undefined>(undefined)
	const marketError = useSignal<string | undefined>(undefined)
	const marketFeedback = useSignal<ActionFeedback<'createMarket'> | undefined>(undefined)

	const createMarket = async () => {
		marketResult.value = undefined
		marketFeedback.value = createPendingActionFeedback('createMarket', 'Creating question')
		await runWriteAction(
			{
				accountAddress,
				missingWalletMessage: 'Connect a wallet before creating a question',
				onRefreshError: (message, hash) => {
					marketFeedback.value = createWarningActionFeedback('createMarket', 'Question created', message, hash)
					const result = marketResult.value
					if (result !== undefined) onTransactionPresented(createMarketCreationWarningPresentation(result, message))
				},
				onTransactionRequested: () => {
					marketCreating.value = true
					onTransactionRequested(createMarketCreationTransactionIntent())
				},
				onTransactionFinished: () => {
					marketCreating.value = false
					onTransactionFinished()
				},
				onTransactionFailed,
				onWriteError: message => {
					marketFeedback.value = createErrorActionFeedback('createMarket', 'Question creation failed', message)
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
				const result = await createMarketTransaction(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), createMarketParameters(marketForm.value))
				return { ...result, hash: result.createQuestionHash }
			},
			'Failed to create question',
			result => {
				marketResult.value = result
				marketFeedback.value = createSuccessActionFeedback('createMarket', 'Question created', result.hash)
				onTransactionPresented(createMarketCreationSuccessPresentation(result))
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
		marketFeedback: marketFeedback.value,
		marketCreating: marketCreating.value,
		marketError: marketError.value,
		marketForm: marketForm.value,
		marketResult: marketResult.value,
		resetMarket,
		setMarketForm,
	}
}
