import * as commonCopy from '../../../copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { EscalationDepositSelectionList } from '../../reporting/components/EscalationDepositSelectionList.js'
import { EnumDropdown } from '../../../components/EnumDropdown.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { ImportedForkSettlementSection } from '../../reporting/components/ImportedForkSettlementSection.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { ReadOnlyDetailAccordion } from '../../../components/ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js'
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js'
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js'
import { WarningSurface } from '../../../components/WarningSurface.js'
import { createActionAvailability } from '../../../lib/actionAvailability.js'
import { sameAddress } from '../../../lib/address.js'
import { assertNever } from '../../../lib/assert.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL, AUCTION_TIME_SECONDS, getForkAuctionStageLabel, getForkAuctionStageView, getTimeRemaining } from '../lib/forkAuction.js'
import { buildTruthAuctionDepthPoints, estimateRepPurchased, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js'
import { formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '../../../lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '../../markets/lib/marketForm.js'
import { isMainnetChain } from '../../../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '../../reporting/lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection, type ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js'
import { getVisualRatio } from '../../../lib/visualMetrics.js'
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js'
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js'
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics } from '../../../types/contracts.js'
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
			return commonCopy.forkTriggered
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
function renderTruthAuctionDebtNotice(mode: 'bid' | 'settlement', showRefundOnlySettlementCopy = false) {
	if (mode === 'bid') {
		return (
			<WarningSurface as='section' variant='compact'>
				<p className='detail'>
					<strong>{forkAuctionCopy.winningBidPremiumDetail}</strong> {forkAuctionCopy.formatWinningBidAllowanceNotice(AUCTIONED_BOND_ALLOWANCE_LABEL)}
				</p>
			</WarningSurface>
		)
	}

	if (showRefundOnlySettlementCopy) {
		return (
			<WarningSurface as='section' variant='compact'>
				<p className='detail'>
					<strong>{forkAuctionCopy.refundSettlementDetail}</strong> {forkAuctionCopy.formatFinalizedRefundOnlySettlementNotice(AUCTIONED_BOND_ALLOWANCE_LABEL)}
				</p>
			</WarningSurface>
		)
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>{forkAuctionCopy.formatWinningClaimAllowanceHeadline(AUCTIONED_BOND_ALLOWANCE_LABEL)}</strong> {forkAuctionCopy.formatWinningClaimSettlementNotice(AUCTIONED_BOND_ALLOWANCE_LABEL)}
			</p>
		</WarningSurface>
	)
}

function renderTruthAuctionSettlementSelectionSummary({
	estimatedAssignedBondAllowance,
	estimatedEthRefunded,
	estimatedRepClaimed,
	selectedClaimCount,
	selectedRefundCount,
	selectedRowCount,
}: {
	estimatedAssignedBondAllowance: bigint | undefined
	estimatedEthRefunded: bigint
	estimatedRepClaimed: bigint | undefined
	selectedClaimCount: number
	selectedRefundCount: number
	selectedRowCount: number
}) {
	if (selectedRowCount === 0) return undefined

	const summaryDescription = (() => {
		if (selectedClaimCount > 0 && selectedRefundCount > 0) {
			return forkAuctionCopy.formatMixedSettlementPreviewDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		if (selectedClaimCount > 0) {
			return forkAuctionCopy.formatWinningSettlementPreviewDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		return forkAuctionCopy.formatRefundSettlementPreviewDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
	})()

	const refundDescription = estimatedEthRefunded > 0n ? forkAuctionCopy.truthAuctionRefundEstimateDetail : undefined
	let roundingDescription: string | undefined
	if (selectedClaimCount > 0) {
		if (estimatedRepClaimed === undefined) {
			roundingDescription = forkAuctionCopy.underfundedWinningClaimUnavailable
		} else {
			roundingDescription = forkAuctionCopy.settlementRoundingNotice
		}
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>{forkAuctionCopy.selectedBidSettlementPreview}</strong> {summaryDescription}
			</p>
			{renderWorkflowMetricGrid([
				{ label: forkAuctionCopy.selectedBids, value: selectedRowCount.toString() },
				{ label: forkAuctionCopy.selectedWinningBids, value: selectedClaimCount.toString() },
				{ label: forkAuctionCopy.selectedRefundRows, value: selectedRefundCount.toString() },
				{ label: forkAuctionCopy.estimatedRepClaimed, value: estimatedRepClaimed === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedRepClaimed} suffix={commonCopy.rep} /> },
				{ label: forkAuctionCopy.formatEstimatedValue(AUCTIONED_BOND_ALLOWANCE_LABEL), value: estimatedAssignedBondAllowance === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedAssignedBondAllowance} suffix={commonCopy.eth} /> },
				{ label: forkAuctionCopy.estimatedEthRefunded, value: <CurrencyValue value={estimatedEthRefunded} suffix={commonCopy.eth} /> },
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
								<span>{pool.systemState === 'operational' ? commonCopy.operational : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedRep: pool.migratedRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt }))}</span>
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

function getTruthAuctionBypassReason({ migratedRep, parentCollateralAmount, auctionableRepAtFork }: { migratedRep: bigint; parentCollateralAmount: bigint | undefined; auctionableRepAtFork: bigint | undefined }) {
	if (parentCollateralAmount === 0n) return forkAuctionCopy.truthAuctionNoCollateralDetail
	if (auctionableRepAtFork === undefined) return undefined
	if (auctionableRepAtFork === 0n) return forkAuctionCopy.truthAuctionNoRepDetail
	if (migratedRep >= auctionableRepAtFork) return forkAuctionCopy.childUniverseFullyMigratedDetail
	return undefined
}

function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return forkAuctionCopy.truthAuctionLoadRequired
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
	onClaimAuctionProceeds,
	onFinalizeTruthAuction,
	onForkAuctionFormChange,
	onMigrateRepToZoltar,
	onMigrateEscalationDeposits,
	onMigrateUnresolvedEscalation,
	onMigrateVault,
	onRefundLosingBids,
	onReportingFormChange,
	onStartTruthAuction,
	onSubmitBid,
	onWithdrawForkedEscalation,
	previewPool,
	reportingDetails,
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
	const isMainnet = isMainnetChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const hasTriggeredFork = universeForkTime !== undefined && universeForkTime > 0n
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
	const { loadingSelectedAuctionDetails, loadingSelectedOutcomeMigrationSeedStatus, selectedAuctionChildPool, selectedAuctionDetails, selectedAuctionError, selectedOutcomeMigrationSeedStatus, selectedOutcomeMigrationSeedStatusError } = useSelectedAuctionReadState({
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
	const { beginStartTruthAuctionProgress, beginVaultMigrationProgress, hasCompletedVaultMigration, isStartTruthAuctionInProgressState, isVaultMigrationPending, optimisticMigratedEscalationRep, setPendingEscalationMigrationSelection } = useForkAuctionInteractionState({
		accountAddress: accountState.address,
		connectedWalletEscrowedRep: connectedWalletVaultSummary?.escalationEscrowedRep,
		forkAuctionActiveAction,
		forkAuctionError,
		forkAuctionResult,
		hasStartedTruthAuction,
		reportingDetails,
		securityPoolAddress,
	})
	const effectiveEscrowedRepInEscalationGame = (() => {
		if (connectedWalletVaultSummary === undefined) return undefined
		if (connectedWalletVaultSummary.escalationEscrowedRep > optimisticMigratedEscalationRep) {
			return connectedWalletVaultSummary.escalationEscrowedRep - optimisticMigratedEscalationRep
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
	const selectedEscalationMigrationSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome)
	const selectedEscalationMigrationDeposits = selectedEscalationMigrationSide?.userDeposits ?? []
	const selectedEscalationMigrationDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? []
	const showSelectedEscalationMigrationDeposits = !loadingReportingDetails && reportingDetails?.status === 'active'
	const hasSelectedEscalationMigrationDeposits = selectedEscalationMigrationDeposits.length > 0
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
						{ label: forkAuctionCopy.selectedOutcomeRepCollateral, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.repDepositShare ?? 0n} suffix={commonCopy.rep} /> },
						{ label: forkAuctionCopy.selectedOutcomeSecurityBondAllowance, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.securityBondAllowance ?? 0n} suffix={commonCopy.eth} /> },
					])}
				</>
			)
		})()

		return (
			<>
				{renderWorkflowMetricGrid([
					{ label: commonCopy.repCollateral, value: <CurrencyValue value={connectedWalletVaultSummary.repDepositShare} suffix={commonCopy.rep} /> },
					{ label: commonCopy.securityBondAllowance, value: <CurrencyValue value={connectedWalletVaultSummary.securityBondAllowance} suffix={commonCopy.eth} /> },
					{ label: commonCopy.escrowedRep, value: <CurrencyValue value={effectiveEscrowedRepInEscalationGame ?? 0n} suffix={commonCopy.rep} /> },
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
	const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.repDepositShare > 0n || connectedWalletVaultSummary.securityBondAllowance > 0n)
	const hasWalletEscalationMigrationBalance = effectiveEscrowedRepInEscalationGame !== undefined && effectiveEscrowedRepInEscalationGame > 0n
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? forkAuctionCopy.poolMigrationCapacityEmpty : undefined
	const migrateEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? forkAuctionCopy.walletEscrowedRepEmpty : undefined
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
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, submittedBidPrice)
	const resultingBidEthBalance = enteredBidAmount === undefined || accountState.ethBalance === undefined || enteredBidAmount > accountState.ethBalance ? undefined : accountState.ethBalance - enteredBidAmount
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const truthAuctionFallback = (() => {
		if (auctionTruthAuctionStatus !== undefined) return commonCopy.metricUnavailablePlaceholder
		if (hasSelectedAuctionChildPool) return commonCopy.metricUnavailablePlaceholder
		return forkOnlyFallbackText
	})()
	const truthAuctionStatus = auctionTruthAuctionStatus
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && auctionTruthAuctionAddress !== undefined && auctionTruthAuctionAddress !== zeroAddress
	const {
		aggregatedAuctionBidCountForLoadedTicks,
		aggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		hasMoreTickSummaries,
		hasMoreViewerBids,
		loadNextAuctionBidPage,
		loadNextTickPage,
		loadNextViewerBidPage,
		loadingAggregatedAuctionBids,
		loadingTruthAuctionBook,
		selectTruthAuctionTick,
		selectedBookTick,
		truthAuctionBookData,
		truthAuctionBookError,
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
		truthAuctionStartedAt: auctionHasStartedAtValue,
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
	const displayedEthRaised = truthAuctionOverviewProgress?.ethRaised ?? truthAuctionStatus?.ethRaised ?? 0n
	const displayedRepSold = truthAuctionOverviewProgress?.repSold ?? truthAuctionStatus?.totalRepPurchased ?? 0n
	const ethRaisedProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedEthRaised, truthAuctionStatus.ethRaiseCap)
	const repSoldProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedRepSold, truthAuctionStatus.maxRepBeingSold)
	const truthAuctionDepthPoints = buildTruthAuctionDepthPoints({
		enteredBidTick,
		selectedBookTick,
		tickSummaries: activeTickSummaries,
		truthAuction: truthAuctionStatus,
	})
	const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick)
	const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick)
	const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined)
	const maxTickEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalEth > maximumEth ? point.currentTotalEth : maximumEth), 0n)
	const ethRaisedCapDisplay =
		truthAuctionStatus === undefined ? (
			truthAuctionFallback
		) : (
			<Fragment>
				<CurrencyValue value={displayedEthRaised} suffix={commonCopy.eth} /> / <CurrencyValue value={truthAuctionStatus.ethRaiseCap} suffix={commonCopy.eth} />
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
		auctionedSecurityBondAllowance: selectedAuctionContext?.auctionedSecurityBondAllowance,
		selectedRows: selectedSettlementBidRows,
		truthAuction: truthAuctionStatus,
	})
	const settlementAction =
		getTruthAuctionSettlementAction({
			selectionHasClaims: settlementSelectionHasClaims,
			selectionHasRefunds: settlementSelectionHasRefunds,
			truthAuctionFinalized: truthAuctionStatus?.finalized === true,
		}) ?? 'refundLosingBids'
	const showRefundOnlySettlementDebtNotice = truthAuctionStatus?.finalized === true && selectedRefundSettlementBidRows.length > 0 && selectedClaimSettlementBidRows.length === 0
	const settlementActionLabel = forkAuctionCopy.settleSelectedBids
	const settlementActionDescription = (() => {
		if (settlementSelectionMode === 'claim') return forkAuctionCopy.formatWinningBidBatchSettlementDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
		if (settlementSelectionMode === 'refund') {
			if (truthAuctionStatus?.finalized === true) return forkAuctionCopy.formatFinalizedRefundBatchSettlementDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
			return forkAuctionCopy.formatRefundableBidBatchSettlementDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		return forkAuctionCopy.formatMixedBidBatchSettlementDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)
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
		if (!isMainnet) return commonCopy.mainnetRequiredReason

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
	const truthAuctionBidGuardMessage = getTruthAuctionBidGuardMessage({
		accountAddress: accountState.address,
		currentTimestamp: effectiveCurrentTimestamp,
		isMainnet,
		submitBidAmountInput: forkAuctionForm.submitBidAmount,
		truthAuction: truthAuctionStatus,
		walletEthBalance: accountState.ethBalance,
	})
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
					<strong>{forkAuctionCopy.auctionEndedStatus}</strong> {truthAuctionStatus.finalized ? forkAuctionCopy.formatFinalizedSettlementDetail(AUCTIONED_BOND_ALLOWANCE_LABEL) : forkAuctionCopy.truthAuctionFinalizationRequiredDetail}{' '}
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
		migratedRep: selectedAuctionContext?.migratedRep ?? selectedAuctionChildPool?.migratedRep ?? 0n,
		parentCollateralAmount: forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount,
		auctionableRepAtFork: forkAuctionDetails?.auctionableRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (hasStartedTruthAuction) return forkAuctionCopy.auctionStartedReason
		if (isStartTruthAuctionInProgress) return forkAuctionCopy.startingTruthAuction
		return startTruthAuctionGuardMessage
	})()
	const setSelectedEscalationMigrationDepositIndexes = (nextSelectedDepositIndexes: bigint[]) => {
		if (onReportingFormChange === undefined || reportingForm === undefined) return
		onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: {
				...reportingForm.selectedWithdrawDepositIndexesByOutcome,
				[forkAuctionForm.selectedOutcome]: nextSelectedDepositIndexes,
			},
		})
	}
	const migrateSelectedEscalationDepositsGuardMessage = (() => {
		if (migrateEscalationBalanceGuardMessage !== undefined) return migrateEscalationBalanceGuardMessage
		if (loadingReportingDetails) return forkAuctionCopy.eligibleDepositsLoading
		if (reportingDetails?.status !== 'active') return forkAuctionCopy.escalationDepositDetailsUnavailable
		if (isMigrationRequired) return forkAuctionCopy.useUnresolvedMigrationReason
		if (isMigrationExpired) return forkAuctionCopy.unresolvedMigrationExpiredReason
		if (selectedEscalationMigrationDeposits.length === 0) return forkAuctionCopy.formatNoMigratableEscalationDeposits(selectedOutcomeLabel)
		if (selectedEscalationMigrationDepositIndexes.length > 0) return undefined
		return forkAuctionCopy.migrationDepositSelectionRequired
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
		onStartTruthAuction(selectedAuctionPoolAddress)
	}
	const onSubmitBidForSelectedAuction = () => {
		onSubmitBid(selectedAuctionPoolAddress)
	}
	function onFinalizeTruthAuctionForSelectedAuction() {
		onFinalizeTruthAuction(selectedAuctionPoolAddress)
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
	const onMigrateSelectedEscalationDeposits = () => {
		setPendingEscalationMigrationSelection({
			depositIndexes: selectedEscalationMigrationDepositIndexes,
			outcome: forkAuctionForm.selectedOutcome,
		})
		onMigrateEscalationDeposits(forkAuctionForm.selectedOutcome, selectedEscalationMigrationDepositIndexes)
	}
	const onMigrateUnresolvedEscalationSubmit = () => {
		setPendingEscalationMigrationSelection(undefined)
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
		const disabledReason = !isMainnet ? commonCopy.mainnetRequiredReason : (interactionDisabledReason ?? resolvedAvailability.reason)
		const isPending = pending ?? forkAuctionActiveAction === action
		return (
			<TransactionActionButton
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={isPending}
				tone={tone}
				availability={{
					disabled: !isMainnet || !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
					reason: disabledReason,
				}}
			/>
		)
	}
	function renderSelectedOutcomeChildPoolNotice() {
		if (selectedAuctionChildPool !== undefined) return undefined
		return (
			<div className='fork-workflow-outcome-notice'>
				<p className='detail'>{forkAuctionCopy.formatMissingOutcomePoolDetail(selectedOutcomeLabel)}</p>
			</div>
		)
	}
	const renderSubmitBidSection = ({ description, density = 'balanced', headingLevel = 3, title = forkAuctionCopy.submitBid, variant = 'embedded' }: { description?: ComponentChildren; density?: 'balanced' | 'compact'; headingLevel?: 3 | 4; title?: ComponentChildren; variant?: 'default' | 'embedded' }) => (
		<SectionBlock {...(description === undefined ? {} : { description })} density={density} headingLevel={headingLevel} title={title} variant={variant}>
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
				{enteredBidPrice === undefined ? undefined : (
					<p className='detail'>
						{forkAuctionCopy.bidEstimatedRepDetailLead}
						{estimatedRep === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedRep} suffix={commonCopy.rep} />} {forkAuctionCopy.bidEstimatedRepDetailTail}
					</p>
				)}
				{renderTruthAuctionDebtNotice('bid')}
				<TransactionReview
					primary={[
						{ label: transactionReviewCopy.youPay, value: <CurrencyValue value={enteredBidAmount} suffix={commonCopy.eth} /> },
						{ label: forkAuctionCopy.potentialRepIfFilled, value: <CurrencyValue value={estimatedRep} suffix={commonCopy.rep} /> },
					]}
					details={[
						{ label: forkAuctionCopy.enteredBidPrice, value: enteredBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(enteredBidPrice) },
						{ label: forkAuctionCopy.submittedTickPrice, value: submittedBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(submittedBidPrice) },
						{ label: transactionReviewCopy.resultingEthBalance, value: <CurrencyValue value={resultingBidEthBalance} suffix={commonCopy.eth} /> },
						{ label: transactionReviewCopy.protocolFee, value: transactionReviewCopy.noProtocolFee },
						{ label: transactionReviewCopy.contract, value: auctionTruthAuctionAddress === undefined ? commonCopy.unavailable : <AddressValue address={auctionTruthAuctionAddress} /> },
						{ label: transactionReviewCopy.network, value: transactionReviewCopy.ethereumMainnet },
					]}
					risks={[forkAuctionCopy.bidEscrowRisk, forkAuctionCopy.bidFillRisk, forkAuctionCopy.winningBidDebtRisk]}
				/>
				<div className='actions'>
					{renderStageActionButton({
						action: 'submitBid',
						availability: createActionAvailability(submitBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel: forkAuctionCopy.submitBid,
						onClick: onSubmitBidForSelectedAuction,
						pendingLabel: forkAuctionCopy.submittingBidTruncated,
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
			{description === undefined ? undefined : <p className='detail'>{description}</p>}
			{selectionSummary}
			{renderTruthAuctionDebtNotice('settlement', showRefundOnlySettlementDebtNotice)}
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
	const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionableRepAtFork} suffix={commonCopy.rep} />
	const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, commonCopy.rep, commonCopy.metricUnavailablePlaceholder)
	const migrationCollateralDisplay = renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, commonCopy.eth, commonCopy.metricUnavailablePlaceholder)
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
		{ label: forkAuctionCopy.repPurchased, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.clearingPrice, value: clearingPriceDisplay },
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={commonCopy.eth} /> },
		{ label: forkAuctionCopy.minBidSize, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix={commonCopy.eth} /> },
		{ label: forkAuctionCopy.maxRepBeingSold, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix={commonCopy.rep} /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={commonCopy.eth} /> },
		{ label: forkAuctionCopy.settlementAvailable, value: settlementAvailableDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchased, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix={commonCopy.rep} /> },
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
	const selectedAuctionDetailsNotice = (() => {
		if (!hasSelectedAuctionChildPool || selectedStage === 'migration') return undefined
		if (loadingSelectedAuctionDetails) return <p className='detail'>{forkAuctionCopy.formatLoadingChildAuctionDetails(selectedAuctionLabel)}</p>
		if (selectedAuctionContextError === undefined) return undefined
		return <p className='detail'>{selectedAuctionContextError}</p>
	})()
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedBondAllowanceDisplay={selectedAuctionContext === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={commonCopy.eth} />}
				badge={truthAuctionStateBadgeElement}
				clearingPriceDisplay={renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)}
				displayedEthRaised={displayedEthRaised}
				displayedRepSold={displayedRepSold}
				endsDisplay={endsDisplay}
				ethRaiseCap={truthAuctionStatus.ethRaiseCap}
				ethRaisedProgress={ethRaisedProgress}
				maxRepBeingSold={truthAuctionStatus.maxRepBeingSold}
				minBidSize={truthAuctionStatus.minBidSize}
				repSoldProgress={repSoldProgress}
				startedDisplay={startedDisplay}
				winningThresholdPriceDisplay={winningThresholdPrice === undefined ? undefined : renderTruthAuctionPriceValue(winningThresholdPrice)}
			/>
		)
	})()
	const migrationSummaryCard = (
		<SectionBlock badge={migrationStatusBadge} className='fork-workflow-summary-card migration-summary-card' title={forkAuctionCopy.migrationStatus}>
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
							<span>{forkAuctionCopy.migratedRep}</span>
							<strong>{migrationRepDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{forkAuctionCopy.collateral}</span>
							<strong>{migrationCollateralDisplay}</strong>
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
						<MetricField label={forkAuctionCopy.poolRepAtFork}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.vaultRepAtFork} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={forkAuctionCopy.escalationChildRepPerSelectedOutcome}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escalationChildRepPerSelectedOutcome} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={forkAuctionCopy.escrowSourceRepAtFork}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtFork} suffix={commonCopy.rep} />
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
				maxTickEth={maxTickEth}
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
				hasMoreAggregatedAuctionBids={hasMoreAggregatedAuctionBids}
				loadedTickCount={truthAuctionBookData.tickSummaries.length}
				loadingAggregatedAuctionBids={loadingAggregatedAuctionBids}
				onLoadNextAuctionBidPage={loadNextAuctionBidPage}
				renderPriceValue={renderTruthAuctionPriceValue}
				rows={auctionBidRows}
			/>
		)
	})()
	const viewerTruthAuctionBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<ViewerTruthAuctionBidsSection
				accountAddress={accountState.address}
				hasMoreViewerBids={hasMoreViewerBids}
				loadingTruthAuctionBook={loadingTruthAuctionBook}
				onLoadNextViewerBidPage={loadNextViewerBidPage}
				onSettlementBidSelectionChange={onSettlementBidSelectionChange}
				renderPriceValue={renderTruthAuctionPriceValue}
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
				estimatedAssignedBondAllowance: settlementSelectionEstimate.estimatedAssignedBondAllowance,
				estimatedEthRefunded: settlementSelectionEstimate.estimatedEthRefunded,
				estimatedRepClaimed: settlementSelectionEstimate.estimatedRepClaimed,
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
					<SectionBlock title={commonCopy.forkTriggered} variant='embedded'>
						{hasTriggeredFork ? (
							renderWorkflowMetricGrid([
								{
									label: commonCopy.status,
									value: forkAuctionCopy.systemIsForking,
								},
								{
									label: forkAuctionCopy.triggeredAt,
									value: <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={universeForkTime} />,
								},
							])
						) : (
							<p className='detail'>{forkAuctionCopy.forkInactiveDetail}</p>
						)}
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
									<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migrateUnresolvedEscalationLocks} variant='embedded'>
										<p className='detail'>{isMigrationExpired ? forkAuctionCopy.unresolvedMigrationExpiredDetail : forkAuctionCopy.unresolvedEscalationMigrationWithVaultDetail}</p>
										{loadingReportingDetails ? <p className='detail'>{forkAuctionCopy.walletUnresolvedDepositsLoading}</p> : undefined}
										{loadingReportingDetails || activeReportingDetails !== undefined ? undefined : <p className='detail'>{forkAuctionCopy.unresolvedDepositDetailsUnavailable}</p>}
										{hasStoredEscalationMigrationEntitlement ? <p className='detail'>{forkAuctionCopy.capturedEntitlementDetail}</p> : undefined}
										{activeReportingDetails !== undefined && !hasUnresolvedMigrationDeposits && !hasStoredEscalationMigrationEntitlement ? <p className='detail'>{forkAuctionCopy.walletUnresolvedDepositsEmpty}</p> : undefined}
										<p className='detail'>{forkAuctionCopy.unresolvedEscalationMultiChildDetail}</p>
										{activeReportingDetails === undefined || hasStoredEscalationMigrationEntitlement
											? undefined
											: unresolvedMigrationSides.map(side => (
													<div className='field' key={side.key}>
														<span>{side.label}</span>
														{side.userDeposits.length === 0 ? (
															<p className='detail'>{forkAuctionCopy.formatNoUnresolvedDeposits(side.label)}</p>
														) : (
															<EscalationDepositSelectionList
																disabled
																items={side.userDeposits.map(deposit => ({
																	deposit,
																	details: [
																		<>
																			{forkAuctionCopy.initiallyDepositedLead}
																			<CurrencyValue value={deposit.amount} suffix={commonCopy.rep} />
																		</>,
																		forkAuctionCopy.selectedChildMigrationRequiredDetail,
																		<>
																			{forkAuctionCopy.entryDepthLead}
																			<CurrencyValue value={deposit.cumulativeAmount} suffix={commonCopy.rep} />
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
									<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migrateResolvedEscalationDeposits} variant='embedded'>
										<p className='detail'>{forkAuctionCopy.resolvedDepositMigrationDetail}</p>
										{connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? <p className='detail'>{forkAuctionCopy.escalationMigrationEmptyEscrowDetail}</p> : undefined}
										{loadingReportingDetails ? <p className='detail'>{forkAuctionCopy.walletEscalationDepositsLoading}</p> : undefined}
										{loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : <p className='detail'>{forkAuctionCopy.escalationDepositDetailsUnavailable}</p>}
										{showSelectedEscalationMigrationDeposits && !hasSelectedEscalationMigrationDeposits ? <p className='detail'>{forkAuctionCopy.formatNoMigratableEscalationDeposits(selectedOutcomeLabel)}</p> : undefined}
										{showSelectedEscalationMigrationDeposits && hasSelectedEscalationMigrationDeposits ? (
											<div className='field'>
												<span>{forkAuctionCopy.chooseDepositsToMigrate}</span>
												<EscalationDepositSelectionList
													disabled={forkAuctionActiveAction === 'migrateEscalationDeposits'}
													items={selectedEscalationMigrationDeposits.map(deposit => {
														const claimAmount = getEscalationDepositClaimAmount(reportingDetails, forkAuctionForm.selectedOutcome, deposit)
														return {
															deposit,
															details: [
																<>
																	{forkAuctionCopy.initiallyDepositedLead}
																	<CurrencyValue value={deposit.amount} suffix={commonCopy.rep} />
																</>,
																claimAmount === undefined ? (
																	forkAuctionCopy.worthNowPendingMigrationFinalization
																) : (
																	<>
																		{forkAuctionCopy.worthNowLead}
																		<CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
																	</>
																),
																forkAuctionCopy.currentPathEligibleForChildPoolMigration,
																<>
																	{forkAuctionCopy.entryDepthLead}
																	<CurrencyValue value={deposit.cumulativeAmount} suffix={commonCopy.rep} />
																</>,
															],
														}
													})}
													onSelectionChange={setSelectedEscalationMigrationDepositIndexes}
													selectedDepositIndexes={selectedEscalationMigrationDepositIndexes}
												/>
											</div>
										) : undefined}
										<div className='actions'>
											{renderStageActionButton({
												action: 'migrateEscalationDeposits',
												availability: createActionAvailability(migrateSelectedEscalationDepositsGuardMessage),
												idleLabel: forkAuctionCopy.formatMigrateSelectedValueDeposits(selectedOutcomeLabel),
												onClick: onMigrateSelectedEscalationDeposits,
												pendingLabel: forkAuctionCopy.migratingEscalationDepositsTruncated,
											})}
										</div>
									</SectionBlock>
								)}
								<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migratePoolToUniverse} variant='embedded'>
									<p className='detail'>{forkAuctionCopy.poolRepMigrationDetail}</p>
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>{forkAuctionCopy.selectedChildPoolRepReadinessLoading}</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalance > 0n ? forkAuctionCopy.poolRepAlreadyMigratedDetail : forkAuctionCopy.poolRepStagedForVaultMigrationDetail}</p>
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
								<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.migrateVault} variant='embedded'>
									<p className='detail'>{forkAuctionCopy.vaultMigrationDetail}</p>
									{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>{forkAuctionCopy.poolMigrationCapacityEmpty}</p> : undefined}
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>{forkAuctionCopy.selectedChildPoolRepReadinessLoading}</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
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
							{selectedAuctionDetailsNotice}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							<ReadOnlyDetailAccordion title={forkAuctionCopy.marketDepthAndBidHistory}>
								{truthAuctionMarketViewSection}
								{auctionWideBidsSection}
							</ReadOnlyDetailAccordion>
							{renderSubmitBidSection({
								description: forkAuctionCopy.bidEscrowDetail,
							})}
							{viewerTruthAuctionBidsSection}
						</fieldset>
					)
				return (
					<fieldset aria-labelledby='fork-workflow-stage-auction' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-auction' role='tabpanel'>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{auctionOutcomeSelector}
						{renderSelectedOutcomeChildPoolNotice()}
						{selectedAuctionDetailsNotice}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title={forkAuctionCopy.truthAuctionStatus} variant='embedded'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>

						<SectionBlock title={forkAuctionCopy.startTruthAuction} variant='embedded'>
							<p className='detail'>{forkAuctionCopy.formatStartTruthAuctionDetail(AUCTIONED_BOND_ALLOWANCE_LABEL)}</p>
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

						{renderSubmitBidSection({ description: forkAuctionCopy.bidEscrowDetail })}
					</fieldset>
				)
			}
			if (selectedStage === 'settlement') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset aria-labelledby='fork-workflow-stage-settlement' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-settlement' role='tabpanel'>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{selectedAuctionDetailsNotice}
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
						{selectedAuctionDetailsNotice}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title={forkAuctionCopy.settlementStatus} variant='embedded'>
							{renderWorkflowMetricGrid(settlementStatusMetrics)}
						</SectionBlock>
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
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={forkAuctionCopy.forkTruthAuction}>
			{content}
		</RouteWorkflowPanel>
	)
}
