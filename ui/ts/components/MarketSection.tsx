import { useEffect, useState } from 'preact/hooks'
import { ForkZoltarSection } from './ForkZoltarSection.js'
import { MarketCreateQuestionSection } from './MarketCreateQuestionSection.js'
import { MarketOverviewSection } from './MarketOverviewSection.js'
import { MarketQuestionsSection } from './MarketQuestionsSection.js'
import { ZoltarMigrationSection } from './ZoltarMigrationSection.js'
import { resolveEnumValue } from '../lib/viewState.js'
import { readZoltarViewQueryParam, writeZoltarViewQueryParam } from '../lib/urlParams.js'
import type { MarketSectionProps } from '../types/components.js'

type ZoltarView = 'questions' | 'create' | 'fork' | 'migrate'

export function MarketSection({
	activeNetworkLabel = 'Ethereum mainnet',
	accountState,
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
	walletMatchesActiveNetwork = true,
}: MarketSectionProps) {
	const [view, setView] = useState<ZoltarView>(() => resolveEnumValue<ZoltarView>(readZoltarViewQueryParam(window.location.search), 'questions', ['questions', 'create', 'fork', 'migrate']))
	const hasForked = zoltarUniverse?.hasForked === true

	useEffect(() => {
		const nextSearch = writeZoltarViewQueryParam(window.location.search, view)
		window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}${window.location.hash}`)
	}, [view])

	useEffect(() => {
		if (view !== 'migrate') return
		if (zoltarUniverse === undefined) return
		if (hasForked) return
		setView('questions')
	}, [hasForked, view, zoltarUniverse])

	return (
		<section className='panel market-panel'>
			<div className='workflow-stack'>
				<MarketOverviewSection
					accountAddress={accountState.address}
					loadingZoltarUniverse={loadingZoltarUniverse}
					onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
					walletMatchesActiveNetwork={walletMatchesActiveNetwork}
					zoltarChildUniverseError={zoltarChildUniverseError}
					zoltarUniverse={zoltarUniverse}
					zoltarUniverseState={zoltarUniverseState}
				/>
			</div>

			<div className='subtab-nav market-subtab-nav' role='tablist' aria-label='Zoltar views'>
				<button className={`subtab-link ${view === 'questions' ? 'active' : ''}`} type='button' onClick={() => setView('questions')} aria-pressed={view === 'questions'}>
					Questions
				</button>
				<button className={`subtab-link ${view === 'create' ? 'active' : ''}`} type='button' onClick={() => setView('create')} aria-pressed={view === 'create'}>
					Create Question
				</button>
				<button className={`subtab-link ${view === 'fork' ? 'active' : ''}`} type='button' onClick={() => setView('fork')} aria-pressed={view === 'fork'}>
					Fork Zoltar
				</button>
				<button className={`subtab-link ${view === 'migrate' ? 'active' : ''}`} type='button' onClick={() => setView('migrate')} aria-pressed={view === 'migrate'} disabled={!hasForked} title={!hasForked ? 'Fork Zoltar before migrating REP' : undefined}>
					Migrate REP
				</button>
			</div>

			<div className='workflow-stack'>
				{view === 'questions' ? (
					<MarketQuestionsSection
						hasForked={hasForked}
						hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
						loadingZoltarQuestionCount={loadingZoltarQuestionCount}
						loadingZoltarQuestions={loadingZoltarQuestions}
						onLoadZoltarQuestions={onLoadZoltarQuestions}
						onOpenForkTab={() => setView('fork')}
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
						loadingZoltarQuestions={loadingZoltarQuestions}
						marketCreating={marketCreating}
						marketError={marketError}
						marketForm={marketForm}
						marketResult={marketResult}
						onCreateMarket={onCreateMarket}
						onMarketFormChange={onMarketFormChange}
						onOpenForkTab={() => setView('fork')}
						onResetMarket={onResetMarket}
						onUseQuestionForFork={onUseQuestionForFork}
						onUseQuestionForPool={onUseQuestionForPool}
						walletMatchesActiveNetwork={walletMatchesActiveNetwork}
						zoltarQuestions={zoltarQuestions}
					/>
				) : undefined}

				{view === 'fork' ? (
					<ForkZoltarSection
						activeNetworkLabel={activeNetworkLabel}
						accountAddress={accountState.address}
						hasLoadedZoltarQuestions={hasLoadedZoltarQuestions}
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
						walletMatchesActiveNetwork={walletMatchesActiveNetwork}
					/>
				) : undefined}

				{view === 'migrate' ? (
					<ZoltarMigrationSection
						activeNetworkLabel={activeNetworkLabel}
						accountAddress={accountState.address}
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
						walletMatchesActiveNetwork={walletMatchesActiveNetwork}
					/>
				) : undefined}
			</div>
		</section>
	)
}
