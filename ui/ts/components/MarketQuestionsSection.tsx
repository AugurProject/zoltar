import { useEffect, useRef, useState } from 'preact/hooks'
import { EntityCard } from './EntityCard.js'
import { LoadingText } from './LoadingText.js'
import { PaginationControls } from './PaginationControls.js'
import { Question, getQuestionTitle } from './Question.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, QUESTION_PAGE_SIZE } from '../lib/pagination.js'
import type { MarketDetailsPage } from '../types/contracts.js'

function isCurrentQuestionPage(page: MarketDetailsPage | undefined, pageIndex: number, questionCount: bigint | undefined) {
	return page?.pageIndex === pageIndex && page.pageSize === QUESTION_PAGE_SIZE && (questionCount === undefined || page.questionCount === questionCount)
}

type MarketQuestionsSectionProps = {
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
export function MarketQuestionsSection({ hasForked, loadingZoltarQuestionCount, loadingZoltarQuestions, onCreateQuestion, onLoadZoltarQuestionPage, onOpenForkTab, onUseQuestionForFork, onUseQuestionForPool, zoltarQuestionCount, zoltarQuestionPage }: MarketQuestionsSectionProps) {
	const noQuestionsAvailable = zoltarQuestionCount === 0n
	const [pageIndex, setPageIndex] = useState(0)
	const [activePageRequestKey, setActivePageRequestKey] = useState<string | undefined>(undefined)
	const [lastFailedPageRequestKey, setLastFailedPageRequestKey] = useState<string | undefined>(undefined)
	const lastRequestedPageKeyRef = useRef<string | undefined>(undefined)
	const currentPageRequestKey = `${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount?.toString() ?? 'unknown'}`
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
		const pageRequestKey = `${pageIndex}:${QUESTION_PAGE_SIZE}:${zoltarQuestionCount.toString()}`
		const hasCurrentPageData = isCurrentQuestionPage(zoltarQuestionPage, pageIndex, zoltarQuestionCount)
		if (hasCurrentPageData) {
			if (lastFailedPageRequestKey === pageRequestKey) setLastFailedPageRequestKey(undefined)
			if (activePageRequestKey === pageRequestKey) setActivePageRequestKey(undefined)
			return
		}
		if (lastFailedPageRequestKey === pageRequestKey) return
		if (activePageRequestKey === pageRequestKey) return
		if (lastRequestedPageKeyRef.current === pageRequestKey) return
		lastRequestedPageKeyRef.current = pageRequestKey
		setActivePageRequestKey(pageRequestKey)
		void Promise.resolve(onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE))
			.catch(() => {
				setLastFailedPageRequestKey(current => (current === undefined ? pageRequestKey : current))
			})
			.finally(() => {
				setActivePageRequestKey(current => (current === pageRequestKey ? undefined : current))
			})
	}, [activePageRequestKey, lastFailedPageRequestKey, loadingZoltarQuestionCount, onLoadZoltarQuestionPage, pageIndex, zoltarQuestionCount, zoltarQuestionPage])
	const hasPreviousPage = pageIndex > 0
	const hasNextPage = getHasNextPaginationPage(pageIndex, questionPageCount)
	return (
		<SectionBlock
			density='compact'
			title='Markets'
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
								<LoadingText>Loading questions...</LoadingText>
							</p>
						)
					if (noQuestionsAvailable)
						return (
							<StateHint
								presentation={{
									key: 'empty',
									badgeLabel: 'None yet',
									badgeTone: 'muted',
									detail: 'No questions are available in this universe yet. Create a question first, then use it to create a security pool for trading and reporting.',
								}}
								title='No questions'
								actions={
									<button className='primary' type='button' onClick={onCreateQuestion}>
										Create Question
									</button>
								}
							/>
						)
					if (effectiveQuestionCount !== undefined && effectiveQuestionCount > 0n) return <StateHint presentation={{ key: 'not_checked', badgeLabel: 'Not checked', badgeTone: 'muted', detail: 'Questions for this page have not loaded yet.' }} />

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
										{hasForked ? 'Already Forked' : 'Use For Fork'}
									</button>
									<button className='secondary' onClick={() => onUseQuestionForPool(question.questionId)} disabled={question.marketType !== 'binary'}>
										Use For Create Pool
									</button>
								</div>
							}
						>
							<Question question={question} showTitle={false} />
						</EntityCard>
					))}
				</div>
			)}
		</SectionBlock>
	)
}
