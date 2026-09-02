import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { ChildUniverseDeploymentSection } from '../../universes/components/ChildUniverseDeploymentSection.js'
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js'
import { ZoltarMigrationSection } from '../../universes/components/ZoltarMigrationSection.js'
import { UniverseDirectorySection } from '../../universes/components/UniverseDirectorySection.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { QuestionCreateSection } from '../../questions/components/QuestionCreateSection.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { getUniversePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseCollectionLabel } from '../../universes/lib/universe.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { MarketRouteContentProps } from '../../types.js'
import { QUESTION_PAGE_SIZE, formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount, resolvePaginationPageIndex } from '@zoltar/ui-core-shared/lib/pagination.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'

type QuestionsViewProps = Pick<MarketRouteContentProps, 'loadingZoltarQuestions' | 'onActiveViewChange' | 'onLoadZoltarQuestionPage' | 'onZoltarForkQuestionIdChange' | 'zoltarQuestionPage' | 'zoltarQuestionsError'> & {
	canFork: boolean
	hasForked: boolean
	requestContextKey: number
}

export function QuestionsView({ canFork, hasForked, loadingZoltarQuestions, onActiveViewChange, onLoadZoltarQuestionPage, onZoltarForkQuestionIdChange, requestContextKey, zoltarQuestionPage, zoltarQuestionsError }: QuestionsViewProps) {
	const [pageIndex, setPageIndex] = useState(0)
	const [retryRequestNonce, setRetryRequestNonce] = useState(0)
	const [searchText, setSearchText] = useState('')
	const loadQuestionPageRef = useRef(onLoadZoltarQuestionPage)
	useEffect(() => {
		loadQuestionPageRef.current = onLoadZoltarQuestionPage
	}, [onLoadZoltarQuestionPage])
	useEffect(() => {
		void loadQuestionPageRef.current(pageIndex, QUESTION_PAGE_SIZE).catch(() => undefined)
	}, [pageIndex, requestContextKey, retryRequestNonce])
	const requestedPageCount = getPaginationPageCount(zoltarQuestionPage?.questionCount, QUESTION_PAGE_SIZE)
	const resolvedPageIndex = resolvePaginationPageIndex(pageIndex, requestedPageCount)
	useEffect(() => {
		if (resolvedPageIndex !== pageIndex) setPageIndex(resolvedPageIndex)
	}, [pageIndex, resolvedPageIndex])
	const currentPage = zoltarQuestionPage?.pageIndex === resolvedPageIndex && zoltarQuestionPage.pageSize === QUESTION_PAGE_SIZE ? zoltarQuestionPage : undefined
	const normalizedSearchText = searchText.trim().toLowerCase()
	const questions =
		currentPage?.questions.filter(question => {
			if (normalizedSearchText === '') return true
			return question.questionId.toLowerCase().includes(normalizedSearchText) || question.title.toLowerCase().includes(normalizedSearchText) || question.description.toLowerCase().includes(normalizedSearchText)
		}) ?? []
	const pageCount = getPaginationPageCount(currentPage?.questionCount, QUESTION_PAGE_SIZE)
	return (
		<div className='route-view-flow'>
			<RouteHeader description={canFork ? marketCopy.questionRegistryDescription : marketCopy.questionRegistryDescriptionWithoutUniverse} title={marketCopy.browseQuestions} />
			<SectionBlock
				actions={
					<PaginationControls
						hasNextPage={getHasNextPaginationPage(resolvedPageIndex, pageCount)}
						hasPreviousPage={resolvedPageIndex > 0}
						loading={loadingZoltarQuestions}
						onNextPage={() => setPageIndex(current => current + 1)}
						onPreviousPage={() => setPageIndex(current => Math.max(0, current - 1))}
						summary={formatPaginationSummary(resolvedPageIndex, pageCount)}
					/>
				}
				title={marketCopy.questions}
				variant='plain'
			>
				<label className='field question-page-search'>
					<span>{marketCopy.searchLoadedQuestions}</span>
					<FormInput value={searchText} onInput={event => setSearchText(event.currentTarget.value)} placeholder={marketCopy.questionSearchPlaceholder} />
				</label>
				<ErrorNotice message={zoltarQuestionsError} />
				{zoltarQuestionsError === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' disabled={loadingZoltarQuestions} onClick={() => setRetryRequestNonce(currentNonce => currentNonce + 1)} type='button'>
							{loadingZoltarQuestions ? commonCopy.retrying : marketCopy.retryQuestions}
						</button>
					</div>
				)}
				{loadingZoltarQuestions && currentPage === undefined ? <StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: marketCopy.loadingQuestions }} /> : undefined}
				{!loadingZoltarQuestions && currentPage !== undefined && currentPage.questions.length === 0 ? <StateHint presentation={{ key: 'empty', badgeLabel: marketCopy.noQuestions, badgeTone: 'muted', detail: marketCopy.noQuestions }} /> : undefined}
				{currentPage !== undefined && currentPage.questions.length > 0 && questions.length === 0 ? <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: marketCopy.questionPageNoMatches }} /> : undefined}
				<div className='entity-card-list'>
					{questions.map(question => (
						<EntityCard
							actions={
								canFork ? (
									<button
										className='secondary'
										disabled={hasForked}
										onClick={() => {
											onZoltarForkQuestionIdChange(question.questionId)
											onActiveViewChange('fork')
										}}
									>
										{hasForked ? marketCopy.alreadyForked : marketCopy.useForFork}
									</button>
								) : undefined
							}
							badge={<Badge tone='muted'>{getMarketTypeLabel(question.marketType)}</Badge>}
							key={question.questionId}
							title={getQuestionTitle(question)}
							variant='record'
						>
							<Question question={question} showTitle={false} variant='preview' />
						</EntityCard>
					))}
				</div>
			</SectionBlock>
		</div>
	)
}

type ZoltarUniverseOverviewProps = {
	accountAddress: Address | undefined
	isOnActiveAppChain: boolean
	onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void
	zoltarChildUniversePendingOutcomeIndex: bigint | undefined
	zoltarUniverse: ZoltarUniverseSummary
}

function ZoltarUniverseOverview({ accountAddress, isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse }: ZoltarUniverseOverviewProps) {
	const hasForked = zoltarUniverse.hasForked === true
	const currentUniverseName = formatUniverseCollectionLabel([zoltarUniverse.universeId])

	return (
		<>
			<DataGrid className='market-overview-grid'>
				<MetricField label={commonCopy.universe}>{currentUniverseName}</MetricField>
				<MetricField label={commonCopy.status}>{hasForked ? commonCopy.forked : marketCopy.unforked}</MetricField>
			</DataGrid>
			<ChildUniverseDeploymentSection accountAddress={accountAddress} childUniverses={zoltarUniverse.childUniverses} hasForked={hasForked} isOnActiveAppChain={isOnActiveAppChain} onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex} pendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex} />
		</>
	)
}

export function ZoltarSection({
	accountState,
	activeUniverseId,
	activeView,
	environmentRefreshKey,
	loadingZoltarForkAccess,
	loadingZoltarQuestion,
	loadingZoltarQuestions,
	loadingZoltarUniverse,
	hasLoadedZoltarQuestions,
	onActiveViewChange,
	onApproveZoltarForkRep,
	onCreateChildUniverseForOutcomeIndex,
	onCreateQuestion,
	onForkZoltar,
	onLoadZoltarQuestion,
	onLoadZoltarQuestionPage,
	onMigrateInternalRep,
	onPrepareRepForMigration,
	onQuestionFormChange,
	onResetQuestion,
	onZoltarForkQuestionIdChange,
	onZoltarMigrationFormChange,
	zoltarChildUniversePendingOutcomeIndex,
	zoltarForkActiveAction,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalanceAttoRep,
	zoltarMigrationActiveAction,
	zoltarMigrationChildRepBalancesAttoRep,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalanceAttoRep,
	zoltarQuestionLookupError,
	zoltarQuestionLookupId,
	zoltarQuestionPage,
	zoltarQuestionsError,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
	questionCreating,
	questionError,
	questionForm,
	questionResult,
}: MarketRouteContentProps) {
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	if (activeView === 'create') {
		return (
			<>
				<RouteHeader description={marketCopy.createQuestionDescription} title={commonCopy.createQuestion} />
				<QuestionCreateSection
					accountAddress={accountState.address}
					canUseForFork={zoltarUniverse !== undefined}
					hasForked={zoltarUniverse?.hasForked === true}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingZoltarQuestions={loadingZoltarQuestions}
					questionCreating={questionCreating}
					questionError={questionError}
					questionForm={questionForm}
					questionResult={questionResult}
					onCreateQuestion={onCreateQuestion}
					onOpenForkTab={() => onActiveViewChange('fork')}
					onQuestionFormChange={onQuestionFormChange}
					onResetQuestion={onResetQuestion}
					onUseQuestionForFork={onZoltarForkQuestionIdChange}
					zoltarQuestions={zoltarQuestions}
				/>
			</>
		)
	}

	const questionsView = (
		<QuestionsView
			canFork={zoltarUniverse !== undefined}
			hasForked={zoltarUniverse?.hasForked === true}
			loadingZoltarQuestions={loadingZoltarQuestions}
			onActiveViewChange={onActiveViewChange}
			onLoadZoltarQuestionPage={onLoadZoltarQuestionPage}
			onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
			requestContextKey={environmentRefreshKey}
			zoltarQuestionPage={zoltarQuestionPage}
			zoltarQuestionsError={zoltarQuestionsError}
		/>
	)
	if (activeView === 'questions' || zoltarUniverseState === 'missing') return questionsView

	if (activeView === 'universes') {
		return (
			<>
				<RouteHeader title={commonCopy.universe} />
				<UniverseDirectorySection activeUniverseId={activeUniverseId} zoltarUniverse={zoltarUniverse} />
			</>
		)
	}

	if (zoltarUniverse === undefined) {
		return <StateHint presentation={getUniversePresentation('loading') ?? { key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: commonCopy.loadingUniverseDetails }} />
	}

	if (activeView === 'fork') {
		return (
			<>
				<RouteHeader title={zoltarCopy.forkZoltar} />
				<ForkZoltarSection
					accountAddress={accountState.address}
					hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingZoltarForkAccess={loadingZoltarForkAccess}
					loadingZoltarQuestion={loadingZoltarQuestion}
					loadingZoltarQuestions={loadingZoltarQuestions}
					onApproveZoltarForkRep={amount => onApproveZoltarForkRep(amount)}
					onForkZoltar={onForkZoltar}
					onRetryZoltarQuestion={zoltarForkQuestionId.trim() === '' ? undefined : () => void onLoadZoltarQuestion(zoltarForkQuestionId.trim())}
					onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
					zoltarForkActiveAction={zoltarForkActiveAction}
					zoltarForkApproval={zoltarForkApproval}
					zoltarForkError={zoltarForkError}
					zoltarForkPending={zoltarForkPending}
					zoltarForkQuestionId={zoltarForkQuestionId}
					zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
					zoltarQuestionLookupError={zoltarQuestionLookupError}
					zoltarQuestionLookupId={zoltarQuestionLookupId}
					zoltarQuestions={zoltarQuestions}
					zoltarUniverse={zoltarUniverse}
					zoltarUniverseState={zoltarUniverseState}
				/>
			</>
		)
	}

	if (activeView === 'migrate') {
		return (
			<>
				<RouteHeader title={zoltarCopy.migrateRep} />
				<ZoltarMigrationSection
					accountAddress={accountState.address}
					isOnActiveAppChain={isOnActiveAppChain}
					loadingZoltarForkAccess={loadingZoltarForkAccess}
					loadingZoltarUniverse={loadingZoltarUniverse}
					onApproveZoltarForkRep={amount => onApproveZoltarForkRep(amount)}
					onMigrateInternalRep={onMigrateInternalRep}
					onPrepareRepForMigration={onPrepareRepForMigration}
					onZoltarMigrationFormChange={onZoltarMigrationFormChange}
					zoltarForkActiveAction={zoltarForkActiveAction}
					zoltarForkApproval={zoltarForkApproval}
					zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
					zoltarMigrationActiveAction={zoltarMigrationActiveAction}
					zoltarMigrationChildRepBalancesAttoRep={zoltarMigrationChildRepBalancesAttoRep}
					zoltarMigrationError={zoltarMigrationError}
					zoltarMigrationForm={zoltarMigrationForm}
					zoltarMigrationPending={zoltarMigrationPending}
					zoltarMigrationPreparedRepBalanceAttoRep={zoltarMigrationPreparedRepBalanceAttoRep}
					zoltarUniverse={zoltarUniverse}
					zoltarUniverseState={zoltarUniverseState}
				/>
			</>
		)
	}

	return <ZoltarUniverseOverview accountAddress={accountState.address} isOnActiveAppChain={isOnActiveAppChain} onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex} zoltarChildUniversePendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex} zoltarUniverse={zoltarUniverse} />
}
