import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '@zoltar/ui-zoltar/copy/forkAuction.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EscalationDepositSelectionList } from '@zoltar/ui-zoltar/features/reporting/components/EscalationDepositSelectionList.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { ImportedForkSettlementSection } from '@zoltar/ui-zoltar/features/reporting/components/ImportedForkSettlementSection.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingAwareText, LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { TransactionUniverseValue } from '@zoltar/ui-zoltar/features/universes/components/TransactionUniverseValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js'
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js'
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/lib/actionAvailability.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, AUCTION_TIME_SECONDS, getForkAuctionStageLabel, getForkAuctionStageView, getTimeRemaining } from '../lib/forkAuction.js'
import { buildTruthAuctionDepthPoints, estimateRepPurchased, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js'
import { formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '../../markets/lib/marketForm.js'
import { getWrongNetworkMessage, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '@zoltar/ui-zoltar/features/reporting/lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection, type ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js'
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js'
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionSectionProps } from '../../types.js'

function sameBigIntArray(left: bigint[], right: bigint[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameBigIntRecord(left: Record<ReportingOutcomeKey, bigint[]>, right: Record<ReportingOutcomeKey, bigint[]>) {
	return sameBigIntArray(left.invalid, right.invalid) && sameBigIntArray(left.yes, right.yes) && sameBigIntArray(left.no, right.no)
}

type DisplayMetric = {
	label: string
	value: ComponentChildren
}
type TruthAuctionStateBadge = {
	label: string
	tone: 'blocked' | 'muted' | 'ok' | 'pending'
}

type MigrationStateBadge = {
	label: string
	tone: 'muted' | 'ok' | 'pending'
}

const FORK_MIGRATION_DURATION = 4_838_400n
const FORK_WORKFLOW_NAV_STAGES: readonly ForkWorkflowSelectionStage[] = ['fork-triggered', 'migration', 'auction', 'settlement']
function getForkWorkflowStageLabel(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return forkAuctionCopy.forkReadiness
		case 'migration':
			return forkAuctionCopy.migration
		case 'auction':
			return commonCopy.truthAuction
		case 'settlement':
			return commonCopy.settlement
		default:
			return assertNever(stage)
	}
}

function getForkWorkflowStageOrder(stage: ForkWorkflowSelectionStage) {
	return FORK_WORKFLOW_NAV_STAGES.indexOf(stage)
}

function getForkWorkflowStageIcon(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-triggered' />
		case 'migration':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-migration' />
		case 'auction':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-auction' />
		case 'settlement':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-settlement' />
		default:
			return assertNever(stage)
	}
}

function getTruthAuctionWindow(startedAt: bigint | undefined) {
	if (startedAt === undefined || startedAt === 0n) return undefined
	return {
		startedAt,
		endsAt: startedAt + AUCTION_TIME_SECONDS,
	}
}
function renderMetricValue(value: bigint | undefined, suffix: string, fallbackText: string) {
	if (value === undefined) return fallbackText
	return <CurrencyValue value={value} suffix={suffix} />
}

function renderTruthAuctionPriceValue(value: bigint | undefined, fallbackText: string = commonCopy.metricUnavailablePlaceholder) {
	if (value === undefined) return fallbackText
	const formattedPrice = formatRoundedCurrencyBalance(value, 18, 4)
	const exactPrice = formatCurrencyInputBalance(value)
	return (
		<span className='truth-auction-price-value' title={forkAuctionCopy.formatEthPerRepValue(exactPrice)}>
			{formattedPrice} {forkAuctionCopy.ethRep}
		</span>
	)
}
function renderAddress(address: string | undefined) {
	if (address === undefined) return commonCopy.metricUnavailablePlaceholder
	return <AddressValue address={address} />
}
function renderTimestamp({ displayTimestamp, fallbackText }: { displayTimestamp: bigint | undefined; fallbackText: string }) {
	if (displayTimestamp === undefined) return fallbackText
	return <TimestampValue timestamp={displayTimestamp} />
}
function renderTruthAuctionCapacityOwnershipNotice(showRefundOnlySettlementCopy = false) {
	if (showRefundOnlySettlementCopy) {
		return (
			<WarningSurface as='section' surface='flat' variant='compact'>
				<p className='detail'>
					<strong>{forkAuctionCopy.refundSettlementDetail}</strong> {forkAuctionCopy.formatFinalizedRefundOnlySettlementNotice(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}
				</p>
			</WarningSurface>
		)
	}

	return (
		<WarningSurface as='section' surface='flat' variant='compact'>
			<p className='detail'>
				<strong>{forkAuctionCopy.formatWinningClaimCapacityOwnershipHeadline(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}</strong> {forkAuctionCopy.formatWinningClaimSettlementNotice(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}
			</p>
		</WarningSurface>
	)
}

function renderTruthAuctionSettlementSelectionSummary({
	estimatedAssignedCapacityOwnershipAttoRep,
	estimatedRefundedAttoEth,
	estimatedVaultRepBackingAttoRep,
	selectedClaimCount,
	selectedRefundCount,
	selectedRowCount,
}: {
	estimatedAssignedCapacityOwnershipAttoRep: bigint | undefined
	estimatedRefundedAttoEth: bigint
	estimatedVaultRepBackingAttoRep: bigint | undefined
	selectedClaimCount: number
	selectedRefundCount: number
	selectedRowCount: number
}) {
	if (selectedRowCount === 0) return undefined

	const summaryDescription = (() => {
		if (selectedClaimCount > 0 && selectedRefundCount > 0) {
			return forkAuctionCopy.formatMixedSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		}
		if (selectedClaimCount > 0) {
			return forkAuctionCopy.formatWinningSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		}
		return forkAuctionCopy.formatRefundSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
	})()

	const refundDescription = estimatedRefundedAttoEth > 0n ? forkAuctionCopy.truthAuctionRefundEstimateDetail : undefined
	let roundingDescription: string | undefined
	if (selectedClaimCount > 0) {
		if (estimatedVaultRepBackingAttoRep === undefined) {
			roundingDescription = forkAuctionCopy.underfundedWinningClaimUnavailable
		} else {
			roundingDescription = forkAuctionCopy.settlementRoundingNotice
		}
	}

	return (
		<WarningSurface as='section' surface='flat' variant='compact'>
			<p className='detail'>
				<strong>{forkAuctionCopy.selectedBidSettlementPreview}</strong> {summaryDescription}
			</p>
			{renderWorkflowMetricGrid([
				{ label: forkAuctionCopy.selectedBids, value: selectedRowCount.toString() },
				{ label: forkAuctionCopy.selectedWinningBids, value: selectedClaimCount.toString() },
				{ label: forkAuctionCopy.selectedRefundRows, value: selectedRefundCount.toString() },
				{ label: forkAuctionCopy.estimatedVaultRepBackingAttoRep, value: estimatedVaultRepBackingAttoRep === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedVaultRepBackingAttoRep} suffix={commonCopy.rep} /> },
				{ label: forkAuctionCopy.formatEstimatedValue(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL), value: estimatedAssignedCapacityOwnershipAttoRep === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedAssignedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
				{ label: forkAuctionCopy.estimatedRefundedAttoEth, value: <CurrencyValue value={estimatedRefundedAttoEth} suffix={commonCopy.eth} /> },
			])}
			{roundingDescription === undefined ? undefined : <p className='detail'>{roundingDescription}</p>}
			{refundDescription === undefined ? undefined : <p className='detail'>{refundDescription}</p>}
		</WarningSurface>
	)
}

function getForkOnlyFallbackText(hasPreviewForkActivity: boolean) {
	return hasPreviewForkActivity ? commonCopy.metricUnavailablePlaceholder : forkAuctionCopy.forkUnavailablePlaceholder
}

function getForkTypeLabel(forkOwnSecurityPool: boolean) {
	return forkOwnSecurityPool ? forkAuctionCopy.ownEscalationFork : forkAuctionCopy.parentZoltarFork
}

function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }: { hasPreviewForkActivity: boolean; isSyntheticForkTriggerPreview: boolean; previewPool: ListedSecurityPool | undefined }) {
	if (previewPool === undefined) return commonCopy.metricUnavailablePlaceholder
	if (!hasPreviewForkActivity) return forkAuctionCopy.forkUnavailablePlaceholder
	if (isSyntheticForkTriggerPreview) return forkAuctionCopy.notChosen
	return getForkTypeLabel(previewPool.forkOwnSecurityPool)
}
function getPreviewMigrationSummary(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return commonCopy.metricUnavailablePlaceholder
	if (!hasPreviewForkActivity) return forkAuctionCopy.forkUnavailablePlaceholder
	if (previewPool.truthAuctionStartedAt > 0n) return commonCopy.metricUnavailablePlaceholder
	return commonCopy.metricUnavailablePlaceholder
}
function getForkWorkflowStageAheadMessage(stage: ForkWorkflowSelectionStage, currentStage: ForkWorkflowSelectionStage) {
	if (getForkWorkflowStageOrder(stage) <= getForkWorkflowStageOrder(currentStage)) return undefined
	return undefined
}

function getForkWorkflowStageClassName({ currentStage, selectedStage, stage }: { currentStage: ForkWorkflowSelectionStage; selectedStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage']
	if (currentStage === stage) classNames.push('is-current')
	if (selectedStage === stage) classNames.push('is-selected')
	if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage)) classNames.push('is-complete')
	if (getForkWorkflowStageOrder(stage) > getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}

function getForkWorkflowSeparatorClassName({ currentStage, stage }: { currentStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage-separator']
	if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage)) classNames.push('is-complete')
	if (getForkWorkflowStageOrder(stage) >= getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}
function renderWorkflowMetricGrid(metrics: DisplayMetric[]) {
	return (
		<MetricGrid>
			{metrics.map(metric => (
				<MetricField key={metric.label} label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</MetricGrid>
	)
}

function renderChildSecurityPoolsSection({ auctionOutcomeSelector, childSecurityPools, renderSelectedOutcomeChildPoolNotice }: { auctionOutcomeSelector: ComponentChildren; childSecurityPools: ListedSecurityPool[]; renderSelectedOutcomeChildPoolNotice: () => ComponentChildren }) {
	return (
		<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.childSecurityPools} variant='embedded'>
			{auctionOutcomeSelector}
			{renderSelectedOutcomeChildPoolNotice()}
			{childSecurityPools.length === 0 ? null : (
				<div className='fork-workflow-child-pool-list'>
					{childSecurityPools.map(pool => (
						<article className='fork-workflow-child-pool-card' key={pool.securityPoolAddress}>
							<div className='fork-workflow-child-pool-card-copy'>
								<strong>{pool.questionOutcome === 'none' ? forkAuctionCopy.pendingOutcome : getReportingOutcomeLabel(pool.questionOutcome)}</strong>
								<span>{pool.systemState === 'operational' ? commonCopy.operational : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedAttoRep: pool.migratedAttoRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt }))}</span>
							</div>
							<div className='fork-workflow-child-pool-card-meta'>
								<span>
									<AddressValue address={pool.securityPoolAddress} />
								</span>
								<SecurityPoolLink securityPoolAddress={pool.securityPoolAddress} universeId={pool.universeId}>
									{forkAuctionCopy.openSecurityPool}
								</SecurityPoolLink>
							</div>
						</article>
					))}
				</div>
			)}
		</SectionBlock>
	)
}

function estimateBidRep(bidAmount: string, bidPrice: bigint | undefined) {
	if (bidPrice === undefined) return undefined
	const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseTruthAuctionAmountInput(bidAmount)
	if (parsedBidAmount === undefined) return undefined
	return estimateRepPurchased(parsedBidAmount, bidPrice)
}
function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp <= migrationEndsAt) return forkAuctionCopy.truthAuctionMigrationPendingDetail
	return undefined
}

function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp > migrationEndsAt) return forkAuctionCopy.parentMigrationExpiredDetail
	return undefined
}

function getTruthAuctionBypassReason({ migratedAttoRep, parentSettlementCollateralAttoEthAmount, auctionableAttoRepAtFork }: { migratedAttoRep: bigint; parentSettlementCollateralAttoEthAmount: bigint | undefined; auctionableAttoRepAtFork: bigint | undefined }) {
	if (parentSettlementCollateralAttoEthAmount === 0n) return forkAuctionCopy.truthAuctionNoCollateralDetail
	if (auctionableAttoRepAtFork === undefined) return undefined
	if (auctionableAttoRepAtFork === 0n) return forkAuctionCopy.truthAuctionNoRepDetail
	if (migratedAttoRep >= auctionableAttoRepAtFork) return forkAuctionCopy.childUniverseFullyMigratedDetail
	return undefined
}

function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return forkAuctionCopy.loadingTruthAuction
	if (truthAuction.finalized) return forkAuctionCopy.truthAuctionFinalizedReason
	if (truthAuctionEndsAt === undefined) return forkAuctionCopy.auctionEndTimeUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp <= truthAuctionEndsAt) return forkAuctionCopy.auctionOngoingReason
	return undefined
}

function clampPercentage(value: bigint, maxValue: bigint) {
	return (getVisualRatio({ value, maxValue }) ?? 0) * 100
}

function getTruthAuctionStateBadge({
	hasSelectedAuctionChildPool,
	isStartTruthAuctionInProgress,
	startTruthAuctionCountdown,
	truthAuction,
	truthAuctionStartedAt,
}: {
	hasSelectedAuctionChildPool: boolean
	isStartTruthAuctionInProgress: boolean
	startTruthAuctionCountdown: bigint | undefined
	truthAuction: TruthAuctionMetrics | undefined
	truthAuctionStartedAt: bigint
}): TruthAuctionStateBadge {
	if (truthAuction === undefined) {
		if (isStartTruthAuctionInProgress || (hasSelectedAuctionChildPool && truthAuctionStartedAt === 0n && startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n)) {
			return { label: commonCopy.pending, tone: 'pending' }
		}
		if (truthAuctionStartedAt > 0n) return { label: forkAuctionCopy.started, tone: 'pending' }
		return { label: forkAuctionCopy.inactive, tone: 'muted' }
	}
	if (!truthAuction.finalized) {
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) {
			return { label: forkAuctionCopy.clearing, tone: 'pending' }
		}
		return { label: forkAuctionCopy.open, tone: 'pending' }
	}
	if (truthAuction.underfunded) return { label: forkAuctionCopy.shortfall, tone: 'blocked' }
	if (truthAuction.hitCap) return { label: commonCopy.settled, tone: 'ok' }
	return { label: forkAuctionCopy.unfilled, tone: 'muted' }
}

function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }): MigrationStateBadge {
	if (migrationEndsAt === undefined) return { label: forkAuctionCopy.notStartedBadgeLabel, tone: 'muted' }
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: forkAuctionCopy.closed, tone: 'ok' }
	if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt) return { label: forkAuctionCopy.closed, tone: 'ok' }
	return { label: forkAuctionCopy.open, tone: 'pending' }
}

function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}

export function ForkAuctionSection({
	accountState,
	auctionDetailsOverride,
	currentStageView,
	currentTimestamp,
	disabled = false,
	embedInCard = false,
	forkAuctionDetails,
	forkAuctionActiveAction,
	forkAuctionError,
	forkAuctionForm,
	forkAuctionResult,
	forkMigrationReadClient,
	lifecycleStateOverride,
	loadingReportingDetails = false,
	loadingForkAuctionDetails,
	onClaimAuctionProceeds,
	onFinalizeTruthAuction,
	onForkAuctionFormChange,
	onLoadForkAuction,
	onMigrateRepToZoltar,
	onClaimParentEscalationDeposits,
	onMigrateUnresolvedEscalation,
	onMigrateVault,
	onRefundLosingBids,
	onLoadReporting,
	onReportingFormChange,
	onStartTruthAuction,
	onSubmitBid,
	onWithdrawForkedEscalation,
	previewPool,
	reportingDetails,
	reportingError,
	reportingForm,
	selectedStageView,
	selectedPoolRefreshNonce = 0,
	securityPools = [],
	universeForkTime,
	stageView,
	onSelectedStageViewChange,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	truthAuctionReadClient,
}: ForkAuctionSectionProps) {
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const hasEnteredForkLifecycle = lifecycleStateOverride === 'poolForked' || lifecycleStateOverride === 'forkMigration' || lifecycleStateOverride === 'forkTruthAuction'
	const hasTriggeredFork = hasEnteredForkLifecycle || (universeForkTime !== undefined && universeForkTime > 0n)
	const forkOutcome = forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome
	const questionOutcome = forkAuctionDetails?.questionOutcome ?? previewPool?.questionOutcome
	const previewPoolHasActualForkActivity = previewPool?.hasForkActivity === true
	const isSyntheticForkTriggerPreview = lifecycleStateOverride === 'poolForked' && !previewPoolHasActualForkActivity
	const hasPreviewForkActivity = previewPoolHasActualForkActivity || lifecycleStateOverride === 'poolForked'
	const previewForkTypeLabel = getPreviewForkTypeLabel({
		hasPreviewForkActivity,
		isSyntheticForkTriggerPreview,
		previewPool,
	})
	const resolvedForkTypeLabel = forkAuctionDetails === undefined ? previewForkTypeLabel : getForkTypeLabel(forkAuctionDetails.forkOwnSecurityPool)
	const forkOnlyFallbackText = getForkOnlyFallbackText(hasPreviewForkActivity)
	const migrationSummaryText = forkAuctionDetails === undefined ? getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) : undefined
	const hasLoadedPoolContext = securityPoolAddress !== undefined && systemState !== undefined
	const selectedOutcomeLabel = getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)
	const selectedAuctionLabel = selectedOutcomeLabel
	const { currentStage, currentWorkflowStage, selectedStage } = getForkWorkflowStageSelection({
		currentStageView,
		forkAuctionDetails,
		forkOutcome,
		previewPool,
		selectedStageView,
		stageView,
		systemState,
	})
	const selectedStageAheadMessage = getForkWorkflowStageAheadMessage(selectedStage, currentWorkflowStage)
	const currentSelectedOutcomePool = previewPool !== undefined && previewPool.questionOutcome === forkAuctionForm.selectedOutcome ? previewPool : undefined
	const connectedWalletVaultSummary = accountState.address === undefined || previewPool === undefined ? undefined : previewPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const selectedOutcomeMigrationChildPool = securityPoolAddress === undefined ? undefined : securityPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === forkAuctionForm.selectedOutcome)
	const selectedOutcomeMigrationChildVault = selectedOutcomeMigrationChildPool === undefined || accountState.address === undefined ? undefined : selectedOutcomeMigrationChildPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const fullTruthAuctionReadClient = isFullReadClient(truthAuctionReadClient) ? truthAuctionReadClient : undefined
	const {
		loadingSelectedAuctionChildPoolRecovery,
		loadingSelectedOutcomeMigrationSeedStatus,
		retryingSelectedAuctionDetails,
		retrySelectedAuctionChildPoolRecovery,
		retrySelectedAuctionDetails,
		retrySelectedOutcomeMigrationSeedStatus,
		selectedAuctionChildPool,
		selectedAuctionChildPoolRecoveryError,
		selectedAuctionDetails,
		selectedAuctionError,
		selectedOutcomeMigrationSeedStatus,
		selectedOutcomeMigrationSeedStatusError,
	} = useSelectedAuctionReadState({
		accountAddress: accountState.address,
		currentSelectedOutcomePool,
		forkAuctionResultHash: forkAuctionResult?.hash,
		forkMigrationReadClient,
		fullTruthAuctionReadClient,
		securityPoolAddress,
		selectedAuctionLabel,
		selectedOutcome: forkAuctionForm.selectedOutcome,
		selectedOutcomeMigrationChildPool,
		selectedPoolRefreshNonce,
		selectedStage,
		universeId,
	})
	const selectedAuctionPoolAddress = selectedAuctionChildPool?.securityPoolAddress
	const selectedAuctionUniverseId = selectedAuctionChildPool?.universeId
	const currentRootAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: forkAuctionDetails?.securityPoolAddress !== undefined && selectedAuctionPoolAddress !== undefined && sameAddress(forkAuctionDetails.securityPoolAddress, selectedAuctionPoolAddress) ? forkAuctionDetails : undefined,
		selectedPool: selectedAuctionChildPool,
	})
	const currentSelectedAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: selectedAuctionDetails,
		selectedPool: selectedAuctionChildPool,
	})
	const selectedAuctionContext = (() => {
		if (auctionDetailsOverride !== undefined) return auctionDetailsOverride
		if (currentRootAuctionDetails !== undefined) return currentRootAuctionDetails
		if (currentSelectedAuctionDetails !== undefined) return currentSelectedAuctionDetails

		return undefined
	})()
	const auctionSecurityPoolAddress = selectedAuctionContext?.securityPoolAddress ?? selectedAuctionChildPool?.securityPoolAddress
	const auctionTruthAuctionAddress = selectedAuctionContext?.truthAuctionAddress ?? selectedAuctionChildPool?.truthAuctionAddress
	const auctionTruthAuctionStatus = selectedAuctionContext?.truthAuction
	const auctionHasStartedAtValue = selectedAuctionContext?.truthAuctionStartedAt ?? selectedAuctionChildPool?.truthAuctionStartedAt ?? 0n
	const hasSelectedAuctionChildPool = selectedAuctionChildPool !== undefined
	const selectedAuctionContextError = selectedAuctionError
	const optimisticTruthAuctionStartedAt =
		forkAuctionResult?.action === 'startTruthAuction' && auctionSecurityPoolAddress !== undefined && sameAddress(forkAuctionResult.securityPoolAddress, auctionSecurityPoolAddress) ? (effectiveCurrentTimestamp ?? forkAuctionDetails?.migrationEndsAt ?? selectedAuctionContext?.currentTime ?? 1n) : undefined
	let effectiveTruthAuctionStartedAt = optimisticTruthAuctionStartedAt
	if (auctionHasStartedAtValue > 0n) effectiveTruthAuctionStartedAt = auctionHasStartedAtValue
	const hasStartedTruthAuction = effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n
	const { beginStartTruthAuctionProgress, beginVaultMigrationProgress, hasCompletedVaultMigration, isStartTruthAuctionInProgressState, isVaultMigrationPending, optimisticClaimedParentDisputeStakedRep, setPendingParentEscalationClaimSelection } = useForkAuctionInteractionState({
		accountAddress: accountState.address,
		connectedWalletDisputeStakedAttoRep: connectedWalletVaultSummary?.disputeStakedAttoRep,
		forkAuctionActiveAction,
		forkAuctionError,
		forkAuctionResult,
		hasStartedTruthAuction,
		reportingDetails,
		securityPoolAddress,
		startTruthAuctionSecurityPoolAddress: selectedAuctionPoolAddress,
	})
	const effectiveDisputeStakedAttoRep = (() => {
		if (connectedWalletVaultSummary === undefined) return undefined
		if (connectedWalletVaultSummary.disputeStakedAttoRep > optimisticClaimedParentDisputeStakedRep) {
			return connectedWalletVaultSummary.disputeStakedAttoRep - optimisticClaimedParentDisputeStakedRep
		}
		return 0n
	})()
	const activeReportingDetails = reportingDetails?.status === 'active' ? reportingDetails : undefined
	const isMigrationRequired = activeReportingDetails?.settlementState === 'migration-required'
	const isMigrationExpired = activeReportingDetails?.settlementState === 'migration-expired'
	const escalationMigrationEntitlement = reportingDetails?.viewerEscalationMigrationEntitlement
	const hasStoredEscalationMigrationEntitlement = escalationMigrationEntitlement?.initialized === true
	const selectedOutcomeEscalationEntitlementMaterialized = escalationMigrationEntitlement?.materializedByOutcome[forkAuctionForm.selectedOutcome] === true
	const hasUnresolvedMigrationState = isMigrationRequired || isMigrationExpired || hasStoredEscalationMigrationEntitlement
	const selectedParentEscalationClaimSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome)
	const selectedParentEscalationClaimDeposits = selectedParentEscalationClaimSide?.userDeposits ?? []
	const selectedParentEscalationClaimDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? []
	const showSelectedParentEscalationClaimDeposits = !loadingReportingDetails && reportingDetails?.status === 'active'
	const hasSelectedParentEscalationClaimDeposits = selectedParentEscalationClaimDeposits.length > 0
	const unresolvedMigrationSides = activeReportingDetails?.sides ?? []
	const [selectedImportedForkDepositIndexesByOutcome, setSelectedImportedForkDepositIndexesByOutcome] = useState<Record<ReportingOutcomeKey, bigint[]>>({
		invalid: [],
		yes: [],
		no: [],
	})
	function renderSelectedOutcomeChildPoolLink() {
		if (selectedAuctionChildPool === undefined) return undefined

		return (
			<SecurityPoolLink className='fork-workflow-outcome-link' securityPoolAddress={selectedAuctionChildPool.securityPoolAddress} universeId={selectedAuctionChildPool.universeId}>
				{forkAuctionCopy.childPool}
			</SecurityPoolLink>
		)
	}

	const migrationBalancesContent = (() => {
		if (accountState.address === undefined) return <p className='detail'>{forkAuctionCopy.parentBalancesWalletRequired}</p>
		if (connectedWalletVaultSummary === undefined) return <p className='detail'>{forkAuctionCopy.parentVaultBalancesUnavailableDetail}</p>
		const selectedOutcomeMigrationVaultBalanceContent = (() => {
			if (selectedOutcomeMigrationChildPool === undefined) return undefined

			return (
				<>
					<p className='detail'>{forkAuctionCopy.migratedBalancesForThisOutcome}</p>
					{renderWorkflowMetricGrid([
						{ label: forkAuctionCopy.selectedOutcomeRepCollateral, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.vaultAttoRepBacking ?? 0n} suffix={commonCopy.rep} /> },
						{ label: forkAuctionCopy.selectedOutcomeCapacityOwnershipAttoRep, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.capacityOwnershipAttoRep ?? 0n} suffix={commonCopy.rep} /> },
					])}
				</>
			)
		})()

		return (
			<>
				{renderWorkflowMetricGrid([
					{ label: commonCopy.repCollateral, value: <CurrencyValue value={connectedWalletVaultSummary.vaultAttoRepBacking} suffix={commonCopy.rep} /> },
					{ label: commonCopy.capacityOwnershipAttoRep, value: <CurrencyValue value={connectedWalletVaultSummary.capacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
					{ label: commonCopy.disputeStakedAttoRep, value: <CurrencyValue value={effectiveDisputeStakedAttoRep ?? 0n} suffix={commonCopy.rep} /> },
				])}
				<div className='form-grid fork-workflow-outcome-selector'>
					<label className='field'>
						<span>{commonCopy.outcome}</span>
						<div className='fork-workflow-outcome-selector-row'>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
							{renderSelectedOutcomeChildPoolLink()}
						</div>
					</label>
				</div>
				{renderSelectedOutcomeChildPoolNotice()}
				{selectedOutcomeMigrationVaultBalanceContent}
			</>
		)
	})()
	const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.vaultAttoRepBacking > 0n || connectedWalletVaultSummary.capacityOwnershipAttoRep > 0n)
	const hasWalletParentEscalationClaimBalance = effectiveDisputeStakedAttoRep !== undefined && effectiveDisputeStakedAttoRep > 0n
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? forkAuctionCopy.poolMigrationCapacityEmpty : undefined
	const claimParentEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? forkAuctionCopy.walletDisputeStakedRepEmpty : undefined
	const totalUnresolvedMigrationDepositCount = unresolvedMigrationSides.reduce((count, side) => count + side.userDeposits.length, 0)
	const hasUnresolvedMigrationDeposits = totalUnresolvedMigrationDepositCount > 0
	const importedForkSettlementSides = activeReportingDetails?.sides.filter(side => side.importedUserDeposits.length > 0) ?? []
	const hasImportedForkSettlementDeposits = importedForkSettlementSides.length > 0
	const importedForkSettlementResolved = isPoolQuestionFinalized(activeReportingDetails)
	const childSecurityPools = securityPoolAddress === undefined ? [] : securityPools.filter(pool => sameAddress(pool.parent, securityPoolAddress))
	const enteredBidPreview = getTruthAuctionBidPreview(forkAuctionForm.submitBidPrice)
	const enteredBidPrice = enteredBidPreview?.enteredPrice
	const submittedBidPrice = enteredBidPreview?.submittedPrice
	const enteredBidTick = enteredBidPreview?.tick
	const enteredBidAmount = tryParseTruthAuctionAmountInput(forkAuctionForm.submitBidAmount)
	const estimatedAttoRep = estimateBidRep(forkAuctionForm.submitBidAmount, submittedBidPrice)
	const resultingBidEthBalance = enteredBidAmount === undefined || accountState.ethBalanceAttoEth === undefined || enteredBidAmount > accountState.ethBalanceAttoEth ? undefined : accountState.ethBalanceAttoEth - enteredBidAmount
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const truthAuctionFallback = (() => {
		if (auctionTruthAuctionStatus !== undefined) return commonCopy.metricUnavailablePlaceholder
		if (hasSelectedAuctionChildPool) return commonCopy.metricUnavailablePlaceholder
		return forkOnlyFallbackText
	})()
	const truthAuctionStatus = auctionTruthAuctionStatus
	const isTruthAuctionDetailsLoading = hasSelectedAuctionChildPool && hasStartedTruthAuction && truthAuctionStatus === undefined && selectedAuctionContextError === undefined
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && auctionTruthAuctionAddress !== undefined && auctionTruthAuctionAddress !== zeroAddress
	const {
		aggregatedAuctionBidCountForLoadedTicks,
		aggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		hasMoreTickSummaries,
		hasMoreViewerBids,
		hasLoadedAggregatedAuctionBids,
		hasLoadedTruthAuctionBook,
		hasLoadedViewerTruthAuctionBids,
		loadNextAuctionBidPage,
		loadNextTickPage,
		loadNextViewerBidPage,
		loadingAggregatedAuctionBids,
		loadingTruthAuctionBook,
		loadingViewerTruthAuctionBids,
		retryingPublicTruthAuctionBook,
		retryingViewerTruthAuctionBids,
		retryPublicTruthAuctionBook,
		retryViewerTruthAuctionBids,
		selectTruthAuctionTick,
		selectedBookTick,
		truthAuctionBookData,
		truthAuctionBookError,
		viewerTruthAuctionBidsError,
	} = useTruthAuctionBookData({
		accountAddress: accountState.address,
		enteredBidTick,
		forkAuctionResultHash: forkAuctionResult?.hash,
		selectedStage,
		shouldShowTruthAuctionVisualization,
		truthAuctionAddress: auctionTruthAuctionAddress,
		truthAuctionClearingTick: truthAuctionStatus?.clearingTick,
		truthAuctionReadClient,
	})
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuctionStatus)
	const startTruthAuctionCountdown = forkAuctionDetails?.migrationEndsAt === undefined || effectiveCurrentTimestamp === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, effectiveCurrentTimestamp)
	const isStartTruthAuctionInProgress = (() => {
		if (hasStartedTruthAuction) return false
		if (isStartTruthAuctionInProgressState) return true
		if (forkAuctionActiveAction === 'startTruthAuction') return true

		return false
	})()
	const truthAuctionStateBadge = getTruthAuctionStateBadge({
		hasSelectedAuctionChildPool,
		isStartTruthAuctionInProgress,
		startTruthAuctionCountdown,
		truthAuction: truthAuctionStatus,
		truthAuctionStartedAt: effectiveTruthAuctionStartedAt ?? 0n,
	})
	const startedDisplay = (() => {
		if (hasStartedTruthAuction) {
			return renderTimestamp({
				displayTimestamp: effectiveTruthAuctionStartedAt,
				fallbackText: forkAuctionCopy.notStarted,
			})
		}
		if (isStartTruthAuctionInProgress) return forkAuctionCopy.startingTruncated
		if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
			if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n) return forkAuctionCopy.formatStartsInValue(formatDuration(startTruthAuctionCountdown))
			return forkAuctionCopy.notStarted
		}
		return forkAuctionCopy.notStarted
	})()
	const endsDisplay = (() => {
		if (auctionWindow === undefined) return isStartTruthAuctionInProgress ? forkAuctionCopy.pendingConfirmation : forkAuctionCopy.notStarted
		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={auctionWindow.endsAt} />
	})()
	const hasStartedSelectedTruthAuctionTimeline = hasStartedTruthAuction || truthAuctionStatus !== undefined || selectedStage === 'auction' || selectedStage === 'settlement' || currentWorkflowStage === 'auction' || currentWorkflowStage === 'settlement'
	const activeTickSummaries = truthAuctionBookData.tickSummaries
	const truthAuctionOverviewProgress = getTruthAuctionOverviewProgress(truthAuctionStatus, activeTickSummaries)
	const displayedEthRaisedAttoEth = truthAuctionOverviewProgress?.attoEthRaised ?? truthAuctionStatus?.attoEthRaised ?? 0n
	const displayedRepSoldAttoRep = truthAuctionOverviewProgress?.attoRepSold ?? truthAuctionStatus?.totalAttoRepPurchased ?? 0n
	const ethRaisedProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedEthRaisedAttoEth, truthAuctionStatus.attoEthRaiseCap)
	const repSoldProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedRepSoldAttoRep, truthAuctionStatus.maxAttoRepBeingSold)
	const truthAuctionDepthPoints = buildTruthAuctionDepthPoints({
		enteredBidTick,
		selectedBookTick,
		tickSummaries: activeTickSummaries,
		truthAuction: truthAuctionStatus,
	})
	const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick)
	const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick)
	const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined)
	const maxTickAttoEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalBidAttoEth > maximumEth ? point.currentTotalBidAttoEth : maximumEth), 0n)
	const ethRaisedCapDisplay =
		truthAuctionStatus === undefined ? (
			truthAuctionFallback
		) : (
			<Fragment>
				<CurrencyValue value={displayedEthRaisedAttoEth} suffix={commonCopy.eth} /> / <CurrencyValue value={truthAuctionStatus.attoEthRaiseCap} suffix={commonCopy.eth} />
			</Fragment>
		)
	const clearingPriceDisplay = truthAuctionStatus === undefined ? truthAuctionFallback : renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)
	const settlementAvailableDisplay = (() => {
		if (!hasSelectedAuctionChildPool) return forkAuctionCopy.forkUnavailablePlaceholder
		if (selectedAuctionContext?.claimingAvailable) return commonCopy.yes

		return commonCopy.no
	})()
	const settlementBidRows = getTruthAuctionSettlementBidRows({
		accountAddress: accountState.address,
		truthAuction: truthAuctionStatus,
		viewerBids: truthAuctionBookData.viewerBids,
	})
	const { isSettleSelectedBidsInProgress, selectedSettlementBidKeys, setSelectedSettlementBidKeys, settlementBidResultByKey, settlementSelectionState, submitClaimBidsByKeys, submitRefundBidsByKeys, submitSelectedSettlementBids } = useTruthAuctionSettlementActionState({
		accountAddress: accountState.address,
		forkAuctionError,
		forkAuctionResult,
		onClaimAuctionProceeds,
		onRefundLosingBids,
		selectedAuctionPoolAddress,
		selectedAuctionUniverseId,
		selectedStage,
		settlementBidRows,
		truthAuctionFinalized: truthAuctionStatus?.finalized === true,
	})
	const selectedSettlementBidRows = settlementSelectionState.selectedRows
	const selectedRefundSettlementBidRows = settlementSelectionState.selectedRefundRows
	const selectedClaimSettlementBidRows = settlementSelectionState.selectedClaimRows
	const selectedClaimSettlementBidKeys = settlementSelectionState.selectedClaimKeys
	const selectedRefundSettlementBidKeys = settlementSelectionState.selectedRefundKeys
	const settlementSelectionMode = settlementSelectionState.selectionMode
	const settlementSelectionHasClaims = settlementSelectionState.selectionHasClaims
	const settlementSelectionHasRefunds = settlementSelectionState.selectionHasRefunds
	const settlementSelectionEstimate = getTruthAuctionSettlementSelectionEstimate({
		auctionedCapacityOwnershipAttoRep: selectedAuctionContext?.auctionedCapacityOwnershipAttoRep,
		selectedRows: selectedSettlementBidRows,
		truthAuction: truthAuctionStatus,
	})
	const settlementAction =
		getTruthAuctionSettlementAction({
			selectionHasClaims: settlementSelectionHasClaims,
			selectionHasRefunds: settlementSelectionHasRefunds,
			truthAuctionFinalized: truthAuctionStatus?.finalized === true,
		}) ?? 'refundLosingBids'
	const showRefundOnlySettlementCapacityOwnershipNotice = truthAuctionStatus?.finalized === true && selectedRefundSettlementBidRows.length > 0 && selectedClaimSettlementBidRows.length === 0
	const settlementActionLabel = forkAuctionCopy.settleSelectedBids
	const settlementActionDescription = (() => {
		if (settlementSelectionMode === 'claim') return forkAuctionCopy.formatWinningBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		if (settlementSelectionMode === 'refund') {
			if (truthAuctionStatus?.finalized === true) return forkAuctionCopy.formatFinalizedRefundBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
			return forkAuctionCopy.formatRefundableBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		}
		return forkAuctionCopy.formatMixedBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
	})()
	const settlementActionPendingLabel = forkAuctionCopy.submittingSettlementTransactionTruncated
	const auctionBidRows = buildTruthAuctionBidRows({
		bids: aggregatedAuctionBids,
		truthAuction: truthAuctionStatus,
	})
	const viewerBidRowsViewModel = buildViewerTruthAuctionBidRows({
		accountAddress: accountState.address,
		isSettlementInProgress: isSettleSelectedBidsInProgress,
		selectedBidKeys: selectedSettlementBidKeys,
		selectedStage,
		settlementResultByKey: settlementBidResultByKey,
		truthAuction: truthAuctionStatus,
		viewerBids: truthAuctionBookData.viewerBids,
	})
	const viewerBidRows = viewerBidRowsViewModel.rows
	const showViewerSettlementActionColumn = viewerBidRowsViewModel.showSettlementActionColumn
	const onSettlementBidSelectionChange = (bidKey: string, checked: boolean) => {
		setSelectedSettlementBidKeys(currentKeys => updateTruthAuctionSettlementBidSelection(currentKeys, bidKey, checked))
	}
	const interactionDisabledReason = (() => {
		if (accountState.address === undefined) return forkAuctionCopy.forkActionWalletRequired
		if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason

		return undefined
	})()
	const forkPoolState = evaluateSecurityPoolState({
		forkStage: deriveSecurityPoolForkStage({
			currentStage,
			workflowDisabled: disabled,
		}),
		lifecycleState:
			lifecycleStateOverride ??
			deriveSecurityPoolLifecycleState({
				hasForkActivity: forkAuctionDetails?.hasForkActivity ?? previewPool?.hasForkActivity,
				isChildPool: (forkAuctionDetails?.parentSecurityPoolAddress ?? previewPool?.parent) !== zeroAddress,
				questionOutcome,
				systemState,
				universeHasForked: previewPool?.universeHasForked,
			}),
		universeHasForked: previewPool?.universeHasForked === true,
	})
	const truthAuctionBidGuardMessage = (() => {
		if (isTruthAuctionDetailsLoading) return undefined
		if (!hasStartedTruthAuction) return forkAuctionCopy.truthAuctionNotStartedReason
		if (selectedAuctionContextError !== undefined) return selectedAuctionContextError
		return getTruthAuctionBidGuardMessage({
			accountAddress: accountState.address,
			currentTimestamp: effectiveCurrentTimestamp,
			isOnActiveAppChain,
			submitBidAmountInput: forkAuctionForm.submitBidAmount,
			truthAuction: truthAuctionStatus,
			walletBalanceAttoEth: accountState.ethBalanceAttoEth,
		})
	})()
	const startTruthAuctionGuardMessage = getStartTruthAuctionGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const finalizeTruthAuctionGuardMessage = getFinalizeTruthAuctionGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		truthAuction: truthAuctionStatus,
		truthAuctionEndsAt,
	})
	const truthAuctionEndedNotice = (() => {
		if (truthAuctionStatus === undefined) return undefined
		const hasEndedByTime = truthAuctionEndsAt !== undefined && effectiveCurrentTimestamp !== undefined && effectiveCurrentTimestamp >= truthAuctionEndsAt
		if (!truthAuctionStatus.finalized && !hasEndedByTime) return undefined
		return (
			<div className='notice success'>
				<p>
					<strong>{forkAuctionCopy.auctionEndedStatus}</strong> {truthAuctionStatus.finalized ? forkAuctionCopy.formatFinalizedSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL) : forkAuctionCopy.truthAuctionFinalizationRequiredDetail}{' '}
					{truthAuctionEndsAt === undefined ? undefined : (
						<Fragment>
							{forkAuctionCopy.endedAtLead}
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={truthAuctionEndsAt} />
						</Fragment>
					)}
				</p>
				{truthAuctionStatus.finalized ? undefined : (
					<div className='actions'>
						{renderStageActionButton({
							action: 'finalizeTruthAuction',
							availability: createActionAvailability(finalizeTruthAuctionGuardMessage),
							forceEnabled: hasSelectedAuctionChildPool,
							idleLabel: forkAuctionCopy.finalizeTruthAuction,
							onClick: onFinalizeTruthAuctionForSelectedAuction,
							pendingLabel: forkAuctionCopy.finalizingTruthAuctionTruncated,
						})}
					</div>
				)}
			</div>
		)
	})()
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return forkAuctionCopy.formatTruthAuctionStartDelay(formatDuration(startTruthAuctionCountdown))
	})()
	const isVaultMigrationComplete = hasCompletedVaultMigration || (connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance)
	const truthAuctionBypassReason = getTruthAuctionBypassReason({
		migratedAttoRep: selectedAuctionContext?.migratedAttoRep ?? selectedAuctionChildPool?.migratedAttoRep ?? 0n,
		parentSettlementCollateralAttoEthAmount: forkAuctionDetails?.settlementCollateralAttoEth ?? previewPool?.settlementCollateralAttoEth,
		auctionableAttoRepAtFork: forkAuctionDetails?.auctionableAttoRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (isStartTruthAuctionInProgress) return forkAuctionCopy.startingTruthAuction
		return startTruthAuctionGuardMessage
	})()
	const setSelectedParentEscalationClaimDepositIndexes = (nextSelectedDepositIndexes: bigint[]) => {
		if (onReportingFormChange === undefined || reportingForm === undefined) return
		onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: {
				...reportingForm.selectedWithdrawDepositIndexesByOutcome,
				[forkAuctionForm.selectedOutcome]: nextSelectedDepositIndexes,
			},
		})
	}
	const claimSelectedParentEscalationDepositsGuardMessage = (() => {
		if (claimParentEscalationBalanceGuardMessage !== undefined) return claimParentEscalationBalanceGuardMessage
		if (loadingReportingDetails) return forkAuctionCopy.eligibleDepositsLoading
		if (reportingDetails?.status !== 'active') return forkAuctionCopy.escalationDepositDetailsUnavailable
		if (isMigrationRequired) return forkAuctionCopy.useUnresolvedMigrationReason
		if (isMigrationExpired) return forkAuctionCopy.unresolvedMigrationExpiredReason
		if (selectedParentEscalationClaimDeposits.length === 0) return forkAuctionCopy.formatNoClaimableParentEscalationDeposits(selectedOutcomeLabel)
		if (selectedParentEscalationClaimDepositIndexes.length > 0) return undefined
		return forkAuctionCopy.parentEscalationClaimSelectionRequired
	})()
	const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrateUnresolvedEscalationGuardMessage = (() => {
		if (migrationWindowClosedGuardMessage !== undefined) return migrationWindowClosedGuardMessage
		if (loadingReportingDetails) return forkAuctionCopy.unresolvedDepositsLoading
		if (selectedOutcomeEscalationEntitlementMaterialized) return forkAuctionCopy.formatEntitlementAlreadyMaterialized(selectedOutcomeLabel)
		if (hasStoredEscalationMigrationEntitlement) return undefined
		if (!isMigrationRequired) return forkAuctionCopy.unresolvedMigrationUnavailableReason
		if (activeReportingDetails === undefined) return forkAuctionCopy.unresolvedDepositDetailsUnavailable
		if (!hasUnresolvedMigrationDeposits) return forkAuctionCopy.walletUnresolvedDepositsEmpty
		return undefined
	})()
	const migratePoolToUniverseGuardMessage = (() => {
		if (loadingSelectedOutcomeMigrationSeedStatus) return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus?.seeded) return forkAuctionCopy.formatPoolRepAlreadyMigrated(selectedOutcomeLabel)
		return undefined
	})()
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (loadingSelectedOutcomeMigrationSeedStatus) return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return forkAuctionCopy.formatPoolMigrationRequiredForVault(selectedOutcomeLabel)
	})()
	const migrateVaultCompletedMessage = isVaultMigrationComplete ? forkAuctionCopy.vaultMigrationCompleteReason : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationPending ? forkAuctionCopy.migratingVault : undefined
	const migrateVaultGuardMessage = isMigrationRequired ? forkAuctionCopy.combinedUnresolvedMigrationDetail : (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage)
	const submitBidGuardMessage = truthAuctionBidGuardMessage ?? bidPriceValidationMessage
	const migrationStateBadge = getMigrationStateBadge({
		currentTimestamp: effectiveCurrentTimestamp,
		effectiveTruthAuctionStartedAt,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrationStatusBadge = <Badge tone={migrationStateBadge.tone}>{migrationStateBadge.label}</Badge>
	const onStartTruthAuctionSubmit = () => {
		beginStartTruthAuctionProgress()
		onStartTruthAuction(selectedAuctionPoolAddress, selectedAuctionUniverseId)
	}
	const onSubmitBidForSelectedAuction = () => {
		onSubmitBid(selectedAuctionPoolAddress, selectedAuctionUniverseId)
	}
	function onFinalizeTruthAuctionForSelectedAuction() {
		onFinalizeTruthAuction(selectedAuctionPoolAddress, selectedAuctionUniverseId)
	}
	const settlementActionAvailabilityMessage = getTruthAuctionSettlementActionAvailabilityMessage({
		claimingAvailable: selectedAuctionContext?.claimingAvailable,
		selectedClaimRows: selectedClaimSettlementBidRows,
		selectedRows: selectedSettlementBidRows,
		selectionHasClaims: settlementSelectionHasClaims,
		selectionHasRefunds: settlementSelectionHasRefunds,
		truthAuction: truthAuctionStatus,
	})
	const onRefundLosingBidsForSelectedAuction = () => {
		if (selectedRefundSettlementBidRows.length === 0) return
		submitRefundBidsByKeys(selectedRefundSettlementBidKeys)
	}
	const onSettleSelectedBidsForSelectedAuction = () => {
		submitSelectedSettlementBids()
	}
	const onClaimAuctionProceedsForSelectedAuction = () => {
		if (selectedClaimSettlementBidRows.length === 0) return
		submitClaimBidsByKeys(selectedClaimSettlementBidKeys)
	}
	const onMigrateVaultSubmit = () => {
		beginVaultMigrationProgress()
		onMigrateVault()
	}
	const onMigrateSelectedOutcomeRepToZoltar = () => {
		onMigrateRepToZoltar([forkAuctionForm.selectedOutcome])
	}
	const onClaimSelectedParentEscalationDeposits = () => {
		setPendingParentEscalationClaimSelection({
			depositIndexes: selectedParentEscalationClaimDepositIndexes,
			outcome: forkAuctionForm.selectedOutcome,
		})
		onClaimParentEscalationDeposits(forkAuctionForm.selectedOutcome, selectedParentEscalationClaimDepositIndexes)
	}
	const onMigrateUnresolvedEscalationSubmit = () => {
		setPendingParentEscalationClaimSelection(undefined)
		beginVaultMigrationProgress()
		onMigrateUnresolvedEscalation(forkAuctionForm.selectedOutcome)
	}
	const onWithdrawForkedEscalationSubmit = (outcome: ReportingOutcomeKey) => {
		const selectedDepositIndexes = selectedImportedForkDepositIndexesByOutcome[outcome]
		if (selectedDepositIndexes.length === 0) return
		onWithdrawForkedEscalation(outcome, selectedDepositIndexes)
	}
	function renderStageActionButton({
		action,
		availability,
		forceEnabled,
		idleLabel,
		onClick,
		pendingLabel,
		pending,
		tone = 'secondary',
	}: {
		action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>
		availability?: {
			disabled: boolean
			reason: string | undefined
		}
		forceEnabled?: boolean
		idleLabel: string
		onClick: () => void
		pendingLabel: string
		pending?: boolean
		tone?: 'primary' | 'secondary'
	}) {
		const resolvedAvailability = availability ?? { disabled: false, reason: undefined }
		const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled
		const disabledReason = !isOnActiveAppChain ? (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) : (interactionDisabledReason ?? resolvedAvailability.reason)
		const isPending = pending ?? forkAuctionActiveAction === action
		return (
			<TransactionActionButton
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={isPending}
				tone={tone}
				availability={{
					disabled: !isOnActiveAppChain || !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
					reason: disabledReason,
				}}
			/>
		)
	}
	function renderSelectedOutcomeChildPoolNotice() {
		if (selectedAuctionChildPool !== undefined) return undefined
		const noticeContent = (() => {
			if (loadingSelectedAuctionChildPoolRecovery)
				return (
					<p className='detail'>
						<LoadingText>{forkAuctionCopy.formatLoadingOutcomePoolDetail(selectedOutcomeLabel)}</LoadingText>
					</p>
				)
			if (selectedAuctionChildPoolRecoveryError !== undefined) return <ErrorNotice message={selectedAuctionChildPoolRecoveryError} />
			return <p className='detail'>{forkAuctionCopy.formatMissingOutcomePoolDetail(selectedOutcomeLabel)}</p>
		})()
		return (
			<div className='fork-workflow-outcome-notice'>
				{noticeContent}
				{selectedAuctionChildPoolRecoveryError === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' onClick={retrySelectedAuctionChildPoolRecovery} type='button'>
							{forkAuctionCopy.retryChildUniverse}
						</button>
					</div>
				)}
			</div>
		)
	}
	const renderSubmitBidSection = () => (
		<SectionBlock title={forkAuctionCopy.submitBidTitle} variant='embedded'>
			<div className='form-grid'>
				{submitBidPreviewTickSummary === undefined ? undefined : (
					<p className='detail'>
						{forkAuctionCopy.selectedLadderPriceLead}
						{renderTruthAuctionPriceValue(submitBidPreviewTickSummary.price)}
					</p>
				)}
				<div className='field-row'>
					<label className='field'>
						<span>{forkAuctionCopy.bidPriceEthRep}</span>
						<FormInput value={forkAuctionForm.submitBidPrice} onInput={event => onForkAuctionFormChange({ submitBidPrice: event.currentTarget.value })} />
					</label>
					<label className='field'>
						<span>{forkAuctionCopy.bidAmountEth}</span>
						<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
					</label>
				</div>
				<TransactionReview
					context={[
						{ label: commonCopy.question, value: selectedAuctionChildPool?.marketDetails.title ?? previewPool?.marketDetails.title ?? commonCopy.unavailable },
						{ label: commonCopy.securityPoolAddress, value: auctionSecurityPoolAddress === undefined ? commonCopy.unavailable : <AddressValue address={auctionSecurityPoolAddress} /> },
						{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={selectedAuctionChildPool?.universeId ?? universeId} /> },
						{ label: commonCopy.outcome, value: selectedAuctionLabel },
					]}
					primary={[
						{ label: transactionReviewCopy.youPay, value: <CurrencyValue value={enteredBidAmount} suffix={commonCopy.eth} /> },
						{ label: forkAuctionCopy.potentialRepIfFilled, value: <CurrencyValue value={estimatedAttoRep} suffix={commonCopy.rep} /> },
					]}
					details={[
						{ label: forkAuctionCopy.enteredBidPrice, value: enteredBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(enteredBidPrice) },
						{ label: forkAuctionCopy.submittedTickPrice, value: submittedBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(submittedBidPrice) },
						{ label: transactionReviewCopy.resultingEthBalance, value: <CurrencyValue value={resultingBidEthBalance} suffix={commonCopy.eth} /> },
					]}
					risks={[forkAuctionCopy.bidEscrowRisk, forkAuctionCopy.bidFillRisk, forkAuctionCopy.winningBidCapacityOwnershipRisk]}
				/>
				<div className='actions'>
					{renderStageActionButton({
						action: 'submitBid',
						availability: createActionAvailability(submitBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel: forkAuctionCopy.submitBid,
						onClick: onSubmitBidForSelectedAuction,
						pending: isTruthAuctionDetailsLoading || forkAuctionActiveAction === 'submitBid',
						pendingLabel: isTruthAuctionDetailsLoading ? forkAuctionCopy.loadingTruthAuction : forkAuctionCopy.submittingBidTruncated,
					})}
				</div>
			</div>
		</SectionBlock>
	)
	const renderSettlementActionSection = ({
		action,
		description,
		idleLabel,
		pendingLabel,
		pending = false,
		selectionSummary,
		title,
		availabilityMessage,
		onClick,
		tone = 'primary',
	}: {
		action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>
		description?: ComponentChildren
		idleLabel: string
		pendingLabel: string
		pending?: boolean
		selectionSummary?: ComponentChildren
		title?: ComponentChildren
		availabilityMessage: string | undefined
		onClick?: () => void
		tone?: 'primary' | 'secondary'
	}) => (
		<SectionBlock density='compact' title={title} headingLevel={4} variant='embedded'>
			{description === undefined || selectionSummary !== undefined ? undefined : <p className='detail'>{description}</p>}
			{selectionSummary}
			{selectionSummary === undefined ? renderTruthAuctionCapacityOwnershipNotice(showRefundOnlySettlementCapacityOwnershipNotice) : undefined}
			<div className='actions'>
				{renderStageActionButton({
					action,
					availability: createActionAvailability(availabilityMessage),
					forceEnabled: hasSelectedAuctionChildPool,
					idleLabel,
					onClick: onClick ?? (action === 'refundLosingBids' ? onRefundLosingBidsForSelectedAuction : onClaimAuctionProceedsForSelectedAuction),
					pendingLabel,
					pending,
					tone,
				})}
			</div>
		</SectionBlock>
	)
	useEffect(() => {
		if (!isMigrationRequired || onReportingFormChange === undefined || reportingForm === undefined || activeReportingDetails === undefined) return
		const nextSelectedDepositIndexesByOutcome = {
			invalid: activeReportingDetails.sides.find(side => side.key === 'invalid')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
			yes: activeReportingDetails.sides.find(side => side.key === 'yes')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
			no: activeReportingDetails.sides.find(side => side.key === 'no')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
		}
		if (sameBigIntRecord(nextSelectedDepositIndexesByOutcome, reportingForm.selectedWithdrawDepositIndexesByOutcome)) return
		onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: nextSelectedDepositIndexesByOutcome,
		})
	}, [activeReportingDetails, isMigrationRequired, onReportingFormChange, reportingForm])
	useEffect(() => {
		const nextSelectedImportedDepositIndexesByOutcome = {
			invalid: importedForkSettlementSides.find(side => side.key === 'invalid')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
			yes: importedForkSettlementSides.find(side => side.key === 'yes')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
			no: importedForkSettlementSides.find(side => side.key === 'no')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
		}
		setSelectedImportedForkDepositIndexesByOutcome(currentSelections => {
			const prunedSelections = {
				invalid: currentSelections.invalid.filter(index => nextSelectedImportedDepositIndexesByOutcome.invalid.includes(index)),
				yes: currentSelections.yes.filter(index => nextSelectedImportedDepositIndexesByOutcome.yes.includes(index)),
				no: currentSelections.no.filter(index => nextSelectedImportedDepositIndexesByOutcome.no.includes(index)),
			}
			if (sameBigIntRecord(prunedSelections, currentSelections)) return currentSelections
			return prunedSelections
		})
	}, [importedForkSettlementSides])
	const migrationStartedAt = (() => {
		if (universeForkTime !== undefined && universeForkTime > 0n) return universeForkTime
		if (forkAuctionDetails?.migrationEndsAt !== undefined) return forkAuctionDetails.migrationEndsAt - FORK_MIGRATION_DURATION
		return undefined
	})()
	const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionableAttoRepAtFork} suffix={commonCopy.rep} />
	const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedAttoRep ?? previewPool?.migratedAttoRep, commonCopy.rep, commonCopy.metricUnavailablePlaceholder)
	const migrationSettlementCollateralDisplay = renderMetricValue(forkAuctionDetails?.settlementCollateralAttoEth ?? previewPool?.settlementCollateralAttoEth, commonCopy.eth, commonCopy.metricUnavailablePlaceholder)
	const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? forkAuctionCopy.notStarted : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={migrationStartedAt} />
	const migrationEndsDisplay = (() => {
		if (forkAuctionDetails === undefined) return migrationSummaryText
		if (hasStartedSelectedTruthAuctionTimeline && effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) {
			return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={effectiveTruthAuctionStartedAt} />
		}
		if (forkAuctionDetails.migrationEndsAt === undefined) return forkAuctionCopy.notStarted

		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
	})()
	const truthAuctionStateBadgeElement = <Badge tone={truthAuctionStateBadge.tone}>{truthAuctionStateBadge.label}</Badge>
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: forkAuctionCopy.truthAuctionAddress, value: renderAddress(auctionTruthAuctionAddress) },
		{ label: forkAuctionCopy.started, value: startedDisplay },
		{ label: commonCopy.ends, value: endsDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchasedAttoRep, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSoldAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.clearingPrice, value: clearingPriceDisplay },
		{ label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.minBidSizeAttoEth, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSizeAttoEth} suffix={commonCopy.eth} /> },
		{ label: forkAuctionCopy.maxAttoRepBeingSold, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxAttoRepBeingSold} suffix={commonCopy.rep} /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.settlementAvailable, value: settlementAvailableDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchasedAttoRep, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSoldAttoRep} suffix={commonCopy.rep} /> },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid fork-workflow-outcome-selector'>
			<label className='field'>
				<span>{commonCopy.outcome}</span>
				<div className='fork-workflow-outcome-selector-row'>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					{renderSelectedOutcomeChildPoolLink()}
				</div>
			</label>
		</div>
	)
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedCapacityOwnershipAttoRepDisplay={selectedAuctionContext === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} />}
				badge={truthAuctionStateBadgeElement}
				clearingPriceDisplay={renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)}
				displayedEthRaisedAttoEth={displayedEthRaisedAttoEth}
				displayedRepSoldAttoRep={displayedRepSoldAttoRep}
				endsDisplay={endsDisplay}
				attoEthRaiseCap={truthAuctionStatus.attoEthRaiseCap}
				ethRaisedProgress={ethRaisedProgress}
				maxAttoRepBeingSold={truthAuctionStatus.maxAttoRepBeingSold}
				minBidSizeAttoEth={truthAuctionStatus.minBidSizeAttoEth}
				repSoldProgress={repSoldProgress}
				startedDisplay={startedDisplay}
				winningThresholdPriceDisplay={winningThresholdPrice === undefined ? undefined : renderTruthAuctionPriceValue(winningThresholdPrice)}
			/>
		)
	})()
	const migrationSummaryCard = (
		<SectionBlock badge={migrationStatusBadge} className='fork-workflow-summary-card migration-summary-card' title={forkAuctionCopy.migrationStatus} variant='embedded'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary migration-summary-primary'>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{forkAuctionCopy.repAtFork}</span>
							<strong>{migrationRepAtForkDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{forkAuctionCopy.migratedAttoRep}</span>
							<strong>{migrationRepDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{forkAuctionCopy.settlementCollateral}</span>
							<strong>{migrationSettlementCollateralDisplay}</strong>
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={forkAuctionCopy.migrationStarted}>{migrationStartedDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.migrationEnds}>{migrationEndsDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.forkType}>{resolvedForkTypeLabel}</MetricField>
				</div>
			</div>
			{forkAuctionDetails?.ownForkRepBuckets === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={forkAuctionCopy.advancedDiagnostics}>
					<div className='fork-workflow-summary-metrics'>
						<MetricField label={forkAuctionCopy.totalPoolHeldRepAtForkAttoRep}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.vaultRepAtForkAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={forkAuctionCopy.escalationChildRepPerSelectedOutcomeAttoRep}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={forkAuctionCopy.escrowSourceRepAtForkAttoRep}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtForkAttoRep} suffix={commonCopy.rep} />
						</MetricField>
					</div>
				</ReadOnlyDetailAccordion>
			)}
		</SectionBlock>
	)
	const truthAuctionMarketViewSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionMarketViewSection
				clearingTick={truthAuctionStatus.clearingTick}
				hasMoreTickSummaries={hasMoreTickSummaries}
				loadingTruthAuctionBook={loadingTruthAuctionBook}
				maxTickAttoEth={maxTickAttoEth}
				onLoadNextTickPage={loadNextTickPage}
				onSelectTick={selectTruthAuctionTick}
				renderPriceValue={renderTruthAuctionPriceValue}
				showDepthClearingTick={truthAuctionStatus.hitCap && truthAuctionStatus.clearingTick !== undefined}
				truthAuctionBookError={truthAuctionBookError}
				truthAuctionDepthPoints={truthAuctionDepthPoints}
			/>
		)
	})()
	const auctionWideBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<TruthAuctionBidsSection
				aggregatedAuctionBidCountForLoadedTicks={aggregatedAuctionBidCountForLoadedTicks}
				error={truthAuctionBookError}
				hasLoadedData={hasLoadedTruthAuctionBook && hasLoadedAggregatedAuctionBids}
				hasMoreAggregatedAuctionBids={hasMoreAggregatedAuctionBids}
				loadedTickCount={truthAuctionBookData.tickSummaries.length}
				loadingAggregatedAuctionBids={loadingTruthAuctionBook || loadingAggregatedAuctionBids}
				onLoadNextAuctionBidPage={loadNextAuctionBidPage}
				onRetry={retryPublicTruthAuctionBook}
				renderPriceValue={renderTruthAuctionPriceValue}
				retrying={retryingPublicTruthAuctionBook}
				rows={auctionBidRows}
			/>
		)
	})()
	const auctionWideBidsStatusSection =
		!isTruthAuctionDetailsLoading && selectedAuctionContextError === undefined && !retryingSelectedAuctionDetails ? undefined : (
			<SectionBlock title={forkAuctionCopy.currentBids} variant='embedded'>
				{isTruthAuctionDetailsLoading && !retryingSelectedAuctionDetails ? (
					<p className='detail'>
						<LoadingText>{forkAuctionCopy.loadingAuctionBids}</LoadingText>
					</p>
				) : undefined}
				<ErrorNotice message={selectedAuctionContextError} />
				{selectedAuctionContextError === undefined && !retryingSelectedAuctionDetails ? undefined : (
					<div className='actions'>
						<button className='secondary' disabled={retryingSelectedAuctionDetails} onClick={retrySelectedAuctionDetails} type='button'>
							{retryingSelectedAuctionDetails ? <LoadingText>{forkAuctionCopy.retryingAuctionDetails}</LoadingText> : forkAuctionCopy.retryAuctionDetails}
						</button>
					</div>
				)}
			</SectionBlock>
		)
	const viewerTruthAuctionBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<ViewerTruthAuctionBidsSection
				accountAddress={accountState.address}
				error={viewerTruthAuctionBidsError}
				hasLoadedData={hasLoadedViewerTruthAuctionBids}
				hasMoreViewerBids={hasMoreViewerBids}
				loadingTruthAuctionBook={loadingViewerTruthAuctionBids}
				onLoadNextViewerBidPage={loadNextViewerBidPage}
				onRetry={retryViewerTruthAuctionBids}
				onSettlementBidSelectionChange={onSettlementBidSelectionChange}
				renderPriceValue={renderTruthAuctionPriceValue}
				retrying={retryingViewerTruthAuctionBids}
				rows={viewerBidRows}
				showSettlementActionColumn={showViewerSettlementActionColumn}
			/>
		)
	})()
	const truthAuctionSettlementSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return renderSettlementActionSection({
			action: settlementAction,
			pending: isSettleSelectedBidsInProgress,
			availabilityMessage: settlementActionAvailabilityMessage,
			description: settlementActionDescription,
			idleLabel: settlementActionLabel,
			pendingLabel: settlementActionPendingLabel,
			selectionSummary: renderTruthAuctionSettlementSelectionSummary({
				estimatedAssignedCapacityOwnershipAttoRep: settlementSelectionEstimate.estimatedAssignedCapacityOwnershipAttoRep,
				estimatedRefundedAttoEth: settlementSelectionEstimate.estimatedRefundedAttoEth,
				estimatedVaultRepBackingAttoRep: settlementSelectionEstimate.estimatedVaultRepBackingAttoRep,
				selectedClaimCount: selectedClaimSettlementBidRows.length,
				selectedRefundCount: selectedRefundSettlementBidRows.length,
				selectedRowCount: selectedSettlementBidRows.length,
			}),
			title: settlementActionLabel,
			onClick: onSettleSelectedBidsForSelectedAuction,
			tone: 'primary',
		})
	})()
	const importedForkSettlementSection = (() => {
		if (!hasImportedForkSettlementDeposits) return undefined
		return (
			<ImportedForkSettlementSection
				activeReportingDetails={activeReportingDetails}
				disabled={forkAuctionActiveAction === 'settleForkedEscalation'}
				onDepositSelectionChange={(outcome, depositIndex, checked) => {
					setSelectedImportedForkDepositIndexesByOutcome(currentSelections => ({
						...currentSelections,
						[outcome]: checked ? [...currentSelections[outcome], depositIndex] : currentSelections[outcome].filter(index => index !== depositIndex),
					}))
				}}
				renderSettlementAction={({ guardMessage, outcome, sideLabel }) =>
					renderStageActionButton({
						action: 'settleForkedEscalation',
						availability: createActionAvailability(guardMessage),
						idleLabel: forkAuctionCopy.formatSettleSelectedValueForkCarriedDeposits(sideLabel),
						onClick: () => onWithdrawForkedEscalationSubmit(outcome),
						pendingLabel: forkAuctionCopy.settlingForkCarriedDepositsTruncated,
						tone: 'secondary',
					})
				}
				resolved={importedForkSettlementResolved}
				selectedDepositIndexesByOutcome={selectedImportedForkDepositIndexesByOutcome}
				sides={importedForkSettlementSides}
				winningOutcome={activeReportingDetails?.questionOutcome === 'none' ? undefined : activeReportingDetails?.questionOutcome}
			/>
		)
	})()
	const handleForkWorkflowStageKeyDown = (stage: ForkWorkflowSelectionStage, event: KeyboardEvent) => {
		const currentStageIndex = FORK_WORKFLOW_NAV_STAGES.indexOf(stage)
		if (currentStageIndex === -1) return
		const nextStage = (() => {
			if (event.key === 'ArrowRight') return FORK_WORKFLOW_NAV_STAGES[Math.min(currentStageIndex + 1, FORK_WORKFLOW_NAV_STAGES.length - 1)]
			if (event.key === 'ArrowLeft') return FORK_WORKFLOW_NAV_STAGES[Math.max(currentStageIndex - 1, 0)]
			if (event.key === 'Home') return FORK_WORKFLOW_NAV_STAGES[0]
			if (event.key === 'End') return FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1]
			return undefined
		})()
		if (nextStage === undefined) return
		event.preventDefault()
		onSelectedStageViewChange?.(nextStage)
		const nextTab = document.getElementById(`fork-workflow-stage-${nextStage}`)
		if (nextTab instanceof HTMLElement) nextTab.focus()
	}
	const forkWorkflowStageNavigator = !hasLoadedPoolContext ? undefined : (
		<div className='fork-workflow-stage-nav-shell'>
			<div aria-label={forkAuctionCopy.forkLifecycleStages} className='fork-workflow-stage-nav' role='tablist'>
				{FORK_WORKFLOW_NAV_STAGES.map(stage => {
					const stageLabel = getForkWorkflowStageLabel(stage)
					return (
						<Fragment key={stage}>
							<button
								aria-controls={`fork-workflow-stage-panel-${stage}`}
								aria-current={currentWorkflowStage === stage ? 'step' : undefined}
								aria-label={stageLabel}
								aria-selected={selectedStage === stage}
								className={getForkWorkflowStageClassName({
									currentStage: currentWorkflowStage,
									selectedStage,
									stage,
								})}
								id={`fork-workflow-stage-${stage}`}
								onClick={() => onSelectedStageViewChange?.(stage)}
								onKeyDown={event => handleForkWorkflowStageKeyDown(stage, event)}
								role='tab'
								tabIndex={selectedStage === stage ? 0 : -1}
								type='button'
							>
								{getForkWorkflowStageIcon(stage)}
								<span className='fork-workflow-stage-copy'>
									<strong>{stageLabel}</strong>
									{selectedStage === stage ? <span className='fork-workflow-stage-indicator'>{forkAuctionCopy.viewing}</span> : undefined}
								</span>
							</button>
							{stage === FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1] ? undefined : (
								<span
									aria-hidden='true'
									className={getForkWorkflowSeparatorClassName({
										currentStage: currentWorkflowStage,
										stage,
									})}
								>
									→
								</span>
							)}
						</Fragment>
					)
				})}
			</div>
		</div>
	)
	const stagePanel = (() => {
		if (selectedStage === 'fork-triggered')
			return (
				<fieldset aria-labelledby='fork-workflow-stage-fork-triggered' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-fork-triggered' role='tabpanel'>
					<SectionBlock title={hasTriggeredFork ? commonCopy.forkTriggered : forkAuctionCopy.forkNotTriggered} variant='embedded'>
						{hasTriggeredFork
							? renderWorkflowMetricGrid([
									{
										label: commonCopy.status,
										value: forkAuctionCopy.systemIsForking,
									},
									{
										label: forkAuctionCopy.triggeredAt,
										value: <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={universeForkTime} />,
									},
								])
							: undefined}
					</SectionBlock>
				</fieldset>
			)
		if (selectedStage === 'migration')
			return (
				<fieldset aria-labelledby='fork-workflow-stage-migration' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-migration' role='tabpanel'>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
					{migrationSummaryCard}

					<SectionBlock title={forkAuctionCopy.yourMigrationBalances} variant='embedded' description={forkAuctionCopy.parentWalletBalancesDescription}>
						{migrationBalancesContent}
						{accountState.address === undefined ? undefined : (
							<>
								{hasUnresolvedMigrationState ? (
									<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.clearUnresolvedParentEscalationDepositAccounting} variant='embedded'>
										<p className='detail'>
											<LoadingAwareText>
												{(() => {
													if (isMigrationExpired) return forkAuctionCopy.unresolvedMigrationExpiredDetail
													if (loadingReportingDetails) return forkAuctionCopy.walletUnresolvedDepositsLoading
													if (activeReportingDetails === undefined) return forkAuctionCopy.unresolvedDepositDetailsUnavailable
													if (hasStoredEscalationMigrationEntitlement) return forkAuctionCopy.capturedEntitlementDetail
													if (!hasUnresolvedMigrationDeposits) return forkAuctionCopy.walletUnresolvedDepositsEmpty
													return forkAuctionCopy.unresolvedEscalationMigrationWithVaultDetail
												})()}
											</LoadingAwareText>
										</p>
										{activeReportingDetails === undefined || hasStoredEscalationMigrationEntitlement
											? undefined
											: unresolvedMigrationSides.map(side => (
													<div className='field' key={side.key}>
														<span>{side.label}</span>
														{side.userDeposits.length === 0 ? (
															<p className='detail'>{forkAuctionCopy.formatNoUnresolvedDeposits(side.label.toLowerCase())}</p>
														) : (
															<EscalationDepositSelectionList
																disabled
																items={side.userDeposits.map(deposit => ({
																	deposit,
																	details: [
																		<>
																			{forkAuctionCopy.initiallyDepositedLead}
																			<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
																		</>,
																	],
																	secondaryDetails: [
																		<>
																			{forkAuctionCopy.entryDepthLead}
																			<CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
																		</>,
																	],
																}))}
																onSelectionChange={() => undefined}
																selectedDepositIndexes={side.userDeposits.map(deposit => deposit.depositIndex)}
															/>
														)}
													</div>
												))}
										{isMigrationExpired ? undefined : (
											<div className='actions'>
												{renderStageActionButton({
													action: 'migrateUnresolvedEscalation',
													availability: createActionAvailability(migrateUnresolvedEscalationGuardMessage),
													idleLabel: forkAuctionCopy.formatMigrateUnresolvedEscalationToValue(selectedOutcomeLabel),
													onClick: onMigrateUnresolvedEscalationSubmit,
													pendingLabel: forkAuctionCopy.migratingUnresolvedEscalationTruncated,
													tone: 'primary',
												})}
											</div>
										)}
									</SectionBlock>
								) : (
									<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.claimResolvedParentEscalationDeposits} variant='embedded'>
										<p className='detail'>{forkAuctionCopy.resolvedParentDepositClaimDetail}</p>
										{connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? <p className='detail'>{forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail}</p> : undefined}
										{loadingReportingDetails ? (
											<p className='detail'>
												<LoadingText>{forkAuctionCopy.walletEscalationDepositsLoading}</LoadingText>
											</p>
										) : undefined}
										{loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : <p className='detail'>{forkAuctionCopy.escalationDepositDetailsUnavailable}</p>}
										{showSelectedParentEscalationClaimDeposits && !hasSelectedParentEscalationClaimDeposits ? <p className='detail'>{forkAuctionCopy.formatNoClaimableParentEscalationDeposits(selectedOutcomeLabel)}</p> : undefined}
										{showSelectedParentEscalationClaimDeposits && hasSelectedParentEscalationClaimDeposits ? (
											<div className='field'>
												<span>{forkAuctionCopy.chooseParentDepositsToClaim}</span>
												<EscalationDepositSelectionList
													disabled={forkAuctionActiveAction === 'claimParentEscalationDeposits'}
													items={selectedParentEscalationClaimDeposits.map(deposit => {
														const claimAmount = getEscalationDepositClaimAmount(reportingDetails, forkAuctionForm.selectedOutcome, deposit)
														return {
															deposit,
															details: [
																<>
																	{forkAuctionCopy.initiallyDepositedLead}
																	<CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
																</>,
																claimAmount === undefined ? (
																	forkAuctionCopy.worthNowPendingClaimFinalization
																) : (
																	<>
																		{forkAuctionCopy.worthNowLead}
																		<CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
																	</>
																),
															],
															secondaryDetails: [
																<>
																	{forkAuctionCopy.entryDepthLead}
																	<CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
																</>,
															],
														}
													})}
													onSelectionChange={setSelectedParentEscalationClaimDepositIndexes}
													selectedDepositIndexes={selectedParentEscalationClaimDepositIndexes}
												/>
											</div>
										) : undefined}
										<div className='actions'>
											{renderStageActionButton({
												action: 'claimParentEscalationDeposits',
												availability: createActionAvailability(claimSelectedParentEscalationDepositsGuardMessage),
												idleLabel: forkAuctionCopy.formatClaimSelectedValueParentDeposits(selectedOutcomeLabel),
												onClick: onClaimSelectedParentEscalationDeposits,
												pendingLabel: forkAuctionCopy.claimingParentEscalationDepositsTruncated,
											})}
										</div>
									</SectionBlock>
								)}
								<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migratePoolToUniverse} variant='embedded'>
									<p className='detail'>{forkAuctionCopy.poolRepMigrationDetail}</p>
									{loadingSelectedOutcomeMigrationSeedStatus ? (
										<p className='detail'>
											<LoadingText>{forkAuctionCopy.selectedChildPoolRepReadinessLoading}</LoadingText>
										</p>
									) : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : (
										<>
											<ErrorNotice message={selectedOutcomeMigrationSeedStatusError} />
											<div className='actions'>
												<button className='secondary' onClick={retrySelectedOutcomeMigrationSeedStatus} type='button'>
													{forkAuctionCopy.retryPoolRepReadiness}
												</button>
											</div>
										</>
									)}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalanceAttoRep > 0n ? forkAuctionCopy.poolRepAlreadyMigratedDetail : forkAuctionCopy.poolRepStagedForVaultMigrationDetail}</p>
									)}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateRepToZoltar',
											availability: createActionAvailability(migratePoolToUniverseGuardMessage),
											idleLabel: forkAuctionCopy.formatMigratePoolToValueUniverse(selectedOutcomeLabel),
											onClick: onMigrateSelectedOutcomeRepToZoltar,
											pendingLabel: forkAuctionCopy.migratingPoolToUniverseTruncated,
										})}
									</div>
								</SectionBlock>
								<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migrateVaultTitle} variant='embedded'>
									<p className='detail'>{forkAuctionCopy.vaultMigrationDetail}</p>
									{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>{forkAuctionCopy.poolMigrationCapacityEmpty}</p> : undefined}
									{loadingSelectedOutcomeMigrationSeedStatus ? (
										<p className='detail'>
											<LoadingText>{forkAuctionCopy.selectedChildPoolRepReadinessLoading}</LoadingText>
										</p>
									) : undefined}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateVault',
											availability: createActionAvailability(migrateVaultGuardMessage),
											idleLabel: forkAuctionCopy.formatMigrateVaultToValue(selectedOutcomeLabel),
											onClick: onMigrateVaultSubmit,
											pendingLabel: forkAuctionCopy.migratingVault,
											tone: 'primary',
										})}
									</div>
									{isVaultMigrationComplete ? <p className='detail'>{forkAuctionCopy.alreadyMigratedStatus}</p> : undefined}
								</SectionBlock>
							</>
						)}
					</SectionBlock>
				</fieldset>
			)

		return (() => {
			if (selectedStage === 'auction') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset aria-labelledby='fork-workflow-stage-auction' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-auction' role='tabpanel'>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{auctionOutcomeSelector}
							{renderSelectedOutcomeChildPoolNotice()}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							<ReadOnlyDetailAccordion title={forkAuctionCopy.marketDepth}>{truthAuctionMarketViewSection}</ReadOnlyDetailAccordion>
							{renderSubmitBidSection()}
							{viewerTruthAuctionBidsSection}
							{auctionWideBidsSection}
						</fieldset>
					)
				return (
					<fieldset aria-labelledby='fork-workflow-stage-auction' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-auction' role='tabpanel'>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{auctionOutcomeSelector}
						{renderSelectedOutcomeChildPoolNotice()}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title={forkAuctionCopy.truthAuctionStatus} variant='embedded'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>

						{hasStartedTruthAuction ? undefined : (
							<SectionBlock title={forkAuctionCopy.startTruthAuctionTitle} variant='embedded'>
								<p className='detail'>{forkAuctionCopy.formatStartTruthAuctionDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}</p>
								{startTruthAuctionReadyInText === undefined ? undefined : <p className='detail'>{startTruthAuctionReadyInText}</p>}
								{truthAuctionBypassReason === undefined ? undefined : <p className='detail'>{truthAuctionBypassReason}</p>}
								<div className='actions'>
									{renderStageActionButton({
										action: 'startTruthAuction',
										availability: createActionAvailability(!hasSelectedAuctionChildPool ? forkAuctionCopy.formatMissingChildUniverseDetail(selectedAuctionLabel) : startTruthAuctionAvailabilityMessage),
										forceEnabled: hasSelectedAuctionChildPool,
										idleLabel: truthAuctionBypassReason === undefined ? forkAuctionCopy.startTruthAuction : forkAuctionCopy.bypassTruthAuction,
										onClick: onStartTruthAuctionSubmit,
										pendingLabel: truthAuctionBypassReason === undefined ? forkAuctionCopy.startingTruthAuction : forkAuctionCopy.bypassingAuctionTruncated,
										tone: 'primary',
									})}
								</div>
							</SectionBlock>
						)}

						{renderSubmitBidSection()}
						{auctionWideBidsStatusSection}
					</fieldset>
				)
			}
			if (selectedStage === 'settlement') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset aria-labelledby='fork-workflow-stage-settlement' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-settlement' role='tabpanel'>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							{viewerTruthAuctionBidsSection}
							{truthAuctionSettlementSection}
							{importedForkSettlementSection}
							{renderChildSecurityPoolsSection({
								auctionOutcomeSelector,
								childSecurityPools,
								renderSelectedOutcomeChildPoolNotice,
							})}
						</fieldset>
					)
				return (
					<fieldset aria-labelledby='fork-workflow-stage-settlement' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-settlement' role='tabpanel'>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title={forkAuctionCopy.settlementStatus} variant='embedded'>
							{renderWorkflowMetricGrid(settlementStatusMetrics)}
						</SectionBlock>
						{auctionWideBidsStatusSection}
						{truthAuctionSettlementSection}
						{importedForkSettlementSection}
						{renderChildSecurityPoolsSection({
							auctionOutcomeSelector,
							childSecurityPools,
							renderSelectedOutcomeChildPoolNotice,
						})}
					</fieldset>
				)
			}

			return undefined
		})()
	})()
	const content = (
		<>
			{!showSecurityPoolAddressInput && hasLoadedPoolContext ? undefined : (
				<div className='form-grid'>
					{!showSecurityPoolAddressInput ? undefined : <LookupFieldRow label={commonCopy.securityPoolAddress} value={forkAuctionForm.securityPoolAddress} onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })} placeholder={commonCopy.hexValuePlaceholder} />}
					{hasLoadedPoolContext ? undefined : <p className='detail'>{forkAuctionCopy.forkWorkflowDescription}</p>}
				</div>
			)}
			{forkWorkflowStageNavigator}
			{hasLoadedPoolContext ? stagePanel : undefined}

			<ErrorNotice message={forkAuctionError} />
			{forkAuctionError === undefined || forkAuctionDetails !== undefined || securityPoolAddress === undefined ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={loadingForkAuctionDetails} onClick={() => onLoadForkAuction(securityPoolAddress)} type='button'>
						{forkAuctionCopy.retryForkWorkflow}
					</button>
				</div>
			)}
			<ErrorNotice message={reportingError} />
			{reportingError === undefined || onLoadReporting === undefined ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={loadingReportingDetails} onClick={onLoadReporting} type='button'>
						{loadingReportingDetails ? <LoadingText>{forkAuctionCopy.loadingReportingDetails}</LoadingText> : forkAuctionCopy.retryReporting}
					</button>
				</div>
			)}
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={forkAuctionCopy.forkTruthAuction}>
			{content}
		</RouteWorkflowPanel>
	)
}
