import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { Fragment } from 'preact'
import { useEffect } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { ImportedForkSettlementSection } from '../../reporting/components/ImportedForkSettlementSection.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js'
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js'
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js'
import { ForkAuctionMigrationStage } from './ForkAuctionMigrationStage.js'
import { ForkAuctionWorkflowShell, ForkTriggeredStage } from './ForkAuctionWorkflowShell.js'
import { ForkAuctionBidsStatusSection, ForkAuctionSettlementActionSection, ForkAuctionStartSection, ForkAuctionSubmitBidSection } from './ForkAuctionActionSections.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL } from '../lib/forkAuction.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS } from '../../reporting/lib/reporting.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import { type DisplayMetric, ForkAuctionOutcomeStage, ForkAuctionMigrationSummaryCard, FORK_MIGRATION_DURATION, ForkWorkflowStageNavigator, renderAddress, renderMetricValue, renderTruthAuctionPriceValue, renderTruthAuctionSettlementSelectionSummary, sameBigIntRecord } from './ForkAuctionPresentation.js'
import { useForkAuctionSectionState } from '../hooks/useForkAuctionSectionState.js'

export function ForkAuctionSection(props: ForkAuctionSectionProps) {
	const model = useForkAuctionSectionState(props)

	const submitBidAction = model.renderStageActionButton({
		action: 'submitBid',
		availability: createActionAvailability(model.submitBidGuardMessage),
		forceEnabled: model.hasSelectedAuctionChildPool,
		idleLabel: forkAuctionCopy.submitBid,
		onClick: model.onSubmitBidForSelectedAuction,
		pending: model.isTruthAuctionDetailsLoading || model.forkAuctionActiveAction === 'submitBid',
		pendingLabel: model.isTruthAuctionDetailsLoading ? forkAuctionCopy.loadingTruthAuction : forkAuctionCopy.submittingBidTruncated,
	})
	const submitBidSection = (
		<ForkAuctionSubmitBidSection
			auctionSecurityPoolAddress={model.auctionSecurityPoolAddress}
			enteredBidAmount={model.enteredBidAmount}
			enteredBidPrice={model.enteredBidPrice}
			estimatedAttoRep={model.estimatedAttoRep}
			onBidAmountChange={submitBidAmount => model.onForkAuctionFormChange({ submitBidAmount })}
			onBidPriceChange={submitBidPrice => model.onForkAuctionFormChange({ submitBidPrice })}
			questionTitle={model.selectedAuctionChildPool?.marketDetails.title ?? model.previewPool?.marketDetails.title}
			resultingBidBalanceAttoEth={model.resultingBidBalanceAttoEth}
			selectedAuctionLabel={model.selectedAuctionLabel}
			submitBidAction={submitBidAction}
			submitBidAmount={model.forkAuctionForm.submitBidAmount}
			submitBidPreviewPrice={model.submitBidPreviewTickSummary?.price}
			submitBidPrice={model.forkAuctionForm.submitBidPrice}
			submittedBidPrice={model.submittedBidPrice}
		/>
	)
	useEffect(() => {
		if (!model.isMigrationRequired || model.onReportingFormChange === undefined || model.reportingForm === undefined || model.activeReportingDetails === undefined) return
		const nextSelectedDepositIndexesByOutcome = {
			invalid: model.activeReportingDetails.sides.find(side => side.key === 'invalid')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
			yes: model.activeReportingDetails.sides.find(side => side.key === 'yes')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
			no: model.activeReportingDetails.sides.find(side => side.key === 'no')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
		}
		if (sameBigIntRecord(nextSelectedDepositIndexesByOutcome, model.reportingForm.selectedWithdrawDepositIndexesByOutcome)) return
		model.onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: nextSelectedDepositIndexesByOutcome,
		})
	}, [model.activeReportingDetails, model.isMigrationRequired, model.onReportingFormChange, model.reportingForm])
	useEffect(() => {
		const nextSelectedImportedDepositIndexesByOutcome = {
			invalid: model.importedForkSettlementSides.find(side => side.key === 'invalid')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
			yes: model.importedForkSettlementSides.find(side => side.key === 'yes')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
			no: model.importedForkSettlementSides.find(side => side.key === 'no')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
		}
		model.setSelectedImportedForkDepositIndexesByOutcome(currentSelections => {
			const prunedSelections = {
				invalid: currentSelections.invalid.filter(index => nextSelectedImportedDepositIndexesByOutcome.invalid.includes(index)),
				yes: currentSelections.yes.filter(index => nextSelectedImportedDepositIndexesByOutcome.yes.includes(index)),
				no: currentSelections.no.filter(index => nextSelectedImportedDepositIndexesByOutcome.no.includes(index)),
			}
			if (sameBigIntRecord(prunedSelections, currentSelections)) return currentSelections
			return prunedSelections
		})
	}, [model.importedForkSettlementSides])
	const migrationStartedAt = (() => {
		if (model.universeForkTime !== undefined && model.universeForkTime > 0n) return model.universeForkTime
		if (model.forkAuctionDetails?.migrationEndsAt !== undefined) return model.forkAuctionDetails.migrationEndsAt - FORK_MIGRATION_DURATION
		return undefined
	})()
	const migrationRepAtForkDisplay = model.forkAuctionDetails === undefined ? model.forkOnlyFallbackText : <CurrencyValue value={model.forkAuctionDetails.auctionableAttoRepAtFork} suffix={commonCopy.rep} />
	const migrationRepDisplay = renderMetricValue(model.forkAuctionDetails?.migratedAttoRep ?? model.previewPool?.migratedAttoRep, commonCopy.rep, commonCopy.metricUnavailablePlaceholder)
	const migrationSettlementCollateralDisplay = renderMetricValue(model.forkAuctionDetails?.settlementCollateralAttoEth ?? model.previewPool?.settlementCollateralAttoEth, commonCopy.eth, commonCopy.metricUnavailablePlaceholder)
	const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? forkAuctionCopy.notStarted : <TimestampValue {...(model.effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: model.effectiveCurrentTimestamp })} timestamp={migrationStartedAt} />
	const migrationEndsDisplay = (() => {
		if (model.forkAuctionDetails === undefined) return model.migrationSummaryText
		if (model.hasStartedSelectedTruthAuctionTimeline && model.effectiveTruthAuctionStartedAt !== undefined && model.effectiveTruthAuctionStartedAt > 0n) {
			return <TimestampValue {...(model.effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: model.effectiveCurrentTimestamp })} timestamp={model.effectiveTruthAuctionStartedAt} />
		}
		if (model.forkAuctionDetails.migrationEndsAt === undefined) return forkAuctionCopy.notStarted

		return <TimestampValue {...(model.effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: model.effectiveCurrentTimestamp })} timestamp={model.forkAuctionDetails.migrationEndsAt} />
	})()
	const truthAuctionStateBadgeElement = <Badge tone={model.truthAuctionStateBadge.tone}>{model.truthAuctionStateBadge.label}</Badge>
	const pendingRefundDisplay = (() => {
		if (model.loadingPendingEthRefund) return <LoadingText>{forkAuctionCopy.loadingPendingRefund}</LoadingText>
		if (model.pendingEthRefundAttoEth === undefined) return commonCopy.metricUnavailablePlaceholder
		return <CurrencyValue value={model.pendingEthRefundAttoEth} suffix={commonCopy.eth} />
	})()
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: forkAuctionCopy.truthAuctionAddress, value: renderAddress(model.auctionTruthAuctionAddress) },
		{ label: forkAuctionCopy.started, value: model.startedDisplay },
		{ label: commonCopy.ends, value: model.endsDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: model.ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchasedAttoRep, value: model.truthAuctionStatus === undefined ? model.truthAuctionFallback : <CurrencyValue value={model.displayedRepSoldAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.clearingPrice, value: model.clearingPriceDisplay },
		{ label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: model.selectedAuctionContext === undefined ? model.truthAuctionFallback : <CurrencyValue value={model.selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.pendingRefund, value: pendingRefundDisplay },
		{ label: forkAuctionCopy.minBidSizeAttoEth, value: model.truthAuctionStatus === undefined ? model.truthAuctionFallback : <CurrencyValue value={model.truthAuctionStatus.minBidSizeAttoEth} suffix={commonCopy.eth} /> },
		{ label: forkAuctionCopy.maxAttoRepBeingSold, value: model.truthAuctionStatus === undefined ? model.truthAuctionFallback : <CurrencyValue value={model.truthAuctionStatus.maxAttoRepBeingSold} suffix={commonCopy.rep} /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: model.selectedAuctionContext === undefined ? model.truthAuctionFallback : <CurrencyValue value={model.selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.settlementAvailable, value: model.settlementAvailableDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: model.ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchasedAttoRep, value: model.truthAuctionStatus === undefined ? model.truthAuctionFallback : <CurrencyValue value={model.displayedRepSoldAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.pendingRefund, value: pendingRefundDisplay },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid fork-workflow-outcome-selector'>
			<label className='field'>
				<span>{commonCopy.outcome}</span>
				<div className='fork-workflow-outcome-selector-row'>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={model.forkAuctionForm.selectedOutcome} onChange={selectedOutcome => model.onForkAuctionFormChange({ selectedOutcome })} />
					{model.renderSelectedOutcomeChildPoolLink()}
				</div>
			</label>
		</div>
	)
	const truthAuctionHero = (() => {
		if (!model.shouldShowTruthAuctionVisualization || model.truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedCapacityOwnershipAttoRepDisplay={model.selectedAuctionContext === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={model.selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} />}
				badge={truthAuctionStateBadgeElement}
				clearingPriceDisplay={renderTruthAuctionPriceValue(model.truthAuctionStatus.clearingPrice)}
				displayedEthRaisedAttoEth={model.displayedEthRaisedAttoEth}
				displayedRepSoldAttoRep={model.displayedRepSoldAttoRep}
				endsDisplay={model.endsDisplay}
				attoEthRaiseCap={model.truthAuctionStatus.attoEthRaiseCap}
				ethRaisedProgress={model.ethRaisedProgress}
				maxAttoRepBeingSold={model.truthAuctionStatus.maxAttoRepBeingSold}
				minBidSizeAttoEth={model.truthAuctionStatus.minBidSizeAttoEth}
				pendingRefundDisplay={pendingRefundDisplay}
				repSoldProgress={model.repSoldProgress}
				startedDisplay={model.startedDisplay}
				winningThresholdPriceDisplay={model.winningThresholdPrice === undefined ? undefined : renderTruthAuctionPriceValue(model.winningThresholdPrice)}
			/>
		)
	})()
	const migrationSummaryCard = (
		<ForkAuctionMigrationSummaryCard
			badge={model.migrationStatusBadge}
			forkAuctionDetails={model.forkAuctionDetails}
			forkTypeDisplay={model.resolvedForkTypeLabel}
			migratedRepDisplay={migrationRepDisplay}
			migrationEndsDisplay={migrationEndsDisplay}
			migrationStartedDisplay={migrationStartedDisplay}
			repAtForkDisplay={migrationRepAtForkDisplay}
			settlementCollateralDisplay={migrationSettlementCollateralDisplay}
		/>
	)
	const truthAuctionMarketViewSection = (() => {
		if (!model.shouldShowTruthAuctionVisualization || model.truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionMarketViewSection
				clearingTick={model.truthAuctionStatus.clearingTick}
				hasMoreTickSummaries={model.hasMoreTickSummaries}
				loadingTruthAuctionBook={model.loadingTruthAuctionBook}
				maxTickAttoEth={model.maxTickAttoEth}
				onLoadNextTickPage={model.loadNextTickPage}
				onSelectTick={model.selectTruthAuctionTick}
				renderPriceValue={renderTruthAuctionPriceValue}
				showDepthClearingTick={model.truthAuctionStatus.hitCap && model.truthAuctionStatus.clearingTick !== undefined}
				truthAuctionBookError={model.truthAuctionBookError}
				truthAuctionDepthPoints={model.truthAuctionDepthPoints}
			/>
		)
	})()
	const auctionWideBidsSection = (() => {
		if (!model.shouldShowTruthAuctionVisualization || model.truthAuctionStatus === undefined) return undefined

		return (
			<TruthAuctionBidsSection
				aggregatedAuctionBidCountForLoadedTicks={model.aggregatedAuctionBidCountForLoadedTicks}
				error={model.truthAuctionBookError}
				hasLoadedData={model.hasLoadedTruthAuctionBook && model.hasLoadedAggregatedAuctionBids}
				hasMoreAggregatedAuctionBids={model.hasMoreAggregatedAuctionBids}
				loadedTickCount={model.truthAuctionBookData.tickSummaries.length}
				loadingAggregatedAuctionBids={model.loadingTruthAuctionBook || model.loadingAggregatedAuctionBids}
				onLoadNextAuctionBidPage={model.loadNextAuctionBidPage}
				onRetry={model.retryPublicTruthAuctionBook}
				renderPriceValue={renderTruthAuctionPriceValue}
				retrying={model.retryingPublicTruthAuctionBook}
				rows={model.auctionBidRows}
			/>
		)
	})()
	const auctionWideBidsStatusSection = <ForkAuctionBidsStatusSection error={model.selectedAuctionContextError} loading={model.isTruthAuctionDetailsLoading} onRetry={model.retrySelectedAuctionDetails} retrying={model.retryingSelectedAuctionDetails} />
	const viewerTruthAuctionBidsSection = (() => {
		if (!model.shouldShowTruthAuctionVisualization || model.truthAuctionStatus === undefined) return undefined

		return (
			<ViewerTruthAuctionBidsSection
				accountAddress={model.accountState.address}
				error={model.viewerTruthAuctionBidsError}
				hasLoadedData={model.hasLoadedViewerTruthAuctionBids}
				hasMoreViewerBids={model.hasMoreViewerBids}
				loadingTruthAuctionBook={model.loadingViewerTruthAuctionBids}
				onLoadNextViewerBidPage={model.loadNextViewerBidPage}
				onRetry={model.retryViewerTruthAuctionBids}
				onSettlementBidSelectionChange={model.onSettlementBidSelectionChange}
				renderPriceValue={renderTruthAuctionPriceValue}
				retrying={model.retryingViewerTruthAuctionBids}
				rows={model.viewerBidRows}
				showSettlementActionColumn={model.showViewerSettlementActionColumn}
			/>
		)
	})()
	const settlementSelectionSummary = renderTruthAuctionSettlementSelectionSummary({
		estimatedAssignedCapacityOwnershipAttoRep: model.settlementSelectionEstimate.estimatedAssignedCapacityOwnershipAttoRep,
		estimatedRefundedAttoEth: model.settlementSelectionEstimate.estimatedRefundedAttoEth,
		estimatedVaultRepBackingAttoRep: model.settlementSelectionEstimate.estimatedVaultRepBackingAttoRep,
		selectedClaimCount: model.selectedClaimSettlementBidRows.length,
		selectedRefundCount: model.selectedRefundSettlementBidRows.length,
		selectedRowCount: model.selectedSettlementBidRows.length,
	})
	const settlementActionButton = model.renderStageActionButton({
		action: model.settlementAction,
		availability: createActionAvailability(model.settlementActionAvailabilityMessage),
		forceEnabled: model.hasSelectedAuctionChildPool,
		idleLabel: model.settlementActionLabel,
		onClick: model.onSettleSelectedBidsForSelectedAuction,
		pendingLabel: model.settlementActionPendingLabel,
		pending: model.isSettleSelectedBidsInProgress,
		tone: 'primary',
	})
	const pendingRefundWithdrawalAvailability = (() => {
		if (model.loadingPendingEthRefund) return forkAuctionCopy.loadingPendingRefund
		if (model.pendingEthRefundError !== undefined) return model.pendingEthRefundError
		if (model.pendingEthRefundAttoEth === undefined || model.pendingEthRefundAttoEth === 0n) return forkAuctionCopy.noPendingRefund
		return undefined
	})()
	const withdrawRefundAction =
		model.onWithdrawAuctionRefund === undefined
			? undefined
			: model.renderStageActionButton({
					action: 'withdrawAuctionRefund',
					availability: createActionAvailability(pendingRefundWithdrawalAvailability),
					forceEnabled: model.hasSelectedAuctionChildPool,
					idleLabel: forkAuctionCopy.withdrawRefund,
					onClick: () => model.onWithdrawAuctionRefund?.(model.auctionSecurityPoolAddress, model.selectedAuctionUniverseId),
					pendingLabel: forkAuctionCopy.withdrawingRefundTruncated,
				})
	const withdrawRefundSection =
		withdrawRefundAction === undefined ? undefined : (
			<SectionBlock title={forkAuctionCopy.refundWithdrawal} variant='embedded'>
				<p className='detail'>
					<strong>{forkAuctionCopy.pendingRefund}: </strong>
					{pendingRefundDisplay}
				</p>
				<ErrorNotice message={model.pendingEthRefundError} />
				{model.pendingEthRefundError === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' disabled={model.loadingPendingEthRefund} onClick={() => model.setPendingEthRefundRetryNonce(currentNonce => currentNonce + 1)} type='button'>
							{forkAuctionCopy.retryPendingRefund}
						</button>
					</div>
				)}
				<div className='actions'>{withdrawRefundAction}</div>
			</SectionBlock>
		)
	const truthAuctionSettlementSection =
		!model.shouldShowTruthAuctionVisualization || model.truthAuctionStatus === undefined ? undefined : (
			<Fragment>
				<ForkAuctionSettlementActionSection actionButton={settlementActionButton} description={model.settlementActionDescription} selectionSummary={settlementSelectionSummary} showRefundOnlyNotice={model.showRefundOnlySettlementCapacityOwnershipNotice} title={model.settlementActionLabel} />
				{withdrawRefundSection}
			</Fragment>
		)
	const importedForkSettlementSection = (() => {
		if (!model.hasImportedForkSettlementDeposits) return undefined
		return (
			<ImportedForkSettlementSection
				activeReportingDetails={model.activeReportingDetails}
				disabled={model.forkAuctionActiveAction === 'settleForkedEscalation'}
				onDepositSelectionChange={(outcome, depositIndex, checked) => {
					model.setSelectedImportedForkDepositIndexesByOutcome(currentSelections => ({
						...currentSelections,
						[outcome]: checked ? [...currentSelections[outcome], depositIndex] : currentSelections[outcome].filter(index => index !== depositIndex),
					}))
				}}
				renderSettlementAction={({ guardMessage, outcome, sideLabel }) =>
					model.renderStageActionButton({
						action: 'settleForkedEscalation',
						availability: createActionAvailability(guardMessage),
						idleLabel: forkAuctionCopy.formatSettleSelectedValueForkCarriedDeposits(sideLabel),
						onClick: () => model.onWithdrawForkedEscalationSubmit(outcome),
						pendingLabel: forkAuctionCopy.settlingForkCarriedDepositsTruncated,
						tone: 'secondary',
					})
				}
				resolved={model.importedForkSettlementResolved}
				selectedDepositIndexesByOutcome={model.selectedImportedForkDepositIndexesByOutcome}
				sides={model.importedForkSettlementSides}
				winningOutcome={model.activeReportingDetails?.questionOutcome === 'none' ? undefined : model.activeReportingDetails?.questionOutcome}
			/>
		)
	})()
	const forkWorkflowStageNavigator = !model.hasLoadedPoolContext ? undefined : <ForkWorkflowStageNavigator currentStage={model.currentWorkflowStage} onStageChange={model.onSelectedStageViewChange} selectedStage={model.selectedStage} />
	const startTruthAuctionAction = model.renderStageActionButton({
		action: 'startTruthAuction',
		availability: createActionAvailability(!model.hasSelectedAuctionChildPool ? forkAuctionCopy.formatMissingChildUniverseDetail(model.selectedAuctionLabel) : model.startTruthAuctionAvailabilityMessage),
		forceEnabled: model.hasSelectedAuctionChildPool,
		idleLabel: model.truthAuctionBypassReason === undefined ? forkAuctionCopy.startTruthAuction : forkAuctionCopy.bypassTruthAuction,
		onClick: model.onStartTruthAuctionSubmit,
		pendingLabel: model.truthAuctionBypassReason === undefined ? forkAuctionCopy.startingTruthAuction : forkAuctionCopy.bypassingAuctionTruncated,
		tone: 'primary',
	})
	const startTruthAuctionSection = <ForkAuctionStartSection actionButton={startTruthAuctionAction} bypassReason={model.truthAuctionBypassReason} readyInText={model.startTruthAuctionReadyInText} />
	const stagePanel = (() => {
		if (model.selectedStage === 'fork-triggered') return <ForkTriggeredStage currentTimestamp={model.effectiveCurrentTimestamp} disabled={model.disabled} hasTriggeredFork={model.hasTriggeredFork} universeForkTime={model.universeForkTime} />
		if (model.selectedStage === 'migration')
			return (
				<ForkAuctionMigrationStage
					accountConnected={model.accountState.address !== undefined}
					activeReportingDetails={model.activeReportingDetails}
					claimParentDepositsGuardMessage={model.claimSelectedParentEscalationDepositsGuardMessage}
					claimSelectionDisabled={model.forkAuctionActiveAction === 'claimParentEscalationDeposits'}
					connectedWalletVaultSummary={model.connectedWalletVaultSummary}
					disabled={model.disabled}
					hasSelectedParentEscalationClaimDeposits={model.hasSelectedParentEscalationClaimDeposits}
					hasStoredEscalationMigrationEntitlement={model.hasStoredEscalationMigrationEntitlement}
					hasUnresolvedMigrationDeposits={model.hasUnresolvedMigrationDeposits}
					hasUnresolvedMigrationState={model.hasUnresolvedMigrationState}
					hasWalletParentEscalationClaimBalance={model.hasWalletParentEscalationClaimBalance}
					hasWalletVaultMigrationBalance={model.hasWalletVaultMigrationBalance}
					isMigrationExpired={model.isMigrationExpired}
					isVaultMigrationComplete={model.isVaultMigrationComplete}
					loadingReportingDetails={model.loadingReportingDetails}
					loadingSelectedOutcomeMigrationSeedStatus={model.loadingSelectedOutcomeMigrationSeedStatus}
					migratePoolGuardMessage={model.migratePoolToUniverseGuardMessage}
					migrateUnresolvedGuardMessage={model.migrateUnresolvedEscalationGuardMessage}
					migrateVaultGuardMessage={model.migrateVaultGuardMessage}
					migrationBalancesContent={model.migrationBalancesContent}
					migrationSummaryCard={migrationSummaryCard}
					onClaimParentDeposits={model.onClaimSelectedParentEscalationDeposits}
					onMigratePool={model.onMigrateSelectedOutcomeRepToZoltar}
					onMigrateUnresolved={model.onMigrateUnresolvedEscalationSubmit}
					onMigrateVault={model.onMigrateVaultSubmit}
					onParentDepositSelectionChange={model.setSelectedParentEscalationClaimDepositIndexes}
					renderAction={model.renderStageActionButton}
					reportingDetails={model.reportingDetails}
					retrySelectedOutcomeMigrationSeedStatus={model.retrySelectedOutcomeMigrationSeedStatus}
					selectedOutcome={model.forkAuctionForm.selectedOutcome}
					selectedOutcomeLabel={model.selectedOutcomeLabel}
					selectedOutcomeMigrationSeedStatus={model.selectedOutcomeMigrationSeedStatus}
					selectedOutcomeMigrationSeedStatusError={model.selectedOutcomeMigrationSeedStatusError}
					selectedParentEscalationClaimDeposits={model.selectedParentEscalationClaimDeposits}
					selectedParentEscalationClaimDepositIndexes={model.selectedParentEscalationClaimDepositIndexes}
					selectedStageAheadMessage={model.selectedStageAheadMessage}
				/>
			)

		return (
			<ForkAuctionOutcomeStage
				auctionOutcomeSelector={auctionOutcomeSelector}
				auctionStatusMetrics={auctionStatusMetrics}
				auctionWideBidsSection={auctionWideBidsSection}
				auctionWideBidsStatusSection={auctionWideBidsStatusSection}
				childSecurityPools={model.childSecurityPools}
				disabled={model.disabled}
				hasStartedTruthAuction={model.hasStartedTruthAuction}
				importedForkSettlementSection={importedForkSettlementSection}
				renderSelectedOutcomeChildPoolNotice={model.renderSelectedOutcomeChildPoolNotice}
				selectedStage={model.selectedStage}
				selectedStageAheadMessage={model.selectedStageAheadMessage}
				settlementStatusMetrics={settlementStatusMetrics}
				shouldShowVisualization={model.shouldShowTruthAuctionVisualization}
				startTruthAuctionSection={startTruthAuctionSection}
				submitBidSection={submitBidSection}
				truthAuctionEndedNotice={model.truthAuctionEndedNotice}
				truthAuctionHero={truthAuctionHero}
				truthAuctionMarketViewSection={truthAuctionMarketViewSection}
				truthAuctionSettlementSection={truthAuctionSettlementSection}
				truthAuctionStateBadgeElement={truthAuctionStateBadgeElement}
				viewerTruthAuctionBidsSection={viewerTruthAuctionBidsSection}
			/>
		)
	})()
	return (
		<ForkAuctionWorkflowShell
			embedInCard={model.embedInCard}
			forkAuctionDetailsAvailable={model.forkAuctionDetails !== undefined}
			forkAuctionError={model.forkAuctionError}
			loadingForkAuctionDetails={model.loadingForkAuctionDetails}
			loadingReportingDetails={model.loadingReportingDetails}
			onLoadForkAuction={model.onLoadForkAuction}
			onLoadReporting={model.onLoadReporting}
			reportingError={model.reportingError}
			securityPoolAddress={model.securityPoolAddress}
			showHeader={model.showHeader}
		>
			{!model.showSecurityPoolAddressInput && model.hasLoadedPoolContext ? undefined : (
				<div className='form-grid'>
					{!model.showSecurityPoolAddressInput ? undefined : <LookupFieldRow label={commonCopy.securityPoolAddress} value={model.forkAuctionForm.securityPoolAddress} onInput={securityPoolAddress => model.onForkAuctionFormChange({ securityPoolAddress })} placeholder={commonCopy.hexValuePlaceholder} />}
					{model.hasLoadedPoolContext ? undefined : <p className='detail'>{forkAuctionCopy.forkWorkflowDescription}</p>}
				</div>
			)}
			{forkWorkflowStageNavigator}
			{model.hasLoadedPoolContext ? stagePanel : undefined}
		</ForkAuctionWorkflowShell>
	)
}
