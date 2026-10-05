import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js'
import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { createMarket as createQuestionTransaction } from '../../../protocol/zoltar.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/transactions/actionFeedback.js'
import { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createMarketCreationWarningPresentation } from '../../zoltarTransactionPresentations.js'
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js'
import { runWriteAction } from '@zoltar/ui-core-shared/transactions/writeAction.js'
import { createQuestionParameters } from '../lib/questionCreation.js'
import { hasDeployedStep } from '@zoltar/ui-core-shared/lib/deploymentStatus.js'
import { getDefaultMarketFormState } from '../lib/questionForm.js'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import type { MarketFormState, TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import type { DeploymentStatus, MarketCreationResult } from '@zoltar/ui-core-shared/types/contracts.js'
import type { CreateWriteClientCallbacks } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { useZoltarOperations } from '../../universes/hooks/useZoltarOperations.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

export type UseQuestionCreationParameters = TransactionLifecycleParameters &
	WriteOperationContext & {
		activeUniverseId: bigint
		autoLoadInitialData: boolean
		includeRelatedUniverses?: boolean
		deploymentStatuses: DeploymentStatus[]
		environmentRefreshKey: number
	}

export type UseQuestionCreationDependencies = {
	createQuestion: (accountAddress: Address, callbacks: CreateWriteClientCallbacks, parameters: ReturnType<typeof createQuestionParameters>) => Promise<MarketCreationResult & { hash: Hash }>
}

const defaultUseQuestionCreationDependencies: UseQuestionCreationDependencies = {
	createQuestion: async (accountAddress, callbacks, parameters) => {
		const result = await createQuestionTransaction(createWalletWriteClient(accountAddress, callbacks), parameters)
		return { ...result, hash: result.createQuestionHash }
	},
}

export type UseQuestionCreationOptions = {
	/** Stores a separate draft per universe and labels creation transactions with the universe. */
	universeScoped?: boolean
	/** Forces every draft and submission to one question type. */
	fixedMarketType?: MarketFormState['marketType']
}

const QUESTION_DRAFT_STORAGE_PREFIX = 'zoltar.questionDraft'

type KeyedValue<T> = {
	storageKey: string | undefined
	value: T
}

function getQuestionDraftStorageKey(accountAddress: Address | undefined, universeId: bigint | undefined) {
	const ownerKey = accountAddress === undefined ? 'anonymous' : accountAddress.toLowerCase()
	const ownerStorageKey = `${QUESTION_DRAFT_STORAGE_PREFIX}:${ownerKey}`
	return universeId === undefined ? ownerStorageKey : `${ownerStorageKey}:${universeId.toString()}`
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

type NormalizeQuestionForm = (form: MarketFormState) => MarketFormState

function readStoredQuestionDraft(storageKey: string | undefined, normalizeForm: NormalizeQuestionForm) {
	if (storageKey === undefined) return undefined
	try {
		const storedValue = getQuestionDraftStorage()?.getItem(storageKey)
		if (storedValue === null || storedValue === undefined) return undefined
		const parsedValue: unknown = JSON.parse(storedValue)
		return isMarketFormState(parsedValue) ? normalizeForm(parsedValue) : undefined
	} catch (error) {
		if (!(error instanceof SyntaxError) && !(error instanceof DOMException)) throw error
		return undefined
	}
}

function readQuestionDraft(storageKey: string | undefined, normalizeForm: NormalizeQuestionForm) {
	return readStoredQuestionDraft(storageKey, normalizeForm) ?? getDefaultMarketFormState()
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

function clearQuestionDraftIfUnchanged(storageKey: string | undefined, submittedForm: MarketFormState, normalizeForm: NormalizeQuestionForm) {
	const storedForm = readStoredQuestionDraft(storageKey, normalizeForm)
	if (storedForm !== undefined && JSON.stringify(storedForm) === JSON.stringify(submittedForm)) clearQuestionDraft(storageKey)
}

function getValueForStorageKey<T>(keyedValue: KeyedValue<T> | undefined, storageKey: string | undefined) {
	if (keyedValue === undefined || keyedValue.storageKey !== storageKey) return undefined
	return keyedValue.value
}

export function useQuestionCreation(
	{ accountAddress, activeUniverseId, autoLoadInitialData, includeRelatedUniverses = false, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseQuestionCreationParameters,
	dependencies: UseQuestionCreationDependencies = defaultUseQuestionCreationDependencies,
	{ fixedMarketType, universeScoped = false }: UseQuestionCreationOptions = {},
) {
	const zoltar = useZoltarOperations({ accountAddress, activeUniverseId, autoLoadInitialData, includeRelatedUniverses, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState })
	const normalizeForm: NormalizeQuestionForm = form => (fixedMarketType === undefined ? form : { ...form, marketType: fixedMarketType })
	const draftUniverseId = universeScoped ? activeUniverseId : undefined
	const questionDraftStorageKey = getQuestionDraftStorageKey(accountAddress, draftUniverseId)
	const questionActionScopeKey = `${questionDraftStorageKey}:${environmentRefreshKey}`
	const currentQuestionActionScopeKeyRef = useRef(questionActionScopeKey)
	currentQuestionActionScopeKeyRef.current = questionActionScopeKey
	const anonymousQuestionDraftStorageKey = getQuestionDraftStorageKey(undefined, draftUniverseId)
	const questionFormState = useSignal<{ form: MarketFormState; storageKey: string | undefined }>({ form: readQuestionDraft(questionDraftStorageKey, normalizeForm), storageKey: questionDraftStorageKey })
	const questionCreatingScopes = useSignal<ReadonlySet<string>>(new Set())
	const questionSubmissionScopesRef = useRef(new Set<string>())
	const questionResult = useSignal<KeyedValue<MarketCreationResult> | undefined>(undefined)
	const questionError = useSignal<KeyedValue<string | undefined> | undefined>(undefined)
	const questionFeedback = useSignal<KeyedValue<ActionFeedback<'createMarket'>> | undefined>(undefined)
	const getQuestionFormForCurrentOwner = () => {
		const keyedForm = questionFormState.value
		if (keyedForm.storageKey === questionDraftStorageKey) return keyedForm.form
		const storedOwnerDraft = readStoredQuestionDraft(questionDraftStorageKey, normalizeForm)
		if (storedOwnerDraft !== undefined) return storedOwnerDraft
		if (accountAddress !== undefined && keyedForm.storageKey === anonymousQuestionDraftStorageKey) return keyedForm.form
		return getDefaultMarketFormState()
	}
	const getQuestionForm = () => getQuestionFormForCurrentOwner()
	useEffect(() => {
		if (questionFormState.value.storageKey === questionDraftStorageKey) return
		const previousStorageKey = questionFormState.value.storageKey
		const storedOwnerDraft = readStoredQuestionDraft(questionDraftStorageKey, normalizeForm)
		const nextForm = storedOwnerDraft ?? getQuestionFormForCurrentOwner()
		const persistedOwnerDraft = storedOwnerDraft !== undefined || writeQuestionDraft(questionDraftStorageKey, nextForm)
		questionFormState.value = { form: nextForm, storageKey: questionDraftStorageKey }
		if (accountAddress !== undefined && previousStorageKey === anonymousQuestionDraftStorageKey && storedOwnerDraft === undefined && persistedOwnerDraft) {
			clearQuestionDraft(anonymousQuestionDraftStorageKey)
		}
	}, [accountAddress, activeUniverseId, questionDraftStorageKey])
	const setQuestionForm = (updater: (current: MarketFormState) => MarketFormState) => {
		const nextForm = normalizeForm(updater(getQuestionForm()))
		writeQuestionDraft(questionDraftStorageKey, nextForm)
		questionFormState.value = { form: nextForm, storageKey: questionDraftStorageKey }
	}

	const createQuestion = async ({ refreshQuestionList = true }: { refreshQuestionList?: boolean } = {}) => {
		if (questionSubmissionScopesRef.current.has(questionActionScopeKey)) {
			questionError.value = { storageKey: questionActionScopeKey, value: 'Question creation is already in progress.' }
			return
		}
		const submittedQuestionDraftStorageKey = questionDraftStorageKey
		const submittedQuestionActionScopeKey = questionActionScopeKey
		const isCurrentQuestionActionScope = () => currentQuestionActionScopeKeyRef.current === submittedQuestionActionScopeKey
		const submittedMarketForm = getQuestionForm()
		const transactionContext = {
			marketType: submittedMarketForm.marketType,
			title: submittedMarketForm.title,
			universeId: draftUniverseId,
		}
		questionSubmissionScopesRef.current.add(submittedQuestionActionScopeKey)
		questionResult.value = undefined
		questionFeedback.value = { storageKey: submittedQuestionActionScopeKey, value: createPendingActionFeedback('createMarket', transactionCopy.creatingQuestion) }
		let createdResult: MarketCreationResult | undefined
		try {
			await runWriteAction(
				{
					accountAddress,
					missingWalletMessage: commonCopy.formatConnectWalletBefore('creating a question'),
					onRefreshError: (message, hash) => {
						questionFeedback.value = { storageKey: submittedQuestionActionScopeKey, value: createWarningActionFeedback('createMarket', transactionCopy.questionCreated, message, hash) }
						const result = getValueForStorageKey(questionResult.value, submittedQuestionActionScopeKey)
						if (result !== undefined && isCurrentQuestionActionScope()) onTransactionPresented(createMarketCreationWarningPresentation(result, message, transactionContext))
					},
					onTransactionRequested: () => {
						const accepted = onTransactionRequested(createMarketCreationTransactionIntent(transactionContext))
						if (accepted === false) return false
						questionCreatingScopes.value = new Set([...questionCreatingScopes.value, submittedQuestionActionScopeKey])
						return accepted
					},
					onTransactionFinished: requestKey => {
						const nextCreatingScopes = new Set(questionCreatingScopes.value)
						nextCreatingScopes.delete(submittedQuestionActionScopeKey)
						questionCreatingScopes.value = nextCreatingScopes
						onTransactionFinished(requestKey)
					},
					onTransactionFailed: (message, details) => {
						if (isCurrentQuestionActionScope()) onTransactionFailed?.(message, details)
					},
					onWriteError: message => {
						questionFeedback.value = { storageKey: submittedQuestionActionScopeKey, value: createErrorActionFeedback('createMarket', 'Question creation failed', message) }
						questionError.value = { storageKey: submittedQuestionActionScopeKey, value: message }
					},
					refreshState: async () => {
						if (!isCurrentQuestionActionScope()) return
						await refreshWalletStateOnly(refreshState)
						if (refreshQuestionList && createdResult !== undefined) await zoltar.loadCreatedZoltarQuestion(createdResult.questionId)
					},
					setErrorMessage: message => {
						questionError.value = { storageKey: submittedQuestionActionScopeKey, value: message }
					},
				},
				async (walletAddress, context) => {
					if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) throw new Error('Deploy the ZoltarQuestionData contract before creating a question.')
					return await dependencies.createQuestion(
						walletAddress,
						{
							reviewSignal: context.reviewSignal,
							onTransactionPrepared: preview => {
								if (isCurrentQuestionActionScope()) onTransactionPrepared?.(preview)
							},
							onTransactionSubmitted: hash => {
								if (isCurrentQuestionActionScope()) onTransactionSubmitted(hash)
							},
						},
						createQuestionParameters(submittedMarketForm),
					)
				},
				'Failed to create question',
				result => {
					createdResult = result
					clearQuestionDraftIfUnchanged(submittedQuestionDraftStorageKey, submittedMarketForm, normalizeForm)
					questionResult.value = { storageKey: submittedQuestionActionScopeKey, value: result }
					questionFeedback.value = { storageKey: submittedQuestionActionScopeKey, value: createSuccessActionFeedback('createMarket', transactionCopy.questionCreated, result.hash) }
					if (isCurrentQuestionActionScope()) {
						onTransactionPresented(createMarketCreationSuccessPresentation(result, transactionContext))
						zoltar.setZoltarForkQuestionId(result.questionId)
					}
				},
			)
		} finally {
			questionSubmissionScopesRef.current.delete(submittedQuestionActionScopeKey)
		}
		if (!isCurrentQuestionActionScope()) return undefined
		return createdResult
	}

	const resetQuestion = () => {
		clearQuestionDraft(questionDraftStorageKey)
		questionFormState.value = { form: getDefaultMarketFormState(), storageKey: questionDraftStorageKey }
		questionError.value = undefined
		questionResult.value = undefined
	}

	return {
		...zoltar,
		createQuestion,
		questionFeedback: getValueForStorageKey(questionFeedback.value, questionActionScopeKey),
		questionCreating: questionCreatingScopes.value.has(questionActionScopeKey),
		questionError: getValueForStorageKey(questionError.value, questionActionScopeKey),
		questionForm: getQuestionForm(),
		questionResult: getValueForStorageKey(questionResult.value, questionActionScopeKey),
		resetQuestion,
		setQuestionForm,
	}
}
