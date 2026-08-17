import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as marketCopy from '@zoltar/ui-zoltar/copy/market.js'
import * as zoltarCopy from '@zoltar/ui-zoltar/copy/zoltar.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ForkZoltarSection } from '@zoltar/ui-zoltar/features/universes/components/ForkZoltarSection.js'
import { MarketCreateQuestionSection } from './MarketCreateQuestionSection.js'
import { MarketOverviewSection } from './MarketOverviewSection.js'
import { MarketQuestionsSection } from './MarketQuestionsSection.js'
import { Question } from './Question.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionUniverseValue } from '@zoltar/ui-zoltar/features/universes/components/TransactionUniverseValue.js'
import { ZoltarMigrationSection } from '@zoltar/ui-zoltar/features/universes/components/ZoltarMigrationSection.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js'
import { getMarketTypeLabel } from '@zoltar/ui-core-shared/lib/marketType.js'
import type { MarketSectionProps } from '../../types.js'

export function MarketSection({
	accountState,
	activeView,
	environmentRefreshKey,
	securityPools = [],
	hasLoadedSecurityPools,
	hasLoadedZoltarQuestions,
	loadingZoltarForkAccess,
	zoltarForkActiveAction,
	loadingZoltarQuestionCount,
	loadingZoltarQuestion,
	loadingZoltarQuestions,
	loadingZoltarUniverse,
	loadingSecurityPools,
	marketForm,
	marketCreating,
	marketError,
	marketResult,
	onActiveViewChange,
	onApproveZoltarForkRep,
	onCreateChildUniverseForOutcomeIndex,
	onCreateMarket,
	onForkZoltar,
	onLoadZoltarQuestions,
	onLoadZoltarQuestion,
	onLoadZoltarQuestionPage,
	onLoadSecurityPools,
	onMarketFormChange,
	onMigrateInternalRep,
	onPrepareRepForMigration,
	onResetMarket,
	onUseQuestionForFork,
	onUseQuestionForPool,
	onZoltarForkQuestionIdChange,
	onZoltarMigrationFormChange,
	zoltarChildUniverseError,
	zoltarChildUniversePendingOutcomeIndex,
	zoltarForkApproval,
	zoltarForkError,
	zoltarForkPending,
	zoltarForkQuestionId,
	zoltarForkRepBalanceAttoRep,
	zoltarMigrationChildRepBalancesAttoRep,
	zoltarMigrationActiveAction,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalanceAttoRep,
	zoltarQuestionCount,
	zoltarQuestionLookupError,
	zoltarQuestionLookupId,
	zoltarQuestionPage,
	zoltarQuestions,
	zoltarQuestionsError,
	zoltarUniverse,
	zoltarUniverseState,
	securityPoolsLoadError,
}: MarketSectionProps) {
	const hasForked = zoltarUniverse?.hasForked === true
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const view = activeView
	const showUniverseSummary = view === 'questions' && zoltarUniverse !== undefined
	const [forkModalOpen, setForkModalOpen] = useState(false)
	const requestedForkQuestionId = useRef<string | undefined>(undefined)
	const localForkQuestionId = zoltarForkQuestionId.trim()
	const canonicalForkQuestion = zoltarUniverse?.forkQuestionDetails
	const selectedForkQuestionId = hasForked ? canonicalForkQuestion?.questionId : localForkQuestionId || canonicalForkQuestion?.questionId
	const normalizedSelectedForkQuestionId = selectedForkQuestionId === undefined ? undefined : normalizeQuestionId(selectedForkQuestionId)
	const selectedForkQuestion =
		normalizedSelectedForkQuestionId === undefined
			? undefined
			: (zoltarQuestions.find(question => normalizeQuestionId(question.questionId) === normalizedSelectedForkQuestionId) ?? (canonicalForkQuestion !== undefined && normalizeQuestionId(canonicalForkQuestion.questionId) === normalizedSelectedForkQuestionId ? canonicalForkQuestion : undefined))
	const isSelectedForkQuestionLookup = normalizedSelectedForkQuestionId !== undefined && zoltarQuestionLookupId === normalizedSelectedForkQuestionId
	const forkQuestionLookupLoading = selectedForkQuestion === undefined && (loadingZoltarQuestions || (isSelectedForkQuestionLookup && loadingZoltarQuestion))
	const forkQuestionMetadataFallback = forkQuestionLookupLoading ? commonCopy.loadingWithEllipsis : commonCopy.unavailable
	const forkModalTitle = hasForked ? zoltarCopy.viewForkDetailsTitle : zoltarCopy.forkZoltar
	const permanentRepBurn = zoltarUniverse?.forkBurnDivisor === undefined || zoltarUniverse.forkBurnDivisor <= 1n ? undefined : zoltarUniverse.forkThresholdAttoRep / zoltarUniverse.forkBurnDivisor
	const forkContext = [
		{ label: commonCopy.question, value: selectedForkQuestion?.title ?? selectedForkQuestionId ?? commonCopy.noneSelected },
		{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={zoltarUniverse?.universeId} /> },
	]

	useEffect(() => {
		if (view !== 'migrate') return
		if (zoltarUniverse === undefined) return
		if (hasForked) return
		onActiveViewChange('questions')
	}, [hasForked, onActiveViewChange, view, zoltarUniverse])

	useEffect(() => {
		if (!forkModalOpen) {
			requestedForkQuestionId.current = undefined
			return
		}
		if (hasForked || selectedForkQuestion !== undefined || normalizedSelectedForkQuestionId === undefined) return
		if (requestedForkQuestionId.current === normalizedSelectedForkQuestionId) return
		const timeoutId = window.setTimeout(() => {
			requestedForkQuestionId.current = normalizedSelectedForkQuestionId
			void onLoadZoltarQuestion(normalizedSelectedForkQuestionId)
		}, 250)
		return () => window.clearTimeout(timeoutId)
	}, [forkModalOpen, hasForked, normalizedSelectedForkQuestionId, onLoadZoltarQuestion, selectedForkQuestion])

	return (
		<div className='route-view-flow'>
			<SectionBlock className={view === 'questions' ? '' : 'market-task-context'} density='compact' description={marketCopy.zoltarIntroduction} title={commonCopy.zoltar} variant='plain'>
				{showUniverseSummary ? (
					<MarketOverviewSection
						accountAddress={accountState.address}
						isOnActiveAppChain={isOnActiveAppChain}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
						zoltarChildUniverseError={zoltarChildUniverseError}
						zoltarChildUniversePendingOutcomeIndex={zoltarChildUniversePendingOutcomeIndex}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
					/>
				) : (
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>{commonCopy.universe}</p>
							<strong>{zoltarUniverse === undefined ? <LoadingText /> : <TransactionUniverseValue universeId={zoltarUniverse.universeId} />}</strong>
						</div>
						<div>
							<p className='detail'>{commonCopy.status}</p>
							<strong>{hasForked ? commonCopy.forked : marketCopy.unforked}</strong>
						</div>
						<div>
							<p className='detail'>{marketCopy.questions}</p>
							<strong>{zoltarQuestionCount?.toString() ?? commonCopy.metricUnavailablePlaceholder}</strong>
						</div>
					</DataGrid>
				)}
			</SectionBlock>
			<div className='workflow-stack route-workflow-stack'>
				{view === 'questions' ? (
					<>
						{hasForked ? (
							<SectionBlock title={marketCopy.postForkActions} description={marketCopy.forkMigrationPrimaryActionDetail}>
								<div className='actions'>
									<button className='primary' type='button' onClick={() => onActiveViewChange('migrate')}>
										{marketCopy.openRepMigration}
									</button>
								</div>
							</SectionBlock>
						) : undefined}
						<MarketQuestionsSection
							environmentRefreshKey={environmentRefreshKey}
							hasForked={hasForked}
							onCreateQuestion={() => onActiveViewChange('create')}
							onLoadZoltarQuestions={onLoadZoltarQuestions}
							onLoadZoltarQuestionPage={onLoadZoltarQuestionPage}
							loadingZoltarQuestionCount={loadingZoltarQuestionCount}
							loadingZoltarQuestions={loadingZoltarQuestions}
							loadingSecurityPools={loadingSecurityPools}
							hasLoadedSecurityPools={hasLoadedSecurityPools}
							onLoadSecurityPools={onLoadSecurityPools}
							onOpenForkTab={() => onActiveViewChange('fork')}
							onUseQuestionForFork={onUseQuestionForFork}
							onUseQuestionForPool={onUseQuestionForPool}
							zoltarQuestionCount={zoltarQuestionCount}
							zoltarQuestionPage={zoltarQuestionPage}
							zoltarQuestionsError={zoltarQuestionsError}
							securityPools={securityPools}
							securityPoolsLoadError={securityPoolsLoadError}
						/>
					</>
				) : undefined}

				{view === 'create' ? (
					<MarketCreateQuestionSection
						accountAddress={accountState.address}
						hasForked={hasForked}
						isOnActiveAppChain={isOnActiveAppChain}
						loadingZoltarQuestions={loadingZoltarQuestions}
						marketCreating={marketCreating}
						marketError={marketError}
						marketForm={marketForm}
						marketResult={marketResult}
						onCreateMarket={onCreateMarket}
						onMarketFormChange={onMarketFormChange}
						onOpenForkTab={() => onActiveViewChange('fork')}
						onResetMarket={onResetMarket}
						onUseQuestionForFork={onUseQuestionForFork}
						onUseQuestionForPool={onUseQuestionForPool}
						zoltarQuestions={zoltarQuestions}
					/>
				) : undefined}

				{view === 'fork' ? (
					<>
						<SectionBlock title={marketCopy.fork}>
							{hasForked ? undefined : (
								<DataGrid>
									<MetricField label={commonCopy.forkThresholdAttoRep}>
										<CurrencyValue loading={loadingZoltarUniverse} value={zoltarUniverse?.forkThresholdAttoRep} suffix={commonCopy.rep} />
									</MetricField>
									<MetricField label={zoltarCopy.permanentRepBurn}>
										<CurrencyValue loading={loadingZoltarUniverse} value={permanentRepBurn} suffix={commonCopy.rep} />
									</MetricField>
								</DataGrid>
							)}
							<div className='actions'>
								<ActionLauncherButton availability={{ disabled: false, reason: undefined }} idleLabel={hasForked ? zoltarCopy.viewForkDetails : forkModalTitle} onClick={() => setForkModalOpen(true)} pending={false} pendingLabel={forkModalTitle} />
							</div>
							{selectedForkQuestionId === undefined ? undefined : (
								<section aria-label={marketCopy.selectedForkQuestionSummary} className='selected-fork-question-summary'>
									<p className='panel-label'>{marketCopy.selectedForkQuestionSummary}</p>
									{selectedForkQuestion === undefined ? (
										<DataGrid columns='auto'>
											<div>
												<p className='detail'>{marketCopy.title}</p>
												<strong>{forkQuestionMetadataFallback}</strong>
											</div>
											<div>
												<p className='detail'>{marketCopy.outcomes}</p>
												<strong>{forkQuestionMetadataFallback}</strong>
											</div>
											<div>
												<p className='detail'>{marketCopy.questionType}</p>
												<strong>{forkQuestionMetadataFallback}</strong>
											</div>
											<div>
												<p className='detail'>{commonCopy.universe}</p>
												<strong>
													<TransactionUniverseValue universeId={zoltarUniverse?.universeId} />
												</strong>
											</div>
											<div>
												<p className='detail'>{commonCopy.questionId}</p>
												<IdentifierValue value={selectedForkQuestionId} />
											</div>
										</DataGrid>
									) : (
										<>
											<Question question={selectedForkQuestion} variant='preview' />
											<DataGrid columns='auto'>
												<div>
													<p className='detail'>{marketCopy.questionType}</p>
													<strong>{getMarketTypeLabel(selectedForkQuestion.marketType)}</strong>
												</div>
												<div>
													<p className='detail'>{commonCopy.universe}</p>
													<strong>
														<TransactionUniverseValue universeId={zoltarUniverse?.universeId} />
													</strong>
												</div>
											</DataGrid>
										</>
									)}
								</section>
							)}
						</SectionBlock>
						<OperationModal context={forkContext} isOpen={forkModalOpen} onClose={() => setForkModalOpen(false)} title={forkModalTitle}>
							<ForkZoltarSection
								accountAddress={accountState.address}
								hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
								isOnActiveAppChain={isOnActiveAppChain}
								loadingZoltarForkAccess={loadingZoltarForkAccess}
								loadingZoltarQuestion={isSelectedForkQuestionLookup && loadingZoltarQuestion}
								loadingZoltarQuestions={loadingZoltarQuestions || loadingZoltarQuestionCount}
								onApproveZoltarForkRep={onApproveZoltarForkRep}
								onForkZoltar={onForkZoltar}
								onRetryZoltarQuestion={() => {
									if (normalizedSelectedForkQuestionId === undefined) return
									requestedForkQuestionId.current = normalizedSelectedForkQuestionId
									void onLoadZoltarQuestion(normalizedSelectedForkQuestionId)
								}}
								onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
								zoltarForkActiveAction={zoltarForkActiveAction}
								zoltarForkApproval={zoltarForkApproval}
								zoltarForkError={zoltarForkError}
								zoltarForkPending={zoltarForkPending}
								zoltarForkQuestionId={selectedForkQuestionId ?? ''}
								zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
								zoltarQuestionLookupError={isSelectedForkQuestionLookup ? zoltarQuestionLookupError : undefined}
								zoltarQuestionLookupId={zoltarQuestionLookupId}
								zoltarQuestions={zoltarQuestions}
								zoltarUniverse={zoltarUniverse}
								zoltarUniverseState={zoltarUniverseState}
							/>
						</OperationModal>
					</>
				) : undefined}

				{view === 'migrate' ? (
					<ZoltarMigrationSection
						accountAddress={accountState.address}
						isOnActiveAppChain={isOnActiveAppChain}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onMigrateInternalRep={onMigrateInternalRep}
						onPrepareRepForMigration={onPrepareRepForMigration}
						onZoltarMigrationFormChange={onZoltarMigrationFormChange}
						zoltarForkRepBalanceAttoRep={zoltarForkRepBalanceAttoRep}
						zoltarForkApproval={zoltarForkApproval}
						zoltarForkActiveAction={zoltarForkActiveAction}
						zoltarMigrationChildRepBalancesAttoRep={zoltarMigrationChildRepBalancesAttoRep}
						zoltarMigrationActiveAction={zoltarMigrationActiveAction}
						zoltarMigrationError={zoltarMigrationError}
						zoltarMigrationForm={zoltarMigrationForm}
						zoltarMigrationPending={zoltarMigrationPending}
						zoltarMigrationPreparedRepBalanceAttoRep={zoltarMigrationPreparedRepBalanceAttoRep}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
						onApproveZoltarForkRep={onApproveZoltarForkRep}
					/>
				) : undefined}
			</div>
		</div>
	)
}
