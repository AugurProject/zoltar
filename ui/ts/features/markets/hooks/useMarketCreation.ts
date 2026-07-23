import { useSignal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { createMarket as createMarketTransaction } from '../../../protocol/index.js'
import { createWalletWriteClient } from '../../../lib/clients.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '../../../lib/actionFeedback.js'
import type { ActionFeedback } from '../../../lib/actionFeedback.js'
import { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createMarketCreationWarningPresentation } from '../../transactionPresentations.js'
import { refreshWalletStateOnly } from '../../../lib/refreshState.js'
import { runWriteAction } from '../../../lib/writeAction.js'
import { createMarketParameters, hasDeployedStep } from '../lib/marketCreation.js'
import { getDefaultMarketFormState } from '../lib/marketForm.js'
import type { MarketFormState, WriteOperationsParameters } from '../../../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '../../../types/contracts.js'
import { useZoltarOperations } from '../../universes/hooks/useZoltarOperations.js'

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
	refreshState: WriteOperationsParameters['refreshState']
}

export type UseMarketCreationDependencies = {
	createMarket: (accountAddress: Address, callbacks: { onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared']; onTransactionSubmitted: (hash: Hash) => void }, parameters: ReturnType<typeof createMarketParameters>) => Promise<MarketCreationResult & { hash: Hash }>
}

const defaultUseMarketCreationDependencies: UseMarketCreationDependencies = {
	createMarket: async (accountAddress, callbacks, parameters) => {
		const result = await createMarketTransaction(createWalletWriteClient(accountAddress, callbacks), parameters)
		return { ...result, hash: result.createQuestionHash }
	},
}

const QUESTION_DRAFT_STORAGE_PREFIX = 'zoltar.questionDraft'

type KeyedValue<T> = {
	storageKey: string | undefined
	value: T
}

function getQuestionDraftStorageKey(accountAddress: Address | undefined, activeUniverseId: bigint) {
	if (accountAddress === undefined) return undefined
	return `${QUESTION_DRAFT_STORAGE_PREFIX}:${accountAddress.toLowerCase()}:${activeUniverseId.toString()}`
}

function getQuestionDraftStorage() {
	if (typeof window === 'undefined') return undefined
	try {
		return window.sessionStorage
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		return undefined
	}
}

function isMarketFormState(value: unknown): value is MarketFormState {
	if (typeof value !== 'object' || value === null) return false
	if (!('answerUnit' in value) || typeof value.answerUnit !== 'string') return false
	if (!('categoricalOutcomes' in value) || !Array.isArray(value.categoricalOutcomes) || !value.categoricalOutcomes.every(outcome => typeof outcome === 'string')) return false
	if (!('description' in value) || typeof value.description !== 'string') return false
	if (!('endTime' in value) || typeof value.endTime !== 'string') return false
	if (!('marketType' in value) || (value.marketType !== 'binary' && value.marketType !== 'categorical' && value.marketType !== 'scalar')) return false
	if (!('scalarIncrement' in value) || typeof value.scalarIncrement !== 'string') return false
	if (!('scalarMax' in value) || typeof value.scalarMax !== 'string') return false
	if (!('scalarMin' in value) || typeof value.scalarMin !== 'string') return false
	if (!('startTime' in value) || typeof value.startTime !== 'string') return false
	if (!('title' in value) || typeof value.title !== 'string') return false
	return true
}

function readQuestionDraft(storageKey: string | undefined) {
	const defaultState = getDefaultMarketFormState()
	if (storageKey === undefined) return defaultState
	try {
		const storedValue = getQuestionDraftStorage()?.getItem(storageKey)
		if (storedValue === null || storedValue === undefined) return defaultState
		const parsedValue: unknown = JSON.parse(storedValue)
		return isMarketFormState(parsedValue) ? parsedValue : defaultState
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error
		return defaultState
	}
}

function writeQuestionDraft(storageKey: string | undefined, form: MarketFormState) {
	if (storageKey === undefined) return
	try {
		getQuestionDraftStorage()?.setItem(storageKey, JSON.stringify(form))
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		// Draft persistence is progressive enhancement; the form remains usable without storage.
	}
}

function clearQuestionDraft(storageKey: string | undefined) {
	if (storageKey === undefined) return
	try {
		getQuestionDraftStorage()?.removeItem(storageKey)
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		// Draft persistence is progressive enhancement; the form remains usable without storage.
	}
}

function getValueForStorageKey<T>(keyedValue: KeyedValue<T> | undefined, storageKey: string | undefined) {
	if (keyedValue === undefined || keyedValue.storageKey !== storageKey) return undefined
	return keyedValue.value
}

export function useMarketCreation(
	{ accountAddress, activeUniverseId, activeZoltarView, autoLoadInitialData, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseMarketCreationParameters,
	dependencies: UseMarketCreationDependencies = defaultUseMarketCreationDependencies,
) {
	const zoltar = useZoltarOperations({ accountAddress, activeUniverseId, activeZoltarView, autoLoadInitialData, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState })
	const questionDraftStorageKey = getQuestionDraftStorageKey(accountAddress, activeUniverseId)
	const marketFormState = useSignal<{ form: MarketFormState; storageKey: string | undefined }>({ form: readQuestionDraft(questionDraftStorageKey), storageKey: questionDraftStorageKey })
	const marketCreating = useSignal<KeyedValue<boolean> | undefined>(undefined)
	const marketSubmissionInProgress = useSignal(false)
	const marketResult = useSignal<KeyedValue<MarketCreationResult> | undefined>(undefined)
	const marketError = useSignal<KeyedValue<string | undefined> | undefined>(undefined)
	const marketFeedback = useSignal<KeyedValue<ActionFeedback<'createMarket'>> | undefined>(undefined)
	const getMarketForm = () => {
		const keyedForm = marketFormState.value
		return keyedForm.storageKey === questionDraftStorageKey ? keyedForm.form : readQuestionDraft(questionDraftStorageKey)
	}
	const setMarketForm = (updater: (current: MarketFormState) => MarketFormState) => {
		const nextForm = updater(getMarketForm())
		writeQuestionDraft(questionDraftStorageKey, nextForm)
		marketFormState.value = { form: nextForm, storageKey: questionDraftStorageKey }
	}

	const createMarket = async () => {
		if (marketSubmissionInProgress.value) {
			marketError.value = { storageKey: questionDraftStorageKey, value: 'Question creation already in progress' }
			return
		}
		const submittedQuestionDraftStorageKey = questionDraftStorageKey
		const submittedMarketForm = getMarketForm()
		const transactionContext = {
			marketType: submittedMarketForm.marketType,
			title: submittedMarketForm.title,
			universeId: activeUniverseId,
		}
		marketSubmissionInProgress.value = true
		marketResult.value = undefined
		marketFeedback.value = { storageKey: submittedQuestionDraftStorageKey, value: createPendingActionFeedback('createMarket', 'Creating question') }
		try {
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before creating a question',
					onRefreshError: (message, hash) => {
						marketFeedback.value = { storageKey: submittedQuestionDraftStorageKey, value: createWarningActionFeedback('createMarket', 'Question created', message, hash) }
						const result = getValueForStorageKey(marketResult.value, submittedQuestionDraftStorageKey)
						if (result !== undefined) onTransactionPresented(createMarketCreationWarningPresentation(result, message, transactionContext))
					},
					onTransactionRequested: () => {
						marketCreating.value = { storageKey: submittedQuestionDraftStorageKey, value: true }
						onTransactionRequested(createMarketCreationTransactionIntent(transactionContext))
					},
					onTransactionFinished: () => {
						marketCreating.value = undefined
						onTransactionFinished()
					},
					onTransactionFailed,
					onWriteError: message => {
						marketFeedback.value = { storageKey: submittedQuestionDraftStorageKey, value: createErrorActionFeedback('createMarket', 'Question creation failed', message) }
					},
					refreshState: async () => {
						await refreshWalletStateOnly(refreshState)
						await zoltar.loadZoltarQuestions()
					},
					setErrorMessage: message => {
						marketError.value = { storageKey: submittedQuestionDraftStorageKey, value: message }
					},
				},
				async walletAddress => {
					if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) throw new Error('Deploy ZoltarQuestionData before creating a question')
					return await dependencies.createMarket(walletAddress, { onTransactionPrepared, onTransactionSubmitted }, createMarketParameters(submittedMarketForm))
				},
				'Failed to create question',
				result => {
					clearQuestionDraft(submittedQuestionDraftStorageKey)
					marketResult.value = { storageKey: submittedQuestionDraftStorageKey, value: result }
					marketFeedback.value = { storageKey: submittedQuestionDraftStorageKey, value: createSuccessActionFeedback('createMarket', 'Question created', result.hash) }
					onTransactionPresented(createMarketCreationSuccessPresentation(result, transactionContext))
					zoltar.setZoltarForkQuestionId(result.questionId)
				},
			)
		} finally {
			marketSubmissionInProgress.value = false
		}
	}

	const resetMarket = () => {
		clearQuestionDraft(questionDraftStorageKey)
		marketFormState.value = { form: getDefaultMarketFormState(), storageKey: questionDraftStorageKey }
		marketError.value = undefined
		marketResult.value = undefined
	}

	return {
		...zoltar,
		createMarket,
		marketFeedback: getValueForStorageKey(marketFeedback.value, questionDraftStorageKey),
		marketCreating: getValueForStorageKey(marketCreating.value, questionDraftStorageKey) ?? false,
		marketError: getValueForStorageKey(marketError.value, questionDraftStorageKey),
		marketForm: getMarketForm(),
		marketResult: getValueForStorageKey(marketResult.value, questionDraftStorageKey),
		resetMarket,
		setMarketForm,
	}
}
