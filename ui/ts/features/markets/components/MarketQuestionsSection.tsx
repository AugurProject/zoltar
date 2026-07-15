import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { EntityCard } from '../../../components/EntityCard.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StateHint } from '../../../components/StateHint.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, QUESTION_PAGE_SIZE } from '../../../lib/pagination.js'
import type { MarketDetailsPage } from '../../../types/contracts.js'

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
			title={commonCopy.markets}
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
								<LoadingText>{marketCopy.loadingQuestions}</LoadingText>
							</p>
						)
					if (noQuestionsAvailable)
						return (
							<StateHint
								presentation={{
									key: 'empty',
									badgeLabel: marketCopy.noQuestions,
									badgeTone: 'muted',
									detail: marketCopy.noQuestionsDetail,
								}}
								title={marketCopy.noQuestions}
								actions={
									<button className='primary' type='button' onClick={onCreateQuestion}>
										{commonCopy.createQuestion}
									</button>
								}
							/>
						)
					if (effectiveQuestionCount !== undefined && effectiveQuestionCount > 0n) return <p className='detail'>{marketCopy.questionPageUnavailable}</p>

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
										{hasForked ? marketCopy.alreadyForked : marketCopy.useForFork}
									</button>
									<button className='secondary' onClick={() => onUseQuestionForPool(question.questionId)} disabled={question.marketType !== 'binary'}>
										{marketCopy.createPoolFromQuestion}
									</button>
								</div>
							}
						>
							<Question question={question} showTitle={false} />
							{question.marketType !== 'binary' ? <p className='detail'>{marketCopy.nonBinaryPoolCompatibilityDetail}</p> : undefined}
						</EntityCard>
					))}
				</div>
			)}
		</SectionBlock>
	)
}
