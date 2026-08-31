import { useSignal } from '@preact/signals'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { createZoltarChildUniverse, loadAllZoltarQuestions, loadMarketDetails, loadZoltarQuestionCount, loadZoltarQuestionPage, loadZoltarUniverseSummary } from '../../../protocol/index.js'
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { formatRefreshErrorMessage, formatWriteErrorMessage, getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js'
import { createChildUniverseSuccessPresentation, createChildUniverseTransactionIntent, createChildUniverseWarningPresentation } from '../../transactionPresentations.js'
import { hasDeployedStep } from '@zoltar/ui-core-shared/lib/deploymentStatus.js'
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { requireWallet } from '@zoltar/ui-core-shared/lib/requireWalletConnection.js'
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import { assertActiveWallet } from '@zoltar/ui-core-shared/lib/assertActiveWallet.js'
import type { TransactionLifecycleParameters } from '../../../types/app.js'
import type { DeploymentStatus, MarketDetails, MarketDetailsPage, ZoltarChildUniverseActionResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { TRANSACTION_ACTION_LOCK_REASON } from '@zoltar/ui-core-shared/lib/transactionTray.js'

function buildQuestionPageFromQuestions(questions: MarketDetails[], currentPage: MarketDetailsPage): MarketDetailsPage {
	const questionCount = BigInt(questions.length)
	const startIndex = currentPage.pageIndex * currentPage.pageSize
	return {
		pageIndex: currentPage.pageIndex,
		pageSize: currentPage.pageSize,
		questionCount,
		questions: questions.slice(startIndex, startIndex + currentPage.pageSize),
	}
}

function mergeQuestionLists(existingQuestions: MarketDetails[], nextQuestions: readonly MarketDetails[]) {
	const getQuestionKey = (question: MarketDetails) => normalizeQuestionId(question.questionId) ?? question.questionId.toLowerCase()
	const questionsById = new Map(existingQuestions.map(question => [getQuestionKey(question), question]))
	for (const question of nextQuestions) questionsById.set(getQuestionKey(question), question)
	return [...questionsById.values()]
}

function includesQuestionId(questions: readonly MarketDetails[], normalizedQuestionId: string) {
	return questions.some(question => normalizeQuestionId(question.questionId) === normalizedQuestionId)
}

type UseZoltarUniverseParameters = TransactionLifecycleParameters & {
	accountAddress: Address | undefined
	activeUniverseId: bigint
	autoLoadInitialData: boolean
	deploymentStatuses: DeploymentStatus[]
	environmentRefreshKey: number
}

export type UseZoltarUniverseDependencies = {
	createConnectedReadClient: typeof createConnectedReadClient
	createWalletWriteClient: typeof createWalletWriteClient
	createZoltarChildUniverse: typeof createZoltarChildUniverse
	loadAllZoltarQuestions: typeof loadAllZoltarQuestions
	loadMarketDetails: typeof loadMarketDetails
	loadZoltarQuestionCount: typeof loadZoltarQuestionCount
	loadZoltarQuestionPage: typeof loadZoltarQuestionPage
	loadZoltarUniverseSummary: typeof loadZoltarUniverseSummary
}

const defaultUseZoltarUniverseDependencies: UseZoltarUniverseDependencies = {
	createConnectedReadClient,
	createWalletWriteClient,
	createZoltarChildUniverse,
	loadAllZoltarQuestions,
	loadMarketDetails,
	loadZoltarQuestionCount,
	loadZoltarQuestionPage,
	loadZoltarUniverseSummary,
}

export function useZoltarUniverse(
	{ accountAddress, activeUniverseId, autoLoadInitialData, deploymentStatuses, environmentRefreshKey, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted }: UseZoltarUniverseParameters,
	dependencies: UseZoltarUniverseDependencies = defaultUseZoltarUniverseDependencies,
) {
	const zoltarDeployed = hasDeployedStep(deploymentStatuses, 'zoltar')
	const universeLoad = useLoadController()
	const questionCountLoad = useLoadController()
	const questionsLoad = useLoadController()
	const questionByIdLoad = useLoadController()
	const zoltarUniverseMissing = useSignal(false)
	const zoltarUniverseLoadedId = useSignal<bigint | undefined>(undefined)
	const zoltarUniverseResolvedId = useSignal<bigint | undefined>(undefined)
	const hasLoadedZoltarQuestions = useSignal(false)
	const zoltarQuestionCount = useSignal<bigint | undefined>(undefined)
	const zoltarQuestionPage = useSignal<MarketDetailsPage | undefined>(undefined)
	const zoltarQuestions = useSignal<MarketDetails[]>([])
	const zoltarUniverse = useSignal<ZoltarUniverseSummary | undefined>(undefined)
	const zoltarChildUniverseError = useSignal<string | undefined>(undefined)
	const zoltarQuestionsError = useSignal<string | undefined>(undefined)
	const zoltarQuestionLookupError = useSignal<string | undefined>(undefined)
	const zoltarQuestionLookupId = useSignal<string | undefined>(undefined)
	const zoltarUniverseError = useSignal<string | undefined>(undefined)
	const zoltarChildUniverseFeedback = useSignal<ActionFeedback<'createChildUniverse'> | undefined>(undefined)
	const zoltarChildUniversePendingOutcomeIndex = useSignal<bigint | undefined>(undefined)
	const isMounted = useRef(true)
	const currentZoltarContextRef = useRef({ activeUniverseId, environmentRefreshKey, zoltarDeployed })
	const previousZoltarContextRef = useRef({ activeUniverseId, environmentRefreshKey, zoltarDeployed })
	const questionLoadGenerationRef = useRef(0)
	const nextUniverseLoad = useRequestGuard()
	const nextQuestionCountLoad = useRequestGuard()
	const nextQuestionsLoad = useRequestGuard()
	const nextQuestionByIdLoad = useRequestGuard()
	currentZoltarContextRef.current = { activeUniverseId, environmentRefreshKey, zoltarDeployed }

	const resetZoltarUniverseState = () => {
		universeLoad.invalidate()
		questionCountLoad.invalidate()
		questionsLoad.invalidate()
		questionByIdLoad.invalidate()
		questionLoadGenerationRef.current += 1
		zoltarUniverseMissing.value = false
		zoltarUniverse.value = undefined
		zoltarUniverseLoadedId.value = undefined
		zoltarUniverseResolvedId.value = undefined
		zoltarChildUniverseError.value = undefined
		zoltarQuestionsError.value = undefined
		zoltarQuestionLookupError.value = undefined
		zoltarQuestionLookupId.value = undefined
		zoltarUniverseError.value = undefined
		zoltarChildUniversePendingOutcomeIndex.value = undefined
		hasLoadedZoltarQuestions.value = false
		zoltarQuestionCount.value = undefined
		zoltarQuestionPage.value = undefined
		zoltarQuestions.value = []
	}
	const isCurrentZoltarContext = (context: { activeUniverseId: bigint; environmentRefreshKey: number; zoltarDeployed: boolean }) => {
		const currentContext = currentZoltarContextRef.current
		return currentContext.activeUniverseId === context.activeUniverseId && currentContext.environmentRefreshKey === context.environmentRefreshKey && currentContext.zoltarDeployed === context.zoltarDeployed
	}
	const isCurrentQuestionLoad = (generation: number, context: { activeUniverseId: bigint; environmentRefreshKey: number; zoltarDeployed: boolean }) => {
		return questionLoadGenerationRef.current === generation && isCurrentZoltarContext(context)
	}
	const clearResolvedQuestionLookupError = (questions: readonly MarketDetails[]) => {
		const lookupId = zoltarQuestionLookupId.value
		if (lookupId !== undefined && includesQuestionId(questions, lookupId)) zoltarQuestionLookupError.value = undefined
	}

	const ensureZoltarUniverse = async (): Promise<ZoltarUniverseSummary> => {
		if (zoltarUniverse.value !== undefined && zoltarUniverseLoadedId.value === activeUniverseId) return zoltarUniverse.value

		const loadedUniverse = await loadZoltarUniverse()
		if (loadedUniverse !== undefined) return loadedUniverse
		if (zoltarUniverseMissing.value) throw new Error('Zoltar universe does not exist')

		throw new Error('Failed to load current Zoltar universe')
	}

	const loadZoltarUniverse = async (options: { clearCurrentState?: boolean } = {}) => {
		if (!isMounted.current) return undefined
		const clearCurrentState = options.clearCurrentState ?? true
		const isCurrent = nextUniverseLoad()
		const requestedUniverseId = activeUniverseId
		const universeLoadContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		if (clearCurrentState) resetZoltarUniverseState()
		else zoltarUniverseError.value = undefined
		return await universeLoad.run({
			isCurrent,
			load: async () => {
				if (!hasDeployedStep(deploymentStatuses, 'zoltar')) {
					zoltarUniverseMissing.value = false
					zoltarUniverse.value = undefined
					zoltarUniverseLoadedId.value = undefined
					zoltarUniverseResolvedId.value = undefined
					zoltarChildUniverseError.value = undefined
					zoltarChildUniversePendingOutcomeIndex.value = undefined
					return undefined
				}
				return await dependencies.loadZoltarUniverseSummary(dependencies.createConnectedReadClient(), requestedUniverseId)
			},
			onSuccess: universe => {
				if (!isCurrentZoltarContext(universeLoadContext)) return
				if (universe === undefined) {
					zoltarUniverseResolvedId.value = requestedUniverseId
					zoltarUniverseMissing.value = requestedUniverseId !== 0n
					return
				}
				zoltarUniverseMissing.value = false
				zoltarUniverse.value = universe
				zoltarUniverseLoadedId.value = requestedUniverseId
				zoltarUniverseResolvedId.value = requestedUniverseId
			},
			onError: error => {
				if (!isCurrentZoltarContext(universeLoadContext)) return
				zoltarUniverseError.value = getErrorMessage(error, 'Failed to load Zoltar universe')
			},
		})
	}

	const refreshZoltarUniverse = async () => await loadZoltarUniverse({ clearCurrentState: false })

	const loadZoltarQuestionCountData = async () => {
		if (!isMounted.current) return
		if (!zoltarDeployed) {
			zoltarQuestionsError.value = undefined
			zoltarQuestionCount.value = undefined
			return
		}
		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		const isCurrent = nextQuestionCountLoad()
		zoltarQuestionsError.value = undefined
		await questionCountLoad.run({
			isCurrent,
			load: async () => await dependencies.loadZoltarQuestionCount(dependencies.createConnectedReadClient()),
			onSuccess: questionCount => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionCount.value = questionCount
			},
			onError: error => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionsError.value = getErrorMessage(error, 'Failed to load Zoltar question count')
			},
		})
	}

	const loadQuestions = async (): Promise<void> => {
		if (!isMounted.current) return
		if (!zoltarDeployed) return
		const isCountCurrent = nextQuestionCountLoad()
		const isQuestionsCurrent = nextQuestionsLoad()
		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		const readClient = dependencies.createConnectedReadClient()
		let loadError: unknown
		zoltarQuestionsError.value = undefined

		const countTask = questionCountLoad.run({
			isCurrent: isCountCurrent,
			load: async () => await dependencies.loadZoltarQuestionCount(readClient),
			onSuccess: questionCount => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionCount.value = questionCount
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		const questionsTask = questionsLoad.run({
			isCurrent: isQuestionsCurrent,
			load: async () => await dependencies.loadAllZoltarQuestions(readClient),
			onSuccess: questions => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestions.value = questions
				clearResolvedQuestionLookupError(questions)
				hasLoadedZoltarQuestions.value = true
				const currentQuestionPage = zoltarQuestionPage.value
				if (currentQuestionPage !== undefined) {
					zoltarQuestionPage.value = buildQuestionPageFromQuestions(questions, currentQuestionPage)
				}
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		await Promise.allSettled([countTask, questionsTask])
		if (!isMounted.current || !isCountCurrent() || !isQuestionsCurrent() || !isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
		if (loadError !== undefined) {
			zoltarQuestionsError.value = getErrorMessage(loadError, 'Failed to load Zoltar questions')
			throw loadError
		}
	}

	const loadQuestionsPage = async (pageIndex: number, pageSize: number): Promise<void> => {
		if (!isMounted.current) return
		if (!zoltarDeployed) return
		const isCountCurrent = nextQuestionCountLoad()
		const isQuestionsCurrent = nextQuestionsLoad()
		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		const readClient = dependencies.createConnectedReadClient()
		let loadError: unknown
		zoltarQuestionsError.value = undefined

		const countTask = questionCountLoad.run({
			isCurrent: isCountCurrent,
			load: async () => await dependencies.loadZoltarQuestionCount(readClient),
			onSuccess: questionCount => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionCount.value = questionCount
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		const questionsTask = questionsLoad.run({
			isCurrent: isQuestionsCurrent,
			load: async () => await dependencies.loadZoltarQuestionPage(readClient, pageIndex, pageSize),
			onSuccess: page => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionPage.value = page
				const mergedQuestions = mergeQuestionLists(zoltarQuestions.value, page.questions)
				zoltarQuestions.value = mergedQuestions
				clearResolvedQuestionLookupError(mergedQuestions)
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		await Promise.allSettled([countTask, questionsTask])
		if (!isMounted.current || !isCountCurrent() || !isQuestionsCurrent() || !isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
		if (loadError !== undefined) {
			zoltarQuestionsError.value = getErrorMessage(loadError, 'Failed to load Zoltar question page')
			throw loadError
		}
	}

	const loadQuestionById = async (questionId: string): Promise<void> => {
		if (!isMounted.current || !zoltarDeployed) return
		const isCurrent = nextQuestionByIdLoad()
		questionByIdLoad.invalidate()
		const normalizedQuestionId = normalizeQuestionId(questionId)
		zoltarQuestionLookupId.value = normalizedQuestionId
		zoltarQuestionLookupError.value = undefined
		if (normalizedQuestionId === undefined) {
			zoltarQuestionLookupError.value = 'Enter a valid hexadecimal question ID'
			return
		}

		const existingQuestion = zoltarQuestions.value.find(question => normalizeQuestionId(question.questionId) === normalizedQuestionId)
		if (existingQuestion !== undefined) return

		const questionLoadContext = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		await questionByIdLoad.run({
			isCurrent,
			load: async () => await dependencies.loadMarketDetails(dependencies.createConnectedReadClient(), BigInt(normalizedQuestionId)),
			onSuccess: question => {
				if (!isMounted.current || !isCurrentZoltarContext(questionLoadContext) || zoltarQuestionLookupId.value !== normalizedQuestionId) return
				if (!question.exists) {
					if (!includesQuestionId(zoltarQuestions.value, normalizedQuestionId)) zoltarQuestionLookupError.value = 'Question not found'
					return
				}
				zoltarQuestions.value = mergeQuestionLists(zoltarQuestions.value, [question])
				zoltarQuestionLookupError.value = undefined
			},
			onError: error => {
				if (!isMounted.current || !isCurrentZoltarContext(questionLoadContext) || zoltarQuestionLookupId.value !== normalizedQuestionId) return
				if (!includesQuestionId(zoltarQuestions.value, normalizedQuestionId)) zoltarQuestionLookupError.value = getErrorMessage(error, 'Failed to load question')
			},
		})
	}

	const createChildUniverse = async (outcomeIndex: bigint) => {
		if (
			!requireWallet(
				accountAddress,
				message => {
					zoltarChildUniverseError.value = message
				},
				'creating a child universe',
			)
		)
			return

		zoltarChildUniverseError.value = undefined
		zoltarChildUniverseFeedback.value = createPendingActionFeedback('createChildUniverse', 'Deploying child universe')
		zoltarChildUniversePendingOutcomeIndex.value = outcomeIndex
		let ownsTransaction = false
		try {
			let refreshRequired = false
			let result: ZoltarChildUniverseActionResult | undefined
			try {
				await assertActiveWallet(accountAddress)
				if (onTransactionRequested(createChildUniverseTransactionIntent('zoltar', { outcomeIndex, universeId: activeUniverseId })) === false) {
					zoltarChildUniverseFeedback.value = createErrorActionFeedback('createChildUniverse', 'Child universe deployment blocked', TRANSACTION_ACTION_LOCK_REASON)
					return
				}
				ownsTransaction = true
				const universe = await ensureZoltarUniverse()
				if (!universe.hasForked) throw new Error('This universe must fork before child universes can be deployed')
				const transaction = await dependencies.createZoltarChildUniverse(dependencies.createWalletWriteClient(accountAddress, { onTransactionPrepared, onTransactionSubmitted }), universe.universeId, outcomeIndex)
				result = {
					action: 'createChildUniverse',
					hash: transaction.hash,
					outcomeIndex,
					universeId: universe.universeId,
				}
				zoltarChildUniverseFeedback.value = createSuccessActionFeedback('createChildUniverse', 'Child universe deployed', result.hash)
				onTransactionPresented(createChildUniverseSuccessPresentation(result))
				refreshRequired = true
			} catch (error) {
				const message = formatWriteErrorMessage(error, 'Failed to deploy child universe')
				if (ownsTransaction) onTransactionFailed?.(message)
				zoltarChildUniverseFeedback.value = createErrorActionFeedback('createChildUniverse', 'Child universe deployment failed', message)
				return
			}

			if (!refreshRequired) return

			try {
				await refreshZoltarUniverse()
			} catch (error) {
				const message = formatRefreshErrorMessage(error, 'Child universe transaction succeeded, but refreshing the UI failed')
				zoltarChildUniverseFeedback.value = createWarningActionFeedback('createChildUniverse', 'Child universe deployed', message, result?.hash)
				if (result !== undefined) onTransactionPresented(createChildUniverseWarningPresentation(result, message))
			}
		} finally {
			zoltarChildUniversePendingOutcomeIndex.value = undefined
			if (ownsTransaction) onTransactionFinished()
		}
	}

	useLayoutEffect(() => {
		const previousContext = previousZoltarContextRef.current
		const contextChanged = previousContext.activeUniverseId !== activeUniverseId || previousContext.environmentRefreshKey !== environmentRefreshKey || previousContext.zoltarDeployed !== zoltarDeployed
		previousZoltarContextRef.current = { activeUniverseId, environmentRefreshKey, zoltarDeployed }
		if (contextChanged) resetZoltarUniverseState()
	}, [activeUniverseId, environmentRefreshKey, zoltarDeployed])

	useLayoutEffect(() => {
		if (!autoLoadInitialData) return
		const initialLoads: Promise<unknown>[] = [loadZoltarUniverse()]
		if (zoltarDeployed) initialLoads.push(loadZoltarQuestionCountData())
		void Promise.allSettled(initialLoads)
	}, [activeUniverseId, autoLoadInitialData, environmentRefreshKey, zoltarDeployed])

	useLayoutEffect(() => {
		return () => {
			isMounted.current = false
		}
	}, [])

	return {
		createChildUniverse,
		ensureZoltarUniverse,
		hasLoadedZoltarQuestions: hasLoadedZoltarQuestions.value,
		loadingZoltarQuestionCount: questionCountLoad.isLoading.value,
		loadingZoltarQuestion: questionByIdLoad.isLoading.value,
		loadingZoltarQuestions: questionsLoad.isLoading.value,
		loadingZoltarUniverse: universeLoad.isLoading.value,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadZoltarQuestion: loadQuestionById,
		loadZoltarQuestionPage: loadQuestionsPage,
		loadZoltarQuestions: loadQuestions,
		loadZoltarUniverse,
		zoltarChildUniverseFeedback: zoltarChildUniverseFeedback.value,
		refreshZoltarUniverse,
		zoltarChildUniverseError: zoltarChildUniverseError.value,
		zoltarChildUniversePendingOutcomeIndex: zoltarChildUniversePendingOutcomeIndex.value,
		zoltarQuestionPage: zoltarQuestionPage.value,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarQuestionLookupError: zoltarQuestionLookupError.value,
		zoltarQuestionLookupId: zoltarQuestionLookupId.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarQuestionsError: zoltarQuestionsError.value,
		zoltarUniverse: zoltarUniverseLoadedId.value === activeUniverseId ? zoltarUniverse.value : undefined,
		zoltarUniverseError: zoltarUniverseError.value,
		zoltarUniverseLoadedId: zoltarUniverseLoadedId.value,
		zoltarUniverseResolvedId: zoltarUniverseResolvedId.value,
		zoltarUniverseMissing: zoltarUniverseMissing.value,
	}
}
