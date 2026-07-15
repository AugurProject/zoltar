import { useEffect, useRef, useState } from 'preact/hooks'
import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { PaginationControls } from './PaginationControls.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, QUESTION_PAGE_SIZE } from '../lib/pagination.js'
import {
	UI_STRING_ALREADY_FORKED,
	UI_STRING_CREATE_POOL_FROM_QUESTION,
	UI_STRING_CREATE_QUESTION,
	UI_STRING_LOADING_QUESTIONS,
	UI_STRING_MARKETS,
	UI_STRING_NO_QUESTIONS,
	UI_STRING_NO_QUESTIONS_MARKET_QUESTIONS_SECTION_NO_QUESTIONS_DETAIL,
	UI_STRING_NON_BINARY_QUESTIONS_ARE_VALID_IN_ZOLTAR_BUT_PLACEHOLDER_ORIGIN_POOLS_CURRENTLY_REQUIRE_AN_EXACT_BINARY_YES_NO_QUESTION,
	UI_STRING_QUESTION_PAGE_UNAVAILABLE,
	UI_STRING_USE_FOR_FORK,
} from '../lib/uiStrings.js'
import type { MarketDetailsPage } from '../types/contracts.js'

function isCurrentQuestionPage(page: MarketDetailsPage | undefined, pageIndex: number, questionCount: bigint | undefined) {
	return page?.pageIndex === pageIndex && page.pageSize === QUESTION_PAGE_SIZE && (questionCount === undefined || page.questionCount === questionCount)
}

type MarketQuestionsSectionProps = {
	environmentRefreshKey: number
	hasForked: boolean
	loadingZoltarQuestionCount: boolean
	loadingZoltarQuestions: boolean
	onCreateQuestion: () => void
	onLoadZoltarQuestionPage: (pageIndex: number, pageSize: number) => Promise<void>
	onOpenForkTab: () => void
	onUseQuestionForFork: (questionId: string) => void
	onUseQuestionForPool: (questionId: string) => void
	zoltarQuestionCount: bigint | undefined
	zoltarQuestionPage: MarketDetailsPage | undefined
}
export function MarketQuestionsSection({ environmentRefreshKey, hasForked, loadingZoltarQuestionCount, loadingZoltarQuestions, onCreateQuestion, onLoadZoltarQuestionPage, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestionCount, zoltarQuestionPage }: MarketQuestionsSectionProps) {
	const noQuestionsAvailable = zoltarQuestionCount === 0n
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [lastFailedPageRequestKey, setLastFailedPageRequestKey] = useState<string | undefined>(undefined)
	const lastSeenEnvironmentRefreshKeyRef = useRef(environmentRefreshKey)
	const lastRequestedPageKeyRef = useRef<string | undefined>(undefined)
	const currentPageRequestKey = `${environmentRefreshKey}:${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount?.toString() ?? 'unknown'}`
	const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount)
	const effectiveQuestionCount = zoltarQuestionPage?.questionCount ?? zoltarQuestionCount
	const questionPageCount = getPaginationPageCount(effectiveQuestionCount, QUESTION_PAGE_SIZE)
	const visibleQuestions = hasCurrentPageData && zoltarQuestionPage !== undefined ? zoltarQuestionPage.questions : []
	const isWaitingForPageData = activePageRequestKey === currentPageRequestKey
	useEffect(() => {
		setPageIndex(0)
	}, [zoltarQuestionCount])
	useEffect(() => {
		setLastFailedPageRequestKey(undefined)
		lastRequestedPageKeyRef.current = undefined
	}, [currentPageRequestKey])
	useEffect(() => {
		if (loadingZoltarQuestionCount) return
		if (zoltarQuestionCount === undefined || zoltarQuestionCount === 0n) return
		const pageRequestKey = `${environmentRefreshKey}:${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount.toString()}`
		const environmentChanged = lastSeenEnvironmentRefreshKeyRef.current !== environmentRefreshKey
		const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount)
		if (hasCurrentPageData && !environmentChanged) {
			if (lastFailedPageRequestKey === pageRequestKey) setLastFailedPageRequestKey(undefined)
			if (activePageRequestKey === pageRequestKey) setActivePageRequestKey(undefined)
			return
		}
		if (lastFailedPageRequestKey === pageRequestKey) return
		if (activePageRequestKey === pageRequestKey) return
		if (lastRequestedPageKeyRef.current === pageRequestKey) return
		lastRequestedPageKeyRef.current = pageRequestKey
		lastSeenEnvironmentRefreshKeyRef.current = environmentRefreshKey
		setActivePageRequestKey(pageRequestKey)
		void Promise.resolve(onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE))
			.catch(() => {
				setLastFailedPageRequestKey(current => (current === undefined ? pageRequestKey : current))
			})
			.finally(() => {
				setActivePageRequestKey(current => (current === pageRequestKey ? undefined : current))
			})
	}, [activePageRequestKey, environmentRefreshKey, lastFailedPageRequestKey, loadingZoltarQuestionCount, onLoadZoltarQuestionPage, pageIndex, zoltarQuestionCount, zoltarQuestionPage])
	const hasPreviousPage = pageIndex > 0
	const hasNextPage = getHasNextPaginationPage(pageIndex, questionPageCount)
	return (
		<SectionBlock
			density='compact'
			title={UI_STRING_MARKETS}
			actions={
				<PaginationControls
					hasNextPage={hasNextPage}
					hasPreviousPage={hasPreviousPage}
					loading={loadingZoltarQuestions}
					onNextPage={() => setPageIndex(current => current + 1)}
					onPreviousPage={() => setPageIndex(current => Math.max(0, current - 1))}
					summary={zoltarQuestionPage === undefined ? undefined : formatPaginationSummary(pageIndex, questionPageCount)}
				/>
			}
		>
			{visibleQuestions.length === 0 ? (
				(() => {
					if (loadingZoltarQuestionCount || loadingZoltarQuestions || isWaitingForPageData)
						return (
							<p className='detail'>
								<LoadingText>{UI_STRING_LOADING_QUESTIONS}</LoadingText>
							</p>
						)
					if (noQuestionsAvailable)
						return (
							<StateHint
								presentation={{
									key: 'empty',
									badgeLabel: UI_STRING_NO_QUESTIONS,
									badgeTone: 'muted',
									detail: UI_STRING_NO_QUESTIONS_MARKET_QUESTIONS_SECTION_NO_QUESTIONS_DETAIL,
								}}
								title={UI_STRING_NO_QUESTIONS}
								actions={
									<button className='primary' type='button' onClick={onCreateQuestion}>
										{UI_STRING_CREATE_QUESTION}
									</button>
								}
							/>
						)
					if (effectiveQuestionCount !== undefined && effectiveQuestionCount > 0n) return <p className='detail'>{UI_STRING_QUESTION_PAGE_UNAVAILABLE}</p>

					return undefined
				})()
			) : (
				<div className='entity-card-list'>
					{visibleQuestions.map(question => (
						<EntityCard
							key={question.questionId}
							title={getQuestionTitle(question)}
							actions={
								<div className='actions'>
									<button
										className='secondary'
										disabled={hasForked}
										onClick={() => {
											if (hasForked) return
											onUseQuestionForFork(question.questionId)
											onOpenForkTab()
										}}
									>
										{hasForked ? UI_STRING_ALREADY_FORKED : UI_STRING_USE_FOR_FORK}
									</button>
									<button className='secondary' onClick={() => onUseQuestionForPool(question.questionId)} disabled={question.marketType !== 'binary'}>
										{UI_STRING_CREATE_POOL_FROM_QUESTION}
									</button>
								</div>
							}
						>
							<Question question={question} showTitle={false} />
							{question.marketType !== 'binary' ? <p className='detail'>{UI_STRING_NON_BINARY_QUESTIONS_ARE_VALID_IN_ZOLTAR_BUT_PLACEHOLDER_ORIGIN_POOLS_CURRENTLY_REQUIRE_AN_EXACT_BINARY_YES_NO_QUESTION}</p> : undefined}
						</EntityCard>
					))}
				</div>
			)}
		</SectionBlock>
	)
}
