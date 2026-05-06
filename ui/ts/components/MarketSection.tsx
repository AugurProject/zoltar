import { useEffect, useRef } from 'preact/hooks'
import { DataGrid } from './DataGrid.js'
import { ForkZoltarSection } from './ForkZoltarSection.js'
import { MarketCreateQuestionSection } from './MarketCreateQuestionSection.js'
import { MarketOverviewSection } from './MarketOverviewSection.js'
import { MarketQuestionsSection } from './MarketQuestionsSection.js'
import { SectionModeTabs } from './SectionModeTabs.js'
import { TabbedSectionBlock } from './TabbedSectionBlock.js'
import { ZoltarMigrationSection } from './ZoltarMigrationSection.js'
import { isMainnetChain } from '../lib/network.js'
import type { MarketSectionProps } from '../types/components.js'

export function MarketSection({
	accountState,
	activeView,
	hasLoadedZoltarQuestions,
	loadingZoltarForkAccess,
	zoltarForkActiveAction,
	loadingZoltarQuestionCount,
	loadingZoltarQuestions,
	loadingZoltarUniverse,
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
	zoltarForkRepBalance,
	zoltarMigrationChildRepBalances,
	zoltarMigrationActiveAction,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalance,
	zoltarMigrationResult,
	zoltarQuestionCount,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
}: MarketSectionProps) {
	const hasForked = zoltarUniverse?.hasForked === true
	const isMainnet = isMainnetChain(accountState.chainId)
	const view = activeView
	const showUniverseSummary = view === 'questions' && zoltarUniverse !== undefined
	const lastAutoLoadedQuestionsUniverseId = useRef<bigint | undefined>(undefined)

	useEffect(() => {
		if (view !== 'migrate') return
		if (zoltarUniverse === undefined) return
		if (hasForked) return
		onActiveViewChange('questions')
	}, [hasForked, onActiveViewChange, view, zoltarUniverse])

	useEffect(() => {
		if (view !== 'questions') return
		if (loadingZoltarQuestions) return
		if (hasLoadedZoltarQuestions) return
		if (zoltarQuestionCount === 0n) return
		const currentUniverseId = zoltarUniverse?.universeId
		if (currentUniverseId !== undefined && lastAutoLoadedQuestionsUniverseId.current === currentUniverseId) return
		lastAutoLoadedQuestionsUniverseId.current = currentUniverseId
		onLoadZoltarQuestions()
	}, [hasLoadedZoltarQuestions, loadingZoltarQuestions, onLoadZoltarQuestions, view, zoltarQuestionCount, zoltarUniverse?.universeId])

	const renderModeTabs = () => (
		<SectionModeTabs
			ariaLabel='Zoltar views'
			value={view}
			onChange={onActiveViewChange}
			options={[
				{ label: 'Questions', value: 'questions' },
				{ label: 'Create Question', value: 'create' },
				{ label: 'Fork Zoltar', value: 'fork' },
				{ label: 'Migrate REP', value: 'migrate', disabled: !hasForked, ...(!hasForked ? { reason: 'Fork Zoltar before migrating REP.' } : {}) },
			]}
		/>
	)

	return (
		<div className='route-view-flow'>
			<TabbedSectionBlock density='compact' tabs={renderModeTabs()} title='Zoltar'>
				{showUniverseSummary ? (
					<MarketOverviewSection
						accountAddress={accountState.address}
						isMainnet={isMainnet}
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
							<p className='detail'>Universe</p>
							<strong>{zoltarUniverse?.universeId.toString() ?? 'Loading...'}</strong>
						</div>
						<div>
							<p className='detail'>Status</p>
							<strong>{hasForked ? 'Forked' : 'Unforked'}</strong>
						</div>
						<div>
							<p className='detail'>Questions</p>
							<strong>{zoltarQuestionCount?.toString() ?? '—'}</strong>
						</div>
					</DataGrid>
				)}
			</TabbedSectionBlock>
			<div className='workflow-stack route-workflow-stack'>
				{view === 'questions' ? (
					<MarketQuestionsSection
						hasForked={hasForked}
						hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
						loadingZoltarQuestionCount={loadingZoltarQuestionCount}
						loadingZoltarQuestions={loadingZoltarQuestions}
						onLoadZoltarQuestions={onLoadZoltarQuestions}
						onOpenForkTab={() => onActiveViewChange('fork')}
						onUseQuestionForFork={onUseQuestionForFork}
						onUseQuestionForPool={onUseQuestionForPool}
						zoltarQuestionCount={zoltarQuestionCount}
						zoltarQuestions={zoltarQuestions}
					/>
				) : undefined}

				{view === 'create' ? (
					<MarketCreateQuestionSection
						accountAddress={accountState.address}
						hasForked={hasForked}
						isMainnet={isMainnet}
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
					<ForkZoltarSection
						accountAddress={accountState.address}
						hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
						isMainnet={isMainnet}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						loadingZoltarQuestions={loadingZoltarQuestions || loadingZoltarQuestionCount}
						onApproveZoltarForkRep={onApproveZoltarForkRep}
						onForkZoltar={onForkZoltar}
						onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
						zoltarForkActiveAction={zoltarForkActiveAction}
						zoltarForkApproval={zoltarForkApproval}
						zoltarForkError={zoltarForkError}
						zoltarForkPending={zoltarForkPending}
						zoltarForkQuestionId={zoltarForkQuestionId}
						zoltarForkRepBalance={zoltarForkRepBalance}
						zoltarQuestions={zoltarQuestions}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
					/>
				) : undefined}

				{view === 'migrate' ? (
					<ZoltarMigrationSection
						accountAddress={accountState.address}
						isMainnet={isMainnet}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onMigrateInternalRep={onMigrateInternalRep}
						onPrepareRepForMigration={onPrepareRepForMigration}
						onZoltarMigrationFormChange={onZoltarMigrationFormChange}
						zoltarForkRepBalance={zoltarForkRepBalance}
						zoltarForkApproval={zoltarForkApproval}
						zoltarForkActiveAction={zoltarForkActiveAction}
						zoltarMigrationChildRepBalances={zoltarMigrationChildRepBalances}
						zoltarMigrationActiveAction={zoltarMigrationActiveAction}
						zoltarMigrationError={zoltarMigrationError}
						zoltarMigrationForm={zoltarMigrationForm}
						zoltarMigrationPending={zoltarMigrationPending}
						zoltarMigrationPreparedRepBalance={zoltarMigrationPreparedRepBalance}
						zoltarMigrationResult={zoltarMigrationResult}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseState={zoltarUniverseState}
						onApproveZoltarForkRep={onApproveZoltarForkRep}
					/>
				) : undefined}
			</div>
		</div>
	)
}
