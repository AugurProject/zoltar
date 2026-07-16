import * as commonCopy from '../../../copy/common.js'
import * as marketCopy from '../../../copy/market.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { useEffect, useState } from 'preact/hooks'
import { DataGrid } from '../../../components/DataGrid.js'
import { ForkZoltarSection } from '../../universes/components/ForkZoltarSection.js'
import { MarketCreateQuestionSection } from './MarketCreateQuestionSection.js'
import { MarketOverviewSection } from './MarketOverviewSection.js'
import { MarketQuestionsSection } from './MarketQuestionsSection.js'
import { OperationModal } from '../../../components/OperationModal.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { ZoltarMigrationSection } from '../../universes/components/ZoltarMigrationSection.js'
import { isMainnetChain } from '../../../lib/network.js'
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
	zoltarForkRepBalance,
	zoltarMigrationChildRepBalances,
	zoltarMigrationActiveAction,
	zoltarMigrationError,
	zoltarMigrationForm,
	zoltarMigrationPending,
	zoltarMigrationPreparedRepBalance,
	zoltarMigrationResult,
	zoltarQuestionCount,
	zoltarQuestionPage,
	zoltarQuestions,
	zoltarUniverse,
	zoltarUniverseState,
	securityPoolsLoadError,
}: MarketSectionProps) {
	const hasForked = zoltarUniverse?.hasForked === true
	const isMainnet = isMainnetChain(accountState.chainId)
	const view = activeView
	const showUniverseSummary = view === 'questions' && zoltarUniverse !== undefined
	const [forkModalOpen, setForkModalOpen] = useState(false)

	useEffect(() => {
		if (view !== 'migrate') return
		if (zoltarUniverse === undefined) return
		if (hasForked) return
		onActiveViewChange('questions')
	}, [hasForked, onActiveViewChange, view, zoltarUniverse])

	return (
		<div className='route-view-flow'>
			<SectionBlock density='compact' title={commonCopy.markets}>
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
							<p className='detail'>{commonCopy.universe}</p>
							<strong>{zoltarUniverse?.universeId.toString() ?? commonCopy.loadingWithEllipsis}</strong>
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
							securityPools={securityPools}
							securityPoolsLoadError={securityPoolsLoadError}
						/>
					</>
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
					<>
						<SectionBlock title={marketCopy.fork}>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => setForkModalOpen(true)}>
									{zoltarCopy.forkZoltar}
								</button>
							</div>
							{zoltarForkQuestionId.trim() === '' ? undefined : <p className='detail'>{marketCopy.formatSelectedForkQuestionDetail(zoltarForkQuestionId)}</p>}
						</SectionBlock>
						<OperationModal isOpen={forkModalOpen} onClose={() => setForkModalOpen(false)} title={zoltarCopy.forkZoltar}>
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
						</OperationModal>
					</>
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
