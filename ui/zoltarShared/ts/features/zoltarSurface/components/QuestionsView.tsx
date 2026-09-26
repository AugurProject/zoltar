import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import { useMemo, useState } from 'preact/hooks'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { DiscoveryControl, LocalCollectionSwitcher } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { useDownloadedEntities, useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { usePagedDiscovery, type DiscoveredPage } from '@zoltar/ui-core-shared/hooks/usePagedDiscovery.js'
import { buildLocalBrowseEntries, normalizeLocalSearchText, type LocalBrowseCollection } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { MarketRouteContentProps } from '../../types.js'
import { QUESTION_PAGE_SIZE } from '@zoltar/ui-core-shared/lib/pagination.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import { questionDownloadStore, questionMatchesSearch } from '../../../lib/questionBrowse.js'

type QuestionsViewProps = Pick<MarketRouteContentProps, 'loadingZoltarQuestions' | 'onActiveViewChange' | 'onLoadZoltarQuestionPage' | 'onZoltarForkQuestionIdChange' | 'zoltarQuestionPage' | 'zoltarQuestionsError'> & {
	canFork: boolean
	hasForked: boolean
	requestContextKey: number
}

/** Questions are browsed from this browser's favorites and downloaded summaries; the registry is scanned one page at a time on request. */
export function QuestionsView({ canFork, hasForked, loadingZoltarQuestions, onActiveViewChange, onLoadZoltarQuestionPage, onZoltarForkQuestionIdChange, requestContextKey, zoltarQuestionPage, zoltarQuestionsError }: QuestionsViewProps) {
	const [collection, setCollection] = useState<LocalBrowseCollection>('favorites')
	const [searchText, setSearchText] = useState('')
	const favorites = useFavorites('zoltar', 'question')
	const downloaded = useDownloadedEntities('zoltar', 'question', questionDownloadStore)
	const receivedPage = useMemo((): DiscoveredPage<MarketDetails> | undefined => {
		if (zoltarQuestionPage === undefined) return undefined
		return { items: zoltarQuestionPage.questions, pageIndex: zoltarQuestionPage.pageIndex, pageSize: zoltarQuestionPage.pageSize, totalCount: zoltarQuestionPage.questionCount }
	}, [zoltarQuestionPage])
	const discovery = usePagedDiscovery({
		contextKey: requestContextKey.toString(),
		loadPage: pageIndex => onLoadZoltarQuestionPage(pageIndex, QUESTION_PAGE_SIZE),
		onItems: questions => downloaded.record(questions.map(question => ({ data: question, id: question.questionId }))),
		pageSize: QUESTION_PAGE_SIZE,
		receivedPage,
	})
	const discoveryLoading = discovery.loading || loadingZoltarQuestions
	const discover = () => {
		setCollection('downloaded')
		discovery.discoverNext()
	}
	const favoriteEntries = buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'favorites')
	const entries = collection === 'favorites' ? favoriteEntries : buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'downloaded')
	const normalizedSearchText = normalizeLocalSearchText(searchText)
	const questions = entries.map(entry => entry.data).filter(question => questionMatchesSearch(question, normalizedSearchText))
	const loadError = zoltarQuestionsError ?? (discovery.loadFailed ? marketCopy.questionPageLoadError : undefined)
	const content = (() => {
		if (entries.length === 0) {
			if (collection === 'favorites' && downloaded.entries.length > 0)
				return (
					<EmptyState
						title={marketCopy.noFavoriteQuestions}
						detail={marketCopy.noFavoriteQuestionsWithDownloadsDetail}
						actions={
							<button className='secondary' type='button' onClick={() => setCollection('downloaded')}>
								{marketCopy.showDownloadedQuestions}
							</button>
						}
					/>
				)
			if (discovery.hasScanned && discovery.totalCount === 0n)
				return (
					<EmptyState
						title={marketCopy.noQuestions}
						detail={marketCopy.noQuestionsDetail}
						actions={
							<button className='primary' type='button' onClick={() => onActiveViewChange('create')}>
								{commonCopy.createQuestion}
							</button>
						}
					/>
				)
			if (collection === 'favorites') return <EmptyState title={marketCopy.noFavoriteQuestions} detail={marketCopy.noFavoriteQuestionsDetail} />
			return <EmptyState title={marketCopy.noDownloadedQuestions} detail={marketCopy.noDownloadedQuestionsDetail} />
		}
		if (questions.length === 0) return <EmptyState title={commonCopy.noMatches} detail={marketCopy.questionSearchNoMatches} />
		return (
			<div className='entity-card-list'>
				{questions.map(question => (
					<EntityCard
						surface='flat'
						className='directory-record'
						actions={
							canFork ? (
								<button
									className='secondary'
									disabled={hasForked}
									onClick={() => {
										favorites.setFavorite(question.questionId, true)
										onZoltarForkQuestionIdChange(question.questionId)
										onActiveViewChange('universes')
									}}
								>
									{hasForked ? marketCopy.alreadyForked : marketCopy.useForFork}
								</button>
							) : undefined
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
		)
	})()
	return (
		<div className='route-view-flow'>
			<RouteHeader description={canFork ? marketCopy.questionRegistryDescription : marketCopy.questionRegistryDescriptionWithoutUniverse} title={marketCopy.browseQuestions} />
			<SectionBlock title={marketCopy.questions} variant='plain'>
				<div className='local-browse-bar'>
					<LocalCollectionSwitcher collection={collection} downloadedCount={downloaded.entries.length} favoritesCount={favoriteEntries.length} onChange={setCollection} />
					<DiscoveryControl discovery={{ ...discovery, discoverNext: discover, loading: discoveryLoading }} discoverLabel={marketCopy.discoverQuestions} emphasize={downloaded.entries.length === 0} nounPlural={marketCopy.questionsNoun} />
				</div>
				<label className='field'>
					<span>{marketCopy.searchDownloadedQuestions}</span>
					<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={marketCopy.questionSearchPlaceholder} />
				</label>
				<ErrorNotice message={loadError} />
				{loadError === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' disabled={discoveryLoading} onClick={discovery.retry} type='button'>
							{discoveryLoading ? commonCopy.retrying : marketCopy.retryQuestions}
						</button>
					</div>
				)}
				{content}
			</SectionBlock>
		</div>
	)
}
