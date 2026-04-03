import { useEffect, useState } from 'preact/hooks'
import { ForkZoltarSection } from './ForkZoltarSection.js'
import { MarketCreateQuestionSection } from './MarketCreateQuestionSection.js'
import { MarketOverviewSection } from './MarketOverviewSection.js'
import { MarketQuestionsSection } from './MarketQuestionsSection.js'
import { ZoltarMigrationSection } from './ZoltarMigrationSection.js'
import { isMainnetChain } from '../lib/network.js'
import { readZoltarViewQueryParam, writeZoltarViewQueryParam } from '../lib/urlParams.js'
import type { MarketSectionProps } from '../types/components.js'

type ZoltarView = 'questions' | 'create' | 'fork' | 'migrate'

function getZoltarView(value: string | undefined): ZoltarView {
	switch (value) {
		case 'questions':
		case 'create':
		case 'fork':
		case 'migrate':
			return value
		default:
			return 'questions'
	}
}

export function MarketSection({
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
	zoltarForkAllowance,
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
	zoltarUniverseMissing,
}: MarketSectionProps) {
	const [view, setView] = useState<ZoltarView>(() => getZoltarView(readZoltarViewQueryParam(window.location.search)))
	const hasForked = zoltarUniverse?.hasForked === true
	const isMainnet = isMainnetChain(accountState.chainId)

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
					isMainnet={isMainnet}
					loadingZoltarUniverse={loadingZoltarUniverse}
					onCreateChildUniverseForOutcomeIndex={onCreateChildUniverseForOutcomeIndex}
					zoltarChildUniverseError={zoltarChildUniverseError}
					zoltarUniverse={zoltarUniverse}
					zoltarUniverseMissing={zoltarUniverseMissing}
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
						isMainnet={isMainnet}
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
						zoltarQuestions={zoltarQuestions}
					/>
				) : undefined}

				{view === 'fork' ? (
					<ForkZoltarSection
						accountAddress={accountState.address}
						isMainnet={isMainnet}
						loadingZoltarForkAccess={loadingZoltarForkAccess}
						loadingZoltarQuestionCount={loadingZoltarQuestionCount}
						loadingZoltarQuestions={loadingZoltarQuestions}
						loadingZoltarUniverse={loadingZoltarUniverse}
						onApproveZoltarForkRep={onApproveZoltarForkRep}
						onForkZoltar={onForkZoltar}
						onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
						zoltarForkActiveAction={zoltarForkActiveAction}
						zoltarForkAllowance={zoltarForkAllowance}
						zoltarForkError={zoltarForkError}
						zoltarForkPending={zoltarForkPending}
						zoltarForkQuestionId={zoltarForkQuestionId}
						zoltarForkRepBalance={zoltarForkRepBalance}
						zoltarQuestions={zoltarQuestions}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseMissing={zoltarUniverseMissing}
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
						zoltarMigrationChildRepBalances={zoltarMigrationChildRepBalances}
						zoltarMigrationActiveAction={zoltarMigrationActiveAction}
						zoltarMigrationError={zoltarMigrationError}
						zoltarMigrationForm={zoltarMigrationForm}
						zoltarMigrationPending={zoltarMigrationPending}
						zoltarMigrationPreparedRepBalance={zoltarMigrationPreparedRepBalance}
						zoltarMigrationResult={zoltarMigrationResult}
						zoltarUniverse={zoltarUniverse}
						zoltarUniverseMissing={zoltarUniverseMissing}
					/>
				) : undefined}
			</div>
		</section>
	)
}
