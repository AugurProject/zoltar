import { useEffect, useRef, useState } from 'preact/hooks'
import { DataGrid } from './DataGrid.js'
import { ForkZoltarSection } from './ForkZoltarSection.js'
import { MarketCreateQuestionSection } from './MarketCreateQuestionSection.js'
import { MarketOverviewSection } from './MarketOverviewSection.js'
import { MarketQuestionsSection } from './MarketQuestionsSection.js'
import { OperationModal } from './OperationModal.js'
import { SectionBlock } from './SectionBlock.js'
import { ZoltarMigrationSection } from './ZoltarMigrationSection.js'
import { isMainnetChain } from '../lib/network.js'
import type { MarketSectionProps } from '../types/components.js'

export function MarketSection({
	accountState,
	activeUniverseId,
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
	const [forkModalOpen, setForkModalOpen] = useState(false)

	useEffect(() => {
		if (view !== 'migrate') return
		if (zoltarUniverse === undefined) return
		if (hasForked) return
		onActiveViewChange('questions')
	}, [hasForked, onActiveViewChange, view, zoltarUniverse])

	useEffect(() => {
		if (!hasForked) return
		setForkModalOpen(false)
	}, [hasForked])

	useEffect(() => {
		if (view !== 'questions') return
		if (loadingZoltarQuestionCount) return
		if (zoltarQuestionCount === undefined) return
		if (zoltarQuestionCount === 0n) return
		if (loadingZoltarQuestions) return
		if (hasLoadedZoltarQuestions) return
		if (lastAutoLoadedQuestionsUniverseId.current === activeUniverseId) return
		lastAutoLoadedQuestionsUniverseId.current = activeUniverseId
		void Promise.resolve(onLoadZoltarQuestions()).catch(() => {
			lastAutoLoadedQuestionsUniverseId.current = undefined
		})
	}, [activeUniverseId, hasLoadedZoltarQuestions, loadingZoltarQuestionCount, loadingZoltarQuestions, onLoadZoltarQuestions, view, zoltarQuestionCount])

	return (
		<div className='route-view-flow'>
			<SectionBlock density='compact' title='Zoltar'>
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
			</SectionBlock>
			<div className='workflow-stack route-workflow-stack'>
				{view === 'questions' ? (
					<>
						{hasForked ? (
							<SectionBlock title='Post-Fork Actions' description='The universe is forked. Migration is now the primary follow-up action.'>
								<div className='actions'>
									<button className='primary' type='button' onClick={() => onActiveViewChange('migrate')}>
										Open REP Migration
									</button>
								</div>
							</SectionBlock>
						) : undefined}
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
						<SectionBlock title='Fork'>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => setForkModalOpen(true)}>
									Open Fork Flow
								</button>
							</div>
							{zoltarForkQuestionId.trim() === '' ? undefined : <p className='detail'>Selected fork question: {zoltarForkQuestionId}</p>}
						</SectionBlock>
						<OperationModal isOpen={forkModalOpen} onClose={() => setForkModalOpen(false)} title='Fork Zoltar'>
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
