import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { useId, useMemo } from 'preact/hooks'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { LocalBrowseBar, LocalBrowseSearchField, LocalCollectionEmptyState } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { useLocalBrowseDirectory } from '@zoltar/ui-core-shared/hooks/useLocalBrowseDirectory.js'
import type { DiscoveredPage } from '@zoltar/ui-core-shared/hooks/usePagedDiscovery.js'
import type { MarketDetails, MarketDetailsPage } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ZoltarView } from '../../types.js'
import { QUESTION_PAGE_SIZE } from '@zoltar/ui-core-shared/lib/pagination.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import { questionDownloadStore, questionMatchesSearch } from '../../../lib/questionBrowse.js'
import { UseForForkAction } from '../../questions/components/UseForForkAction.js'
import { getForkQuestionTimingReason } from '../../questions/lib/questionForkHandoff.js'
import type { ForkHandoff } from '../lib/zoltarViewModels.js'

type QuestionsViewProps = {
	currentTimestamp: bigint | undefined
	forkHandoff: ForkHandoff
	zoltarQuestionsFreshness: DataFreshness
	loadingZoltarQuestions: boolean
	onActiveViewChange: (view: ZoltarView) => void
	onLoadZoltarQuestionPage: (pageIndex: number, pageSize: number) => Promise<void>
	onZoltarForkQuestionIdChange: (questionId: string) => void
	zoltarQuestionPage: MarketDetailsPage | undefined
	zoltarQuestionsError: string | undefined
	requestContextKey: number
}

/** The first registry page loads on entry; favorites and downloaded summaries remain searchable while it refreshes. */
export function QuestionsView({ currentTimestamp, forkHandoff, loadingZoltarQuestions, onActiveViewChange, onLoadZoltarQuestionPage, onZoltarForkQuestionIdChange, requestContextKey, zoltarQuestionPage, zoltarQuestionsError, zoltarQuestionsFreshness }: QuestionsViewProps) {
	const receivedPage = useMemo((): DiscoveredPage<MarketDetails> | undefined => {
		if (zoltarQuestionPage === undefined) return undefined
		return { items: zoltarQuestionPage.questions, pageIndex: zoltarQuestionPage.pageIndex, pageSize: zoltarQuestionPage.pageSize, totalCount: zoltarQuestionPage.questionCount }
	}, [zoltarQuestionPage])
	const directory = useLocalBrowseDirectory({
		app: 'zoltar',
		contextKey: requestContextKey.toString(),
		externalLoading: loadingZoltarQuestions,
		kind: 'question',
		loadPage: pageIndex => onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE),
		pageSize: QUESTION_PAGE_SIZE,
		receivedPage,
		// After a scan, block refreshes of the last scanned page keep its cached questions current.
		refreshedItems: zoltarQuestionPage?.questions,
		store: questionDownloadStore,
		toDownloadedItem: question => ({ data: question, id: question.questionId }),
	})
	const { discovery, entries, favorites } = directory
	const questions = entries.map(entry => entry.data).filter(question => questionMatchesSearch(question, directory.normalizedSearchText))
	const loadError = zoltarQuestionsError ?? (discovery.loadFailed ? marketCopy.questionPageLoadError : undefined)
	// A reason that blocks every question (universe details or chain time unavailable) is stated once above the list.
	const sharedForkReasonId = useId()
	let sharedForkReason: string | undefined
	if (forkHandoff.kind === 'offered') sharedForkReason = forkHandoff.universeReason ?? (currentTimestamp === undefined ? zoltarCopy.forkQuestionTimeLoadingReason : undefined)
	const content = (() => {
		if (entries.length === 0 && discovery.loading) return undefined
		if (entries.length === 0 && loadError !== undefined) return undefined
		if (entries.length === 0)
			return (
				<LocalCollectionEmptyState
					copy={{
						downloadedEmpty: marketCopy.noDownloadedQuestions,
						favoritesEmpty: marketCopy.noFavoriteQuestions,
						favoritesEmptyDetail: marketCopy.noFavoriteQuestionsDetail,
						favoritesEmptyWithDownloadsDetail: marketCopy.noFavoriteQuestionsWithDownloadsDetail,
						showDownloaded: marketCopy.showDownloadedQuestions,
					}}
					directory={directory}
					registryEmpty={
						<EmptyState
							title={marketCopy.noQuestions}
							detail={marketCopy.noQuestionsDetail}
							actions={
								<button className='primary' type='button' onClick={() => onActiveViewChange('create')}>
									{commonCopy.createQuestion}
								</button>
							}
						/>
					}
				/>
			)
		if (questions.length === 0) return <EmptyState title={commonCopy.noMatches} detail={marketCopy.questionSearchNoMatches} />
		return (
			<>
				{sharedForkReason === undefined ? undefined : <UserMessage detail={sharedForkReason} id={sharedForkReasonId} placement='field' />}
				<div className='entity-card-list'>
					{questions.map(question => (
						<EntityCard
							surface='flat'
							className='directory-record'
							actions={
								forkHandoff.kind === 'omitted' ? undefined : (
									<UseForForkAction
										hasForked={forkHandoff.kind === 'forked'}
										onUse={() => {
											favorites.setFavorite(question.questionId, true)
											onZoltarForkQuestionIdChange(question.questionId)
											onActiveViewChange('fork')
										}}
										questionId={question.questionId}
										questionTitle={getQuestionTitle(question)}
										reason={sharedForkReason ?? getForkQuestionTimingReason(question.endTime, currentTimestamp)}
										reasonElementId={sharedForkReason === undefined ? undefined : sharedForkReasonId}
									/>
								)
							}
							badge={
								<>
									<Badge tone='muted'>{getMarketTypeLabel(question.marketType)}</Badge>
									<FavoriteToggle app='zoltar' entityLabel={getQuestionTitle(question)} id={question.questionId} kind='question' />
								</>
							}
							key={question.questionId}
							title={getQuestionTitle(question)}
							variant='compact'
						>
							<p className='detail'>
								{commonCopy.endTime} <TimestampValue timestamp={question.endTime} />
							</p>
							<ReadOnlyDetailAccordion
								title={marketCopy.questionDetails}
								onToggle={open => {
									if (open) favorites.setFavorite(question.questionId, true)
								}}
							>
								<Question question={question} showTitle={false} showEndTime={false} variant='preview' />
							</ReadOnlyDetailAccordion>
						</EntityCard>
					))}
				</div>
			</>
		)
	})()
	return (
		<div className='route-view-flow'>
			<RouteHeader description={forkHandoff.kind === 'offered' ? marketCopy.questionRegistryDescription : marketCopy.questionRegistryDescriptionWithoutUniverse} title={marketCopy.browseQuestions} />
			<SectionBlock title={marketCopy.questions} variant='plain'>
				<LocalBrowseBar directory={directory} freshness={zoltarQuestionsFreshness} nounPlural={marketCopy.questionsNoun} />
				<LocalBrowseSearchField label={marketCopy.searchDownloadedQuestions} onChange={directory.setSearchText} placeholder={marketCopy.questionSearchPlaceholder} value={directory.searchText} />
				<RetryableNotice disabled={discovery.loading} message={loadError} onRetry={discovery.retry} retryLabel={discovery.loading ? commonCopy.retrying : commonCopy.retry} />
				{content}
			</SectionBlock>
		</div>
	)
}
