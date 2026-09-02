import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { createMarket as createMarketTransaction } from '../../../protocol/index.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createMarketCreationWarningPresentation } from '../../transactionPresentations.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import { runWriteAction } from '@zoltar/ui-core-shared/lib/writeAction.js'
import { createMarketParameters } from '../lib/marketCreation.js'
import { hasDeployedStep } from '@zoltar/ui-core-shared/lib/deploymentStatus.js'
import { getDefaultMarketFormState } from '../lib/marketForm.js'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import type { MarketFormState, TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '@zoltar/ui-core-shared/types/contracts.js'
import type { CreateWriteClientCallbacks } from '@zoltar/ui-core-shared/lib/chainBackend.js'
import { useZoltarOperations } from '@zoltar/ui-zoltar/features/universes/hooks/useZoltarOperations.js'

type UseMarketCreationParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId: bigint
		activeZoltarView: 'create' | 'fork' | 'migrate' | 'questions'
		autoLoadInitialData: boolean
		deploymentStatuses: DeploymentStatus[]
		environmentRefreshKey: number
	}

export type UseMarketCreationDependencies = {
	createMarket: (accountAddress: Address, callbacks: CreateWriteClientCallbacks, parameters: ReturnType<typeof createMarketParameters>) => Promise<MarketCreationResult & { hash: Hash }>
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
	const ownerKey = accountAddress === undefined ? 'anonymous' : accountAddress.toLowerCase()
	return `${QUESTION_DRAFT_STORAGE_PREFIX}:${ownerKey}:${activeUniverseId.toString()}`
}

function getQuestionDraftStorage() {
	return getBrowserStorage('sessionStorage')
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

function readStoredQuestionDraft(storageKey: string | undefined) {
	if (storageKey === undefined) return undefined
	try {
		const storedValue = getQuestionDraftStorage()?.getItem(storageKey)
		if (storedValue === null || storedValue === undefined) return undefined
		const parsedValue: unknown = JSON.parse(storedValue)
		return isMarketFormState(parsedValue) ? parsedValue : undefined
	} catch (error) {
		if (!(error instanceof SyntaxError) && !(error instanceof DOMException)) throw error
		return undefined
	}
}

function readQuestionDraft(storageKey: string | undefined) {
	return readStoredQuestionDraft(storageKey) ?? getDefaultMarketFormState()
}

function writeQuestionDraft(storageKey: string | undefined, form: MarketFormState) {
	if (storageKey === undefined) return false
	try {
		const storage = getQuestionDraftStorage()
		if (storage === undefined) return false
		storage.setItem(storageKey, JSON.stringify(form))
		return true
	} catch (error) {
		if (!(error instanceof DOMException)) throw error
		// Draft persistence is progressive enhancement; the form remains usable without storage.
		return false
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

function clearQuestionDraftIfUnchanged(storageKey: string | undefined, submittedForm: MarketFormState) {
	const storedForm = readStoredQuestionDraft(storageKey)
	if (storedForm !== undefined && JSON.stringify(storedForm) === JSON.stringify(submittedForm)) clearQuestionDraft(storageKey)
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
	const marketActionScopeKey = `${questionDraftStorageKey}:${environmentRefreshKey}`
	const currentMarketActionScopeKeyRef = useRef(marketActionScopeKey)
	currentMarketActionScopeKeyRef.current = marketActionScopeKey
	const anonymousQuestionDraftStorageKey = getQuestionDraftStorageKey(undefined, activeUniverseId)
	const marketFormState = useSignal<{ form: MarketFormState; storageKey: string | undefined }>({ form: readQuestionDraft(questionDraftStorageKey), storageKey: questionDraftStorageKey })
	const marketCreatingScopes = useSignal<ReadonlySet<string>>(new Set())
	const marketSubmissionScopesRef = useRef(new Set<string>())
	const marketResult = useSignal<KeyedValue<MarketCreationResult> | undefined>(undefined)
	const marketError = useSignal<KeyedValue<string | undefined> | undefined>(undefined)
	const marketFeedback = useSignal<KeyedValue<ActionFeedback<'createMarket'>> | undefined>(undefined)
	const getMarketFormForCurrentOwner = () => {
		const keyedForm = marketFormState.value
		if (keyedForm.storageKey === questionDraftStorageKey) return keyedForm.form
		const storedOwnerDraft = readStoredQuestionDraft(questionDraftStorageKey)
		if (storedOwnerDraft !== undefined) return storedOwnerDraft
		if (accountAddress !== undefined && keyedForm.storageKey === anonymousQuestionDraftStorageKey) return keyedForm.form
		return getDefaultMarketFormState()
	}
	const getMarketForm = () => getMarketFormForCurrentOwner()
	useEffect(() => {
		if (marketFormState.value.storageKey === questionDraftStorageKey) return
		const previousStorageKey = marketFormState.value.storageKey
		const storedOwnerDraft = readStoredQuestionDraft(questionDraftStorageKey)
		const nextForm = storedOwnerDraft ?? getMarketFormForCurrentOwner()
		const persistedOwnerDraft = storedOwnerDraft !== undefined || writeQuestionDraft(questionDraftStorageKey, nextForm)
		marketFormState.value = { form: nextForm, storageKey: questionDraftStorageKey }
		if (accountAddress !== undefined && previousStorageKey === anonymousQuestionDraftStorageKey && storedOwnerDraft === undefined && persistedOwnerDraft) {
			clearQuestionDraft(anonymousQuestionDraftStorageKey)
		}
	}, [accountAddress, activeUniverseId, questionDraftStorageKey])
	const setMarketForm = (updater: (current: MarketFormState) => MarketFormState) => {
		const nextForm = updater(getMarketForm())
		writeQuestionDraft(questionDraftStorageKey, nextForm)
		marketFormState.value = { form: nextForm, storageKey: questionDraftStorageKey }
	}

	const createMarket = async ({ refreshQuestionList = true }: { refreshQuestionList?: boolean } = {}) => {
		if (marketSubmissionScopesRef.current.has(marketActionScopeKey)) {
			marketError.value = { storageKey: marketActionScopeKey, value: 'Question creation already in progress' }
			return
		}
		const submittedQuestionDraftStorageKey = questionDraftStorageKey
		const submittedMarketActionScopeKey = marketActionScopeKey
		const isCurrentMarketActionScope = () => currentMarketActionScopeKeyRef.current === submittedMarketActionScopeKey
		const submittedMarketForm = getMarketForm()
		const transactionContext = {
			marketType: submittedMarketForm.marketType,
			title: submittedMarketForm.title,
			universeId: activeUniverseId,
		}
		marketSubmissionScopesRef.current.add(submittedMarketActionScopeKey)
		marketResult.value = undefined
		marketFeedback.value = { storageKey: submittedMarketActionScopeKey, value: createPendingActionFeedback('createMarket', 'Creating question') }
		let createdResult: MarketCreationResult | undefined
		try {
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: 'Connect a wallet before creating a question',
					onRefreshError: (message, hash) => {
						marketFeedback.value = { storageKey: submittedMarketActionScopeKey, value: createWarningActionFeedback('createMarket', 'Question created', message, hash) }
						const result = getValueForStorageKey(marketResult.value, submittedMarketActionScopeKey)
						if (result !== undefined && isCurrentMarketActionScope()) onTransactionPresented(createMarketCreationWarningPresentation(result, message, transactionContext))
					},
					onTransactionRequested: () => {
						const accepted = onTransactionRequested(createMarketCreationTransactionIntent(transactionContext))
						if (accepted === false) return false
						marketCreatingScopes.value = new Set([...marketCreatingScopes.value, submittedMarketActionScopeKey])
						return accepted
					},
					onTransactionFinished: () => {
						const nextCreatingScopes = new Set(marketCreatingScopes.value)
						nextCreatingScopes.delete(submittedMarketActionScopeKey)
						marketCreatingScopes.value = nextCreatingScopes
						onTransactionFinished()
					},
					onTransactionFailed: message => {
						if (isCurrentMarketActionScope()) onTransactionFailed?.(message)
					},
					onWriteError: message => {
						marketFeedback.value = { storageKey: submittedMarketActionScopeKey, value: createErrorActionFeedback('createMarket', 'Question creation failed', message) }
						marketError.value = { storageKey: submittedMarketActionScopeKey, value: message }
					},
					refreshState: async () => {
						if (!isCurrentMarketActionScope()) return
						await refreshWalletStateOnly(refreshState)
						if (refreshQuestionList) await zoltar.loadZoltarQuestions()
					},
					setErrorMessage: message => {
						marketError.value = { storageKey: submittedMarketActionScopeKey, value: message }
					},
				},
				async walletAddress => {
					if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) throw new Error('Deploy ZoltarQuestionData before creating a question')
					return await dependencies.createMarket(
						walletAddress,
						{
							onTransactionPrepared: preview => {
								if (isCurrentMarketActionScope()) onTransactionPrepared?.(preview)
							},
							onTransactionSubmitted: hash => {
								if (isCurrentMarketActionScope()) onTransactionSubmitted(hash)
							},
						},
						createMarketParameters(submittedMarketForm),
					)
				},
				'Failed to create question',
				result => {
					createdResult = result
					clearQuestionDraftIfUnchanged(submittedQuestionDraftStorageKey, submittedMarketForm)
					marketResult.value = { storageKey: submittedMarketActionScopeKey, value: result }
					marketFeedback.value = { storageKey: submittedMarketActionScopeKey, value: createSuccessActionFeedback('createMarket', 'Question created', result.hash) }
					if (isCurrentMarketActionScope()) {
						onTransactionPresented(createMarketCreationSuccessPresentation(result, transactionContext))
						zoltar.setZoltarForkQuestionId(result.questionId)
					}
				},
			)
		} finally {
			marketSubmissionScopesRef.current.delete(submittedMarketActionScopeKey)
		}
		if (!isCurrentMarketActionScope()) return undefined
		return createdResult
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
		marketFeedback: getValueForStorageKey(marketFeedback.value, marketActionScopeKey),
		marketCreating: marketCreatingScopes.value.has(marketActionScopeKey),
		marketError: getValueForStorageKey(marketError.value, marketActionScopeKey),
		marketForm: getMarketForm(),
		marketResult: getValueForStorageKey(marketResult.value, marketActionScopeKey),
		resetMarket,
		setMarketForm,
	}
}
