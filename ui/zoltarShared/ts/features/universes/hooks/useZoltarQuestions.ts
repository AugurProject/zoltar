import * as marketCopy from '../../../copy/market.js'

import { readOperationClient, runReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { useSignal } from '@preact/signals'

import { useLayoutEffect, useRef } from 'preact/hooks'

import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js'
import { appQueryCache, isSameQueryData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { useQueryState } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js'

import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'

import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

import { buildQuestionPageFromQuestions, includesQuestionId, insertCreatedQuestion, mergeQuestionLists } from '../lib/questionRegistry.js'
import type { MarketDetails, MarketDetailsPage } from '@zoltar/ui-core-shared/types/contracts.js'

import type { UseZoltarUniverseDependencies } from './zoltarUniverseServices.js'

const zoltarQuestionPageQueries = appQueryCache.createStore<MarketDetailsPage>()

export function useZoltarQuestions(
	{ environmentRefreshKey, zoltarDeployed }: { environmentRefreshKey: number; zoltarDeployed: boolean },
	dependencies: Pick<UseZoltarUniverseDependencies, 'createConnectedReadClient' | 'loadAllZoltarQuestions' | 'loadMarketDetails' | 'loadZoltarQuestionCount' | 'loadZoltarQuestionPage'>,
) {
	const isMounted = useRef(true)
	const questionCountLoad = useLoadController()
	const questionsLoad = useLoadController()
	const questionByIdLoad = useLoadController()
	const hasLoadedZoltarQuestions = useSignal(false)
	const requestedQuestionPage = useRef<{ pageIndex: number; pageSize: number }>()
	const zoltarQuestionCount = useSignal<bigint | undefined>(undefined)
	const zoltarQuestionPage = useSignal<MarketDetailsPage | undefined>(undefined)
	const zoltarQuestions = useSignal<MarketDetails[]>([])
	const zoltarQuestionsError = useSignal<string | undefined>(undefined)
	const zoltarQuestionLookupError = useSignal<string | undefined>(undefined)
	const zoltarQuestionLookupId = useSignal<string | undefined>(undefined)
	const currentQuestionContextRef = useRef({ environmentRefreshKey, zoltarDeployed })
	const previousQuestionContextRef = useRef({ environmentRefreshKey, zoltarDeployed })
	const questionLoadGenerationRef = useRef(0)
	const nextQuestionCountLoad = useRequestGuard()
	const nextQuestionsLoad = useRequestGuard()
	const nextQuestionByIdLoad = useRequestGuard()
	const questionPageCommitVersionRef = useRef(0)
	const questionPage = zoltarQuestionPage.value
	const questionPageQueryKey = zoltarDeployed && questionPage !== undefined ? `${environmentRefreshKey}:${questionPage.pageIndex}:${questionPage.pageSize}` : undefined
	const questionPageQuery = useQueryState(zoltarQuestionPageQueries, questionPageQueryKey)
	currentQuestionContextRef.current = { environmentRefreshKey, zoltarDeployed }
	const resetQuestionRegistryState = () => {
		questionCountLoad.invalidate()
		questionsLoad.invalidate()
		questionByIdLoad.invalidate()
		questionLoadGenerationRef.current += 1
		zoltarQuestionsError.value = undefined
		zoltarQuestionLookupError.value = undefined
		zoltarQuestionLookupId.value = undefined
		hasLoadedZoltarQuestions.value = false
		zoltarQuestionCount.value = undefined
		zoltarQuestionPage.value = undefined
		zoltarQuestions.value = []
	}
	const isCurrentQuestionLoad = (generation: number, context: { environmentRefreshKey: number; zoltarDeployed: boolean }) => {
		const currentContext = currentQuestionContextRef.current
		return questionLoadGenerationRef.current === generation && currentContext.environmentRefreshKey === context.environmentRefreshKey && currentContext.zoltarDeployed === context.zoltarDeployed
	}
	const clearResolvedQuestionLookupError = (questions: readonly MarketDetails[]) => {
		const lookupId = zoltarQuestionLookupId.value
		if (lookupId !== undefined && includesQuestionId(questions, lookupId)) zoltarQuestionLookupError.value = undefined
	}
	const loadZoltarQuestionCountData = async () => {
		if (!isMounted.current) return
		if (!zoltarDeployed) {
			zoltarQuestionsError.value = undefined
			zoltarQuestionCount.value = undefined
			return
		}
		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { environmentRefreshKey, zoltarDeployed }
		const isCurrent = nextQuestionCountLoad()
		zoltarQuestionsError.value = undefined
		await questionCountLoad.run({
			isCurrent,
			load: async operation => await dependencies.loadZoltarQuestionCount(readOperationClient(dependencies.createConnectedReadClient(), operation)),
			onSuccess: questionCount => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionCount.value = questionCount
			},
			onError: error => {
				if (!isMounted.current) return
				if (!isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				zoltarQuestionsError.value = getErrorMessage(error, marketCopy.questionPageLoadError)
			},
		})
	}

	const runQuestionLoad = async <T>({ load, onLoaded, errorFallback }: { load: (readClient: ReturnType<typeof createConnectedReadClient>) => Promise<T>; onLoaded: (loaded: T) => void; errorFallback: string }): Promise<void> => {
		const isCountCurrent = nextQuestionCountLoad()
		const isQuestionsCurrent = nextQuestionsLoad()
		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { environmentRefreshKey, zoltarDeployed }
		const readClient = dependencies.createConnectedReadClient()
		const isCurrentLoad = () => isMounted.current && isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)
		let loadError: unknown
		zoltarQuestionsError.value = undefined

		const countTask = questionCountLoad.run({
			isCurrent: isCountCurrent,
			load: async operation => await dependencies.loadZoltarQuestionCount(readOperationClient(readClient, operation)),
			onSuccess: questionCount => {
				if (!isCurrentLoad()) return
				zoltarQuestionCount.value = questionCount
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		const questionsTask = questionsLoad.run({
			isCurrent: isQuestionsCurrent,
			load: async operation => await load(readOperationClient(readClient, operation)),
			onSuccess: loaded => {
				if (!isCurrentLoad()) return
				onLoaded(loaded)
			},
			onError: error => {
				loadError = loadError ?? error
			},
		})

		await Promise.allSettled([countTask, questionsTask])
		if (!isCountCurrent() || !isQuestionsCurrent() || !isCurrentLoad()) return
		if (loadError !== undefined) {
			zoltarQuestionsError.value = getErrorMessage(loadError, errorFallback)
			throw loadError
		}
	}

	const loadQuestions = async (): Promise<void> => {
		if (!isMounted.current) return
		if (!zoltarDeployed) return
		await runQuestionLoad({
			load: async readClient => await dependencies.loadAllZoltarQuestions(readClient),
			onLoaded: questions => {
				zoltarQuestions.value = questions
				clearResolvedQuestionLookupError(questions)
				hasLoadedZoltarQuestions.value = true
				const currentQuestionPage = zoltarQuestionPage.value
				if (currentQuestionPage !== undefined) {
					zoltarQuestionPage.value = buildQuestionPageFromQuestions(questions, currentQuestionPage)
				}
			},
			errorFallback: marketCopy.questionPageLoadError,
		})
	}

	const loadQuestionsPage = async (pageIndex: number, pageSize: number): Promise<void> => {
		if (!isMounted.current) return
		requestedQuestionPage.current = { pageIndex, pageSize }
		if (!zoltarDeployed) return
		await runQuestionLoad({
			load: async readClient => await dependencies.loadZoltarQuestionPage(readClient, pageIndex, pageSize),
			onLoaded: page => {
				zoltarQuestionPage.value = page
				questionPageCommitVersionRef.current += 1
				zoltarQuestionPageQueries.set(`${environmentRefreshKey}:${pageIndex}:${pageSize}`, page)
				const mergedQuestions = mergeQuestionLists(zoltarQuestions.value, page.questions)
				zoltarQuestions.value = mergedQuestions
				clearResolvedQuestionLookupError(mergedQuestions)
			},
			errorFallback: marketCopy.questionPageLoadError,
		})
	}

	const loadQuestionById = async (questionId: string): Promise<void> => {
		if (!isMounted.current || !zoltarDeployed) return
		const isCurrent = nextQuestionByIdLoad()
		questionByIdLoad.invalidate()
		const normalizedQuestionId = normalizeQuestionId(questionId)
		zoltarQuestionLookupId.value = normalizedQuestionId
		zoltarQuestionLookupError.value = undefined
		if (normalizedQuestionId === undefined) {
			zoltarQuestionLookupError.value = commonCopy.invalidQuestionId
			return
		}

		const existingQuestion = zoltarQuestions.value.find(question => normalizeQuestionId(question.questionId) === normalizedQuestionId)
		if (existingQuestion !== undefined) return

		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { environmentRefreshKey, zoltarDeployed }
		await questionByIdLoad.run({
			isCurrent,
			load: async operation => await dependencies.loadMarketDetails(readOperationClient(dependencies.createConnectedReadClient(), operation), BigInt(normalizedQuestionId)),
			onSuccess: question => {
				if (!isMounted.current || !isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext) || zoltarQuestionLookupId.value !== normalizedQuestionId) return
				if (!question.exists) return
				zoltarQuestions.value = mergeQuestionLists(zoltarQuestions.value, [question])
				zoltarQuestionLookupError.value = undefined
			},
			onError: error => {
				if (!isMounted.current || !isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext) || zoltarQuestionLookupId.value !== normalizedQuestionId) return
				if (!includesQuestionId(zoltarQuestions.value, normalizedQuestionId)) zoltarQuestionLookupError.value = getErrorMessage(error, 'Question could not be loaded.')
			},
		})
	}

	/** Reads only the just-created question and the registry count, then merges them into the loaded list and page. */
	const loadCreatedQuestion = async (questionId: string): Promise<void> => {
		if (!isMounted.current || !zoltarDeployed) return
		const normalizedQuestionId = normalizeQuestionId(questionId)
		if (normalizedQuestionId === undefined) throw new Error('The created question ID is invalid.')
		const questionLoadGeneration = questionLoadGenerationRef.current
		const questionLoadContext = { environmentRefreshKey, zoltarDeployed }
		const readClient = dependencies.createConnectedReadClient()
		let loadError: unknown
		// Page and count reads that started before the creation would otherwise land later with pre-creation data; reads started after this one still win.
		nextQuestionCountLoad()
		nextQuestionsLoad()
		// Track on the list controller so list and create-result loading states cover this read.
		await questionsLoad.run({
			load: async () => await Promise.all([dependencies.loadMarketDetails(readClient, BigInt(normalizedQuestionId)), dependencies.loadZoltarQuestionCount(readClient)]),
			onSuccess: ([question, questionCount]) => {
				if (!isMounted.current || !isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
				if (!question.exists) {
					loadError = new Error('The created question could not be found.')
					return
				}
				const registry = insertCreatedQuestion({ questionCount: zoltarQuestionCount.value, questionPage: zoltarQuestionPage.value, questions: zoltarQuestions.value }, question, questionCount)
				zoltarQuestions.value = registry.questions
				zoltarQuestionPage.value = registry.questionPage
				zoltarQuestionCount.value = registry.questionCount
				// Retire older background page answers and seed the cache so the next block refresh compares against the merged page.
				questionPageCommitVersionRef.current += 1
				if (registry.questionPage !== undefined) zoltarQuestionPageQueries.set(`${questionLoadContext.environmentRefreshKey}:${registry.questionPage.pageIndex}:${registry.questionPage.pageSize}`, registry.questionPage)
				clearResolvedQuestionLookupError(registry.questions)
			},
			onError: error => {
				loadError = error
			},
		})
		if (!isMounted.current || !isCurrentQuestionLoad(questionLoadGeneration, questionLoadContext)) return
		// A superseded read may have been for a different page than the one loaded; reissue it, even when this read failed, so that page does not stay blank.
		const requestedPage = requestedQuestionPage.current
		const loadedPage = zoltarQuestionPage.value
		const reissueRequestedPage = requestedPage !== undefined && (loadedPage === undefined || loadedPage.pageIndex !== requestedPage.pageIndex || loadedPage.pageSize !== requestedPage.pageSize)
		if (loadError !== undefined) {
			// The page read reports its own failure in the list; the created-question failure is the one surfaced to the caller.
			if (reissueRequestedPage) await loadQuestionsPage(requestedPage.pageIndex, requestedPage.pageSize).catch(() => undefined)
			throw loadError
		}
		if (reissueRequestedPage) await loadQuestionsPage(requestedPage.pageIndex, requestedPage.pageSize)
	}
	const refreshInBackground = async () => {
		if (!isMounted.current || !zoltarDeployed) return
		const questionContext = { environmentRefreshKey, zoltarDeployed }
		const questionLoadGeneration = questionLoadGenerationRef.current
		const tasks: Promise<void>[] = []
		const page = zoltarQuestionPage.value
		if (questionPageQueryKey !== undefined && page !== undefined && !questionsLoad.isLoading.peek()) {
			const commitVersion = ++questionPageCommitVersionRef.current
			const isCurrent = () => isMounted.current && isCurrentQuestionLoad(questionLoadGeneration, questionContext)
			tasks.push(
				zoltarQuestionPageQueries
					.fetch(questionPageQueryKey, async () => await runReadOperation(async operation => await dependencies.loadZoltarQuestionPage(readOperationClient(dependencies.createConnectedReadClient(), operation), page.pageIndex, page.pageSize), { isCurrent }))
					.then(nextPage => {
						if (!isMounted.current || !isCurrentQuestionLoad(questionLoadGeneration, questionContext) || questionsLoad.isLoading.peek() || questionPageCommitVersionRef.current !== commitVersion) return
						if (isSameQueryData(nextPage, zoltarQuestionPage.value)) return
						zoltarQuestionCount.value = nextPage.questionCount
						zoltarQuestionPage.value = nextPage
						zoltarQuestions.value = mergeQuestionLists(zoltarQuestions.value, nextPage.questions)
					}),
			)
		}
		await Promise.allSettled(tasks)
	}
	useLayoutEffect(() => {
		const previousContext = previousQuestionContextRef.current
		const contextChanged = previousContext.environmentRefreshKey !== environmentRefreshKey || previousContext.zoltarDeployed !== zoltarDeployed
		previousQuestionContextRef.current = { environmentRefreshKey, zoltarDeployed }
		if (contextChanged) resetQuestionRegistryState()
	}, [environmentRefreshKey, zoltarDeployed])
	useLayoutEffect(
		() => () => {
			isMounted.current = false
		},
		[],
	)
	return {
		hasLoadedZoltarQuestions: hasLoadedZoltarQuestions.value,
		loadingZoltarQuestionCount: questionCountLoad.isLoading.value,
		loadingZoltarQuestion: questionByIdLoad.isLoading.value,
		loadingZoltarQuestions: questionsLoad.isLoading.value,
		loadZoltarQuestionCount: loadZoltarQuestionCountData,
		loadCreatedZoltarQuestion: loadCreatedQuestion,
		loadZoltarQuestion: loadQuestionById,
		loadZoltarQuestionPage: loadQuestionsPage,
		loadZoltarQuestions: loadQuestions,
		zoltarQuestionPage: zoltarQuestionPage.value,
		zoltarQuestionCount: zoltarQuestionCount.value,
		zoltarQuestionLookupError: zoltarQuestionLookupError.value,
		zoltarQuestionLookupId: zoltarQuestionLookupId.value,
		zoltarQuestions: zoltarQuestions.value,
		zoltarQuestionsError: zoltarQuestionsError.value,
		zoltarQuestionsFreshness: { refreshing: questionPageQuery?.fetching === true, updatedAt: questionPageQuery?.updatedAt },
		refreshInBackground,
		loadRequestedPageOrCount: () => {
			const page = requestedQuestionPage.current
			return page === undefined ? loadZoltarQuestionCountData() : loadQuestionsPage(page.pageIndex, page.pageSize)
		},
	}
}
