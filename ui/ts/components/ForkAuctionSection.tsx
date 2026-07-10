import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { ImportedForkSettlementSection } from './ImportedForkSettlementSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js'
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js'
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js'
import { WarningSurface } from './WarningSurface.js'
import { createActionAvailability } from '../lib/actionAvailability.js'
import { sameAddress } from '../lib/address.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL, AUCTION_TIME_SECONDS, getForkAuctionStageLabel, getForkAuctionStageView, getTimeRemaining } from '../lib/forkAuction.js'
import { buildTruthAuctionDepthPoints, estimateRepPurchased, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js'
import { formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { buildRouteHref, SECURITY_POOLS_ROUTE } from '../lib/routing.js'
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection, type ForkWorkflowSelectionStage } from '../lib/securityPoolWorkflow.js'
import { CURATED_TSX_STRINGS, UI_STRINGS, TSX_STRINGS } from '../lib/uiStrings.js'
import { writeSecurityPoolQueryParam, writeUniverseQueryParam } from '../lib/urlParams.js'
import { getVisualRatio } from '../lib/visualMetrics.js'
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js'
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js'
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
const UNKNOWN_VALUE = UI_STRINGS.common.metricUnavailablePlaceholder
const UNAVAILABLE_UNTIL_FORK = CURATED_TSX_STRINGS.forkAuctionSection.forkUnavailablePlaceholder

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
const FORK_WORKFLOW_STAGE_LABELS: Record<ForkWorkflowSelectionStage, string> = CURATED_TSX_STRINGS.forkAuctionSection.forkWorkflowStageLabels

function getForkWorkflowStageLabel(stage: ForkWorkflowSelectionStage) {
	return FORK_WORKFLOW_STAGE_LABELS[stage]
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
			return undefined
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

function renderTruthAuctionPriceValue(value: bigint | undefined, fallbackText: string = UNKNOWN_VALUE) {
	if (value === undefined) return fallbackText
	const formattedPrice = formatRoundedCurrencyBalance(value, 18, 4)
	const exactPrice = formatCurrencyInputBalance(value)
	return (
		<span className='truth-auction-price-value' title={TSX_STRINGS.componentsForkAuctionSection.copy001(exactPrice)}>
			{formattedPrice} {TSX_STRINGS.componentsForkAuctionSection.copy002}
		</span>
	)
}
function renderAddress(address: string | undefined) {
	if (address === undefined) return UNKNOWN_VALUE
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
					<strong>{TSX_STRINGS.componentsForkAuctionSection.copy003}</strong> {TSX_STRINGS.componentsForkAuctionSection.copy004}
					{AUCTIONED_BOND_ALLOWANCE_LABEL}
					{TSX_STRINGS.componentsForkAuctionSection.copy005}
				</p>
			</WarningSurface>
		)
	}

	if (showRefundOnlySettlementCopy) {
		return (
			<WarningSurface as='section' variant='compact'>
				<p className='detail'>
					<strong>{TSX_STRINGS.componentsForkAuctionSection.copy006}</strong> {TSX_STRINGS.componentsForkAuctionSection.copy007}
					{AUCTIONED_BOND_ALLOWANCE_LABEL}.
				</p>
			</WarningSurface>
		)
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>
					{TSX_STRINGS.componentsForkAuctionSection.copy008}
					{AUCTIONED_BOND_ALLOWANCE_LABEL}.
				</strong>{' '}
				{TSX_STRINGS.componentsForkAuctionSection.copy009}
				{AUCTIONED_BOND_ALLOWANCE_LABEL} {TSX_STRINGS.componentsForkAuctionSection.copy010}
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
			return TSX_STRINGS.componentsForkAuctionSection.copy011(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		if (selectedClaimCount > 0) {
			return TSX_STRINGS.componentsForkAuctionSection.copy012(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		return TSX_STRINGS.componentsForkAuctionSection.copy013(AUCTIONED_BOND_ALLOWANCE_LABEL)
	})()

	const refundDescription = estimatedEthRefunded > 0n ? TSX_STRINGS.componentsForkAuctionSection.copy014 : undefined
	let roundingDescription: string | undefined
	if (selectedClaimCount > 0) {
		if (estimatedRepClaimed === undefined) {
			roundingDescription = TSX_STRINGS.componentsForkAuctionSection.copy015
		} else {
			roundingDescription = TSX_STRINGS.componentsForkAuctionSection.copy016
		}
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>{TSX_STRINGS.componentsForkAuctionSection.copy017}</strong> {summaryDescription}
			</p>
			{renderWorkflowMetricGrid([
				{ label: TSX_STRINGS.componentsForkAuctionSection.copy018, value: selectedRowCount.toString() },
				{ label: TSX_STRINGS.componentsForkAuctionSection.copy019, value: selectedClaimCount.toString() },
				{ label: TSX_STRINGS.componentsForkAuctionSection.copy020, value: selectedRefundCount.toString() },
				{ label: TSX_STRINGS.componentsForkAuctionSection.copy021, value: estimatedRepClaimed === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRepClaimed} suffix={TSX_STRINGS.componentsForkAuctionSection.copy022} /> },
				{ label: TSX_STRINGS.componentsForkAuctionSection.copy023(AUCTIONED_BOND_ALLOWANCE_LABEL), value: estimatedAssignedBondAllowance === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedAssignedBondAllowance} suffix={TSX_STRINGS.componentsForkAuctionSection.copy024} /> },
				{ label: TSX_STRINGS.componentsForkAuctionSection.copy025, value: <CurrencyValue value={estimatedEthRefunded} suffix={TSX_STRINGS.componentsForkAuctionSection.copy026} /> },
			])}
			{roundingDescription === undefined ? undefined : <p className='detail'>{roundingDescription}</p>}
			{refundDescription === undefined ? undefined : <p className='detail'>{refundDescription}</p>}
		</WarningSurface>
	)
}

function getForkOnlyFallbackText(hasPreviewForkActivity: boolean) {
	return hasPreviewForkActivity ? UNKNOWN_VALUE : UNAVAILABLE_UNTIL_FORK
}

function getForkTypeLabel(forkOwnSecurityPool: boolean) {
	return forkOwnSecurityPool ? TSX_STRINGS.componentsForkAuctionSection.copy027 : TSX_STRINGS.componentsForkAuctionSection.copy028
}

function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }: { hasPreviewForkActivity: boolean; isSyntheticForkTriggerPreview: boolean; previewPool: ListedSecurityPool | undefined }) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	if (isSyntheticForkTriggerPreview) return UI_STRINGS.common.notChosenLabel
	return getForkTypeLabel(previewPool.forkOwnSecurityPool)
}
function getPreviewMigrationSummary(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	if (previewPool.truthAuctionStartedAt > 0n) return UNKNOWN_VALUE
	return UNKNOWN_VALUE
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
		<SectionBlock density='compact' headingLevel={4} title={TSX_STRINGS.componentsForkAuctionSection.copy029} variant='embedded'>
			{auctionOutcomeSelector}
			{renderSelectedOutcomeChildPoolNotice()}
			{childSecurityPools.length === 0 ? null : (
				<div className='fork-workflow-child-pool-list'>
					{childSecurityPools.map(pool => {
						const childPoolHref = buildRouteHref(SECURITY_POOLS_ROUTE, writeUniverseQueryParam(writeSecurityPoolQueryParam('', pool.securityPoolAddress), pool.universeId))
						return (
							<article className='fork-workflow-child-pool-card' key={pool.securityPoolAddress}>
								<div className='fork-workflow-child-pool-card-copy'>
									<strong>{pool.questionOutcome === 'none' ? TSX_STRINGS.componentsForkAuctionSection.copy030 : getReportingOutcomeLabel(pool.questionOutcome)}</strong>
									<span>{pool.systemState === 'operational' ? TSX_STRINGS.componentsForkAuctionSection.copy031 : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedRep: pool.migratedRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt }))}</span>
								</div>
								<div className='fork-workflow-child-pool-card-meta'>
									<span>
										<AddressValue address={pool.securityPoolAddress} />
									</span>
									<a href={childPoolHref}>{TSX_STRINGS.componentsForkAuctionSection.copy032}</a>
								</div>
							</article>
						)
					})}
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
	if (migrationEndsAt === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy033
	if (currentTimestamp === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy034
	if (currentTimestamp <= migrationEndsAt) return TSX_STRINGS.componentsForkAuctionSection.copy035
	return undefined
}

function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy036
	if (currentTimestamp === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy037
	if (currentTimestamp > migrationEndsAt) return TSX_STRINGS.componentsForkAuctionSection.copy038
	return undefined
}

function getTruthAuctionBypassReason({ migratedRep, parentCollateralAmount, auctionableRepAtFork }: { migratedRep: bigint; parentCollateralAmount: bigint | undefined; auctionableRepAtFork: bigint | undefined }) {
	if (parentCollateralAmount === 0n) return TSX_STRINGS.componentsForkAuctionSection.copy039
	if (auctionableRepAtFork === undefined) return undefined
	if (auctionableRepAtFork === 0n) return TSX_STRINGS.componentsForkAuctionSection.copy040
	if (migratedRep >= auctionableRepAtFork) return TSX_STRINGS.componentsForkAuctionSection.copy041
	return undefined
}

function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy042
	if (truthAuction.finalized) return TSX_STRINGS.componentsForkAuctionSection.copy043
	if (truthAuctionEndsAt === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy044
	if (currentTimestamp === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy045
	if (currentTimestamp <= truthAuctionEndsAt) return TSX_STRINGS.componentsForkAuctionSection.copy046
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
			return { label: TSX_STRINGS.componentsForkAuctionSection.copy047, tone: 'pending' }
		}
		return { label: TSX_STRINGS.componentsForkAuctionSection.copy048, tone: 'muted' }
	}
	if (!truthAuction.finalized) {
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) {
			return { label: TSX_STRINGS.componentsForkAuctionSection.copy049, tone: 'pending' }
		}
		return { label: TSX_STRINGS.componentsForkAuctionSection.copy050, tone: 'pending' }
	}
	if (truthAuction.underfunded) return { label: TSX_STRINGS.componentsForkAuctionSection.copy051, tone: 'blocked' }
	if (truthAuction.hitCap) return { label: TSX_STRINGS.componentsForkAuctionSection.copy052, tone: 'ok' }
	return { label: TSX_STRINGS.componentsForkAuctionSection.copy053, tone: 'muted' }
}

function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }): MigrationStateBadge {
	if (migrationEndsAt === undefined) return { label: TSX_STRINGS.componentsForkAuctionSection.copy054, tone: 'muted' }
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: TSX_STRINGS.componentsForkAuctionSection.copy055, tone: 'ok' }
	if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt) return { label: TSX_STRINGS.componentsForkAuctionSection.copy056, tone: 'ok' }
	return { label: TSX_STRINGS.componentsForkAuctionSection.copy057, tone: 'pending' }
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
	const hasUnresolvedMigrationState = isMigrationRequired || isMigrationExpired
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

		const securityPoolSearch = writeSecurityPoolQueryParam('', selectedAuctionChildPool.securityPoolAddress)
		const securityPoolHref = buildRouteHref(SECURITY_POOLS_ROUTE, writeUniverseQueryParam(securityPoolSearch, selectedAuctionChildPool.universeId))
		return (
			<a className='fork-workflow-outcome-link' href={securityPoolHref}>
				{TSX_STRINGS.componentsForkAuctionSection.copy058}
			</a>
		)
	}

	const migrationBalancesContent = (() => {
		if (accountState.address === undefined) return <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy059}</p>
		if (connectedWalletVaultSummary === undefined) return <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy060}</p>
		const selectedOutcomeMigrationVaultBalanceContent = (() => {
			if (selectedOutcomeMigrationChildPool === undefined) return undefined

			return (
				<>
					<p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy061}</p>
					{renderWorkflowMetricGrid([
						{ label: TSX_STRINGS.componentsForkAuctionSection.copy062, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.repDepositShare ?? 0n} suffix={TSX_STRINGS.componentsForkAuctionSection.copy063} /> },
						{ label: TSX_STRINGS.componentsForkAuctionSection.copy064, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.securityBondAllowance ?? 0n} suffix={TSX_STRINGS.componentsForkAuctionSection.copy065} /> },
					])}
				</>
			)
		})()

		return (
			<>
				{renderWorkflowMetricGrid([
					{ label: TSX_STRINGS.componentsForkAuctionSection.copy066, value: <CurrencyValue value={connectedWalletVaultSummary.repDepositShare} suffix={TSX_STRINGS.componentsForkAuctionSection.copy067} /> },
					{ label: TSX_STRINGS.componentsForkAuctionSection.copy068, value: <CurrencyValue value={connectedWalletVaultSummary.securityBondAllowance} suffix={TSX_STRINGS.componentsForkAuctionSection.copy069} /> },
					{ label: TSX_STRINGS.componentsForkAuctionSection.copy070, value: <CurrencyValue value={effectiveEscrowedRepInEscalationGame ?? 0n} suffix={TSX_STRINGS.componentsForkAuctionSection.copy071} /> },
				])}
				<div className='form-grid fork-workflow-outcome-selector'>
					<label className='field'>
						<span>{TSX_STRINGS.componentsForkAuctionSection.copy072}</span>
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
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? TSX_STRINGS.componentsForkAuctionSection.copy073 : undefined
	const migrateEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? TSX_STRINGS.componentsForkAuctionSection.copy074 : undefined
	const totalUnresolvedMigrationDepositCount = unresolvedMigrationSides.reduce((count, side) => count + side.userDeposits.length, 0)
	const hasUnresolvedMigrationDeposits = totalUnresolvedMigrationDepositCount > 0
	const importedForkSettlementSides = activeReportingDetails?.sides.filter(side => side.importedUserDeposits.length > 0) ?? []
	const hasImportedForkSettlementDeposits = importedForkSettlementSides.length > 0
	const importedForkSettlementResolved = isPoolQuestionFinalized(activeReportingDetails)
	const childSecurityPools = securityPoolAddress === undefined ? [] : securityPools.filter(pool => sameAddress(pool.parent, securityPoolAddress))
	const enteredBidPreview = getTruthAuctionBidPreview(forkAuctionForm.submitBidPrice)
	const enteredBidPrice = enteredBidPreview?.price
	const enteredBidTick = enteredBidPreview?.tick
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, enteredBidPrice)
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const truthAuctionFallback = (() => {
		if (auctionTruthAuctionStatus !== undefined) return UNKNOWN_VALUE
		if (hasSelectedAuctionChildPool) return UNKNOWN_VALUE
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
				fallbackText: TSX_STRINGS.componentsForkAuctionSection.copy075,
			})
		}
		if (isStartTruthAuctionInProgress) return TSX_STRINGS.componentsForkAuctionSection.copy076
		if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
			if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n) return TSX_STRINGS.componentsForkAuctionSection.copy077(formatDuration(startTruthAuctionCountdown))
			return TSX_STRINGS.componentsForkAuctionSection.copy078
		}
		return TSX_STRINGS.componentsForkAuctionSection.copy079
	})()
	const endsDisplay = (() => {
		if (auctionWindow === undefined) return isStartTruthAuctionInProgress ? TSX_STRINGS.componentsForkAuctionSection.copy080 : TSX_STRINGS.componentsForkAuctionSection.copy081
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
				<CurrencyValue value={displayedEthRaised} suffix={TSX_STRINGS.componentsForkAuctionSection.copy082} /> / <CurrencyValue value={truthAuctionStatus.ethRaiseCap} suffix={TSX_STRINGS.componentsForkAuctionSection.copy083} />
			</Fragment>
		)
	const clearingPriceDisplay = truthAuctionStatus === undefined ? truthAuctionFallback : renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)
	const settlementAvailableDisplay = (() => {
		if (!hasSelectedAuctionChildPool) return UNAVAILABLE_UNTIL_FORK
		if (selectedAuctionContext?.claimingAvailable) return TSX_STRINGS.componentsForkAuctionSection.copy084

		return TSX_STRINGS.componentsForkAuctionSection.copy085
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
	const settlementActionLabel = TSX_STRINGS.componentsForkAuctionSection.copy086
	const settlementActionDescription = (() => {
		if (settlementSelectionMode === 'claim') return TSX_STRINGS.componentsForkAuctionSection.copy087(AUCTIONED_BOND_ALLOWANCE_LABEL)
		if (settlementSelectionMode === 'refund') {
			if (truthAuctionStatus?.finalized === true) return TSX_STRINGS.componentsForkAuctionSection.copy088(AUCTIONED_BOND_ALLOWANCE_LABEL)
			return TSX_STRINGS.componentsForkAuctionSection.copy089(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		return TSX_STRINGS.componentsForkAuctionSection.copy090(AUCTIONED_BOND_ALLOWANCE_LABEL)
	})()
	const settlementActionPendingLabel = TSX_STRINGS.componentsForkAuctionSection.copy091
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
		if (accountState.address === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy092
		if (!isMainnet) return undefined

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
					<strong>{TSX_STRINGS.componentsForkAuctionSection.copy093}</strong> {truthAuctionStatus.finalized ? TSX_STRINGS.componentsForkAuctionSection.copy094(AUCTIONED_BOND_ALLOWANCE_LABEL) : TSX_STRINGS.componentsForkAuctionSection.copy095}{' '}
					{truthAuctionEndsAt === undefined ? undefined : (
						<Fragment>
							{TSX_STRINGS.componentsForkAuctionSection.copy096}
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
							idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy097,
							onClick: onFinalizeTruthAuctionForSelectedAuction,
							pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy098,
						})}
					</div>
				)}
			</div>
		)
	})()
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return TSX_STRINGS.componentsForkAuctionSection.copy099(formatDuration(startTruthAuctionCountdown))
	})()
	const isVaultMigrationComplete = hasCompletedVaultMigration || (connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance)
	const truthAuctionBypassReason = getTruthAuctionBypassReason({
		migratedRep: selectedAuctionContext?.migratedRep ?? selectedAuctionChildPool?.migratedRep ?? 0n,
		parentCollateralAmount: forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount,
		auctionableRepAtFork: forkAuctionDetails?.auctionableRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (hasStartedTruthAuction) return TSX_STRINGS.componentsForkAuctionSection.copy100
		if (isStartTruthAuctionInProgress) return TSX_STRINGS.componentsForkAuctionSection.copy101
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
		if (loadingReportingDetails) return TSX_STRINGS.componentsForkAuctionSection.copy102
		if (reportingDetails?.status !== 'active') return TSX_STRINGS.componentsForkAuctionSection.copy103
		if (isMigrationRequired) return TSX_STRINGS.componentsForkAuctionSection.copy104
		if (isMigrationExpired) return TSX_STRINGS.componentsForkAuctionSection.copy105
		if (selectedEscalationMigrationDeposits.length === 0) return TSX_STRINGS.componentsForkAuctionSection.copy106(selectedOutcomeLabel)
		if (selectedEscalationMigrationDepositIndexes.length > 0) return undefined
		return TSX_STRINGS.componentsForkAuctionSection.copy107
	})()
	const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrateUnresolvedEscalationGuardMessage = (() => {
		if (migrationWindowClosedGuardMessage !== undefined) return migrationWindowClosedGuardMessage
		if (!isMigrationRequired) return TSX_STRINGS.componentsForkAuctionSection.copy108
		if (loadingReportingDetails) return TSX_STRINGS.componentsForkAuctionSection.copy109
		if (activeReportingDetails === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy110
		if (!hasUnresolvedMigrationDeposits) return TSX_STRINGS.componentsForkAuctionSection.copy111
		return undefined
	})()
	const migratePoolToUniverseGuardMessage = (() => {
		if (loadingSelectedOutcomeMigrationSeedStatus) return TSX_STRINGS.componentsForkAuctionSection.copy112(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus?.seeded) return TSX_STRINGS.componentsForkAuctionSection.copy113(selectedOutcomeLabel)
		return undefined
	})()
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (loadingSelectedOutcomeMigrationSeedStatus) return TSX_STRINGS.componentsForkAuctionSection.copy114(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return TSX_STRINGS.componentsForkAuctionSection.copy115(selectedOutcomeLabel)
	})()
	const migrateVaultCompletedMessage = isVaultMigrationComplete ? TSX_STRINGS.componentsForkAuctionSection.copy116 : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationPending ? TSX_STRINGS.componentsForkAuctionSection.copy117 : undefined
	const migrateVaultGuardMessage = isMigrationRequired ? TSX_STRINGS.componentsForkAuctionSection.copy118 : (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage)
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
		const disabledReason = !isMainnet ? undefined : (interactionDisabledReason ?? resolvedAvailability.reason)
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
				<p className='detail'>{CURATED_TSX_STRINGS.forkAuctionSection.missingChildSecurityPoolDetail(selectedOutcomeLabel)}</p>
			</div>
		)
	}
	const renderSubmitBidSection = ({
		description,
		density = 'balanced',
		headingLevel = 3,
		title = TSX_STRINGS.componentsForkAuctionSection.copy121,
		variant = 'embedded',
	}: {
		description?: ComponentChildren
		density?: 'balanced' | 'compact'
		headingLevel?: 3 | 4
		title?: ComponentChildren
		variant?: 'default' | 'embedded'
	}) => (
		<SectionBlock {...(description === undefined ? {} : { description })} density={density} headingLevel={headingLevel} title={title} variant={variant}>
			<div className='form-grid'>
				{submitBidPreviewTickSummary === undefined ? undefined : (
					<p className='detail'>
						{TSX_STRINGS.componentsForkAuctionSection.copy122}
						{renderTruthAuctionPriceValue(submitBidPreviewTickSummary.price)}
					</p>
				)}
				<div className='field-row'>
					<label className='field'>
						<span>{TSX_STRINGS.componentsForkAuctionSection.copy123}</span>
						<FormInput value={forkAuctionForm.submitBidPrice} onInput={event => onForkAuctionFormChange({ submitBidPrice: event.currentTarget.value })} />
					</label>
					<label className='field'>
						<span>{TSX_STRINGS.componentsForkAuctionSection.copy124}</span>
						<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
					</label>
				</div>
				{enteredBidPrice === undefined ? undefined : (
					<p className='detail'>
						{TSX_STRINGS.componentsForkAuctionSection.copy125}
						{estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix={TSX_STRINGS.componentsForkAuctionSection.copy126} />} {TSX_STRINGS.componentsForkAuctionSection.copy127}
					</p>
				)}
				{renderTruthAuctionDebtNotice('bid')}
				<div className='actions'>
					{renderStageActionButton({
						action: 'submitBid',
						availability: createActionAvailability(submitBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy129,
						onClick: onSubmitBidForSelectedAuction,
						pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy130,
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
	const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionableRepAtFork} suffix={TSX_STRINGS.componentsForkAuctionSection.copy132} />
	const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, UI_STRINGS.common.repLabel, UNKNOWN_VALUE)
	const migrationCollateralDisplay = renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, UI_STRINGS.common.ethSuffix, UNKNOWN_VALUE)
	const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? CURATED_TSX_STRINGS.forkAuctionSection.notStartedLabel : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={migrationStartedAt} />
	const migrationEndsDisplay = (() => {
		if (forkAuctionDetails === undefined) return migrationSummaryText
		if (hasStartedSelectedTruthAuctionTimeline && effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) {
			return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={effectiveTruthAuctionStartedAt} />
		}
		if (forkAuctionDetails.migrationEndsAt === undefined) return TSX_STRINGS.componentsForkAuctionSection.copy133

		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
	})()
	const truthAuctionStateBadgeElement = <Badge tone={truthAuctionStateBadge.tone}>{truthAuctionStateBadge.label}</Badge>
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy134, value: renderAddress(auctionTruthAuctionAddress) },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy135, value: startedDisplay },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy136, value: endsDisplay },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy137, value: ethRaisedCapDisplay },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy138, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix={TSX_STRINGS.componentsForkAuctionSection.copy139} /> },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy140, value: clearingPriceDisplay },
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={TSX_STRINGS.componentsForkAuctionSection.copy141} /> },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy142, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix={TSX_STRINGS.componentsForkAuctionSection.copy143} /> },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy144, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix={TSX_STRINGS.componentsForkAuctionSection.copy145} /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={TSX_STRINGS.componentsForkAuctionSection.copy146} /> },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy147, value: settlementAvailableDisplay },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy148, value: ethRaisedCapDisplay },
		{ label: TSX_STRINGS.componentsForkAuctionSection.copy149, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix={TSX_STRINGS.componentsForkAuctionSection.copy150} /> },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid fork-workflow-outcome-selector'>
			<label className='field'>
				<span>{TSX_STRINGS.componentsForkAuctionSection.copy151}</span>
				<div className='fork-workflow-outcome-selector-row'>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					{renderSelectedOutcomeChildPoolLink()}
				</div>
			</label>
		</div>
	)
	const selectedAuctionDetailsNotice = (() => {
		if (!hasSelectedAuctionChildPool || selectedStage === 'migration') return undefined
		if (loadingSelectedAuctionDetails)
			return (
				<p className='detail'>
					{TSX_STRINGS.componentsForkAuctionSection.copy152}
					{selectedAuctionLabel} {TSX_STRINGS.componentsForkAuctionSection.copy153}
				</p>
			)
		if (selectedAuctionContextError === undefined) return undefined
		return <p className='detail'>{selectedAuctionContextError}</p>
	})()
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedBondAllowanceDisplay={selectedAuctionContext === undefined ? UNKNOWN_VALUE : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={TSX_STRINGS.componentsForkAuctionSection.copy154} />}
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
		<SectionBlock badge={migrationStatusBadge} className='fork-workflow-summary-card migration-summary-card' title={TSX_STRINGS.componentsForkAuctionSection.copy155}>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary migration-summary-primary'>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{TSX_STRINGS.componentsForkAuctionSection.copy156}</span>
							<strong>{migrationRepAtForkDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{TSX_STRINGS.componentsForkAuctionSection.copy157}</span>
							<strong>{migrationRepDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{TSX_STRINGS.componentsForkAuctionSection.copy158}</span>
							<strong>{migrationCollateralDisplay}</strong>
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={TSX_STRINGS.componentsForkAuctionSection.copy159}>{migrationStartedDisplay}</MetricField>
					<MetricField label={TSX_STRINGS.componentsForkAuctionSection.copy160}>{migrationEndsDisplay}</MetricField>
					<MetricField label={TSX_STRINGS.componentsForkAuctionSection.copy161}>{resolvedForkTypeLabel}</MetricField>
				</div>
			</div>
			{forkAuctionDetails?.ownForkRepBuckets === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={TSX_STRINGS.componentsForkAuctionSection.copy162}>
					<div className='fork-workflow-summary-metrics'>
						<MetricField label={TSX_STRINGS.componentsForkAuctionSection.copy163}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.vaultRepAtFork} suffix={TSX_STRINGS.componentsForkAuctionSection.copy164} />
						</MetricField>
						<MetricField label={TSX_STRINGS.componentsForkAuctionSection.copy165}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.unallocatedEscrowChildRep} suffix={TSX_STRINGS.componentsForkAuctionSection.copy166} />
						</MetricField>
						<MetricField label={TSX_STRINGS.componentsForkAuctionSection.copy167}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtFork} suffix={TSX_STRINGS.componentsForkAuctionSection.copy168} />
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
						idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy169(sideLabel),
						onClick: () => onWithdrawForkedEscalationSubmit(outcome),
						pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy170,
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
			<div aria-label={TSX_STRINGS.componentsForkAuctionSection.copy171} className='fork-workflow-stage-nav' role='tablist'>
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
									{selectedStage === stage ? <span className='fork-workflow-stage-indicator'>{TSX_STRINGS.componentsForkAuctionSection.copy172}</span> : undefined}
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
					<SectionBlock title={TSX_STRINGS.componentsForkAuctionSection.copy173} variant='embedded'>
						{hasTriggeredFork ? (
							renderWorkflowMetricGrid([
								{
									label: TSX_STRINGS.componentsForkAuctionSection.copy174,
									value: CURATED_TSX_STRINGS.forkAuctionSection.systemIsForkingLabel,
								},
								{
									label: TSX_STRINGS.componentsForkAuctionSection.copy175,
									value: <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={universeForkTime} />,
								},
							])
						) : (
							<p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy176}</p>
						)}
					</SectionBlock>
				</fieldset>
			)
		if (selectedStage === 'migration')
			return (
				<fieldset aria-labelledby='fork-workflow-stage-migration' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-migration' role='tabpanel'>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
					{migrationSummaryCard}

					<SectionBlock title={TSX_STRINGS.componentsForkAuctionSection.copy177} variant='embedded' description={TSX_STRINGS.componentsForkAuctionSection.copy178}>
						{migrationBalancesContent}
						{accountState.address === undefined ? undefined : (
							<>
								{hasUnresolvedMigrationState ? (
									<SectionBlock density='compact' headingLevel={4} title={TSX_STRINGS.componentsForkAuctionSection.copy179} variant='embedded'>
										<p className='detail'>{isMigrationExpired ? TSX_STRINGS.componentsForkAuctionSection.copy180 : TSX_STRINGS.componentsForkAuctionSection.copy181}</p>
										{loadingReportingDetails ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy182}</p> : undefined}
										{loadingReportingDetails || activeReportingDetails !== undefined ? undefined : <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy183}</p>}
										{activeReportingDetails !== undefined && !hasUnresolvedMigrationDeposits ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy184}</p> : undefined}
										<p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy185}</p>
										{activeReportingDetails === undefined
											? undefined
											: unresolvedMigrationSides.map(side => (
													<div className='field' key={side.key}>
														<span>{side.label}</span>
														{side.userDeposits.length === 0 ? (
															<p className='detail'>
																{TSX_STRINGS.componentsForkAuctionSection.copy186}
																{side.label.toLowerCase()} {TSX_STRINGS.componentsForkAuctionSection.copy187}
															</p>
														) : (
															<EscalationDepositSelectionList
																disabled
																items={side.userDeposits.map(deposit => ({
																	deposit,
																	details: [
																		<>
																			{TSX_STRINGS.componentsForkAuctionSection.copy188}
																			<CurrencyValue value={deposit.amount} suffix={TSX_STRINGS.componentsForkAuctionSection.copy189} />
																		</>,
																		TSX_STRINGS.componentsForkAuctionSection.copy190,
																		<>
																			{TSX_STRINGS.componentsForkAuctionSection.copy191}
																			<CurrencyValue value={deposit.cumulativeAmount} suffix={TSX_STRINGS.componentsForkAuctionSection.copy192} />
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
													idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy193(selectedOutcomeLabel),
													onClick: onMigrateUnresolvedEscalationSubmit,
													pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy194,
													tone: 'primary',
												})}
											</div>
										)}
									</SectionBlock>
								) : (
									<SectionBlock density='compact' headingLevel={4} title={TSX_STRINGS.componentsForkAuctionSection.copy195} variant='embedded'>
										<p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy196}</p>
										{connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy197}</p> : undefined}
										{loadingReportingDetails ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy198}</p> : undefined}
										{loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy199}</p>}
										{showSelectedEscalationMigrationDeposits && !hasSelectedEscalationMigrationDeposits ? (
											<p className='detail'>
												{TSX_STRINGS.componentsForkAuctionSection.copy200}
												{selectedOutcomeLabel} {TSX_STRINGS.componentsForkAuctionSection.copy201}
											</p>
										) : undefined}
										{showSelectedEscalationMigrationDeposits && hasSelectedEscalationMigrationDeposits ? (
											<div className='field'>
												<span>{TSX_STRINGS.componentsForkAuctionSection.copy202}</span>
												<EscalationDepositSelectionList
													disabled={forkAuctionActiveAction === 'migrateEscalationDeposits'}
													items={selectedEscalationMigrationDeposits.map(deposit => {
														const claimAmount = getEscalationDepositClaimAmount(reportingDetails, forkAuctionForm.selectedOutcome, deposit)
														return {
															deposit,
															details: [
																<>
																	{TSX_STRINGS.componentsForkAuctionSection.copy203}
																	<CurrencyValue value={deposit.amount} suffix={TSX_STRINGS.componentsForkAuctionSection.copy204} />
																</>,
																claimAmount === undefined ? (
																	TSX_STRINGS.componentsForkAuctionSection.copy205
																) : (
																	<>
																		{TSX_STRINGS.componentsForkAuctionSection.copy206}
																		<CurrencyValue value={claimAmount} suffix={TSX_STRINGS.componentsForkAuctionSection.copy207} />
																	</>
																),
																TSX_STRINGS.componentsForkAuctionSection.copy208,
																<>
																	{TSX_STRINGS.componentsForkAuctionSection.copy209}
																	<CurrencyValue value={deposit.cumulativeAmount} suffix={TSX_STRINGS.componentsForkAuctionSection.copy210} />
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
												idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy211(selectedOutcomeLabel),
												onClick: onMigrateSelectedEscalationDeposits,
												pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy212,
											})}
										</div>
									</SectionBlock>
								)}
								<SectionBlock density='compact' headingLevel={4} title={TSX_STRINGS.componentsForkAuctionSection.copy213} variant='embedded'>
									<p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy214}</p>
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy215}</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalance > 0n ? TSX_STRINGS.componentsForkAuctionSection.copy216 : TSX_STRINGS.componentsForkAuctionSection.copy217}</p>
									)}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateRepToZoltar',
											availability: createActionAvailability(migratePoolToUniverseGuardMessage),
											idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy218(selectedOutcomeLabel),
											onClick: onMigrateSelectedOutcomeRepToZoltar,
											pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy219,
										})}
									</div>
								</SectionBlock>
								<SectionBlock density='compact' headingLevel={4} title={TSX_STRINGS.componentsForkAuctionSection.copy220} variant='embedded'>
									<p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy221}</p>
									{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy222}</p> : undefined}
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy223}</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateVault',
											availability: createActionAvailability(migrateVaultGuardMessage),
											idleLabel: TSX_STRINGS.componentsForkAuctionSection.copy224(selectedOutcomeLabel),
											onClick: onMigrateVaultSubmit,
											pendingLabel: TSX_STRINGS.componentsForkAuctionSection.copy225,
											tone: 'primary',
										})}
									</div>
									{isVaultMigrationComplete ? <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy226}</p> : undefined}
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
							{truthAuctionMarketViewSection}
							{auctionWideBidsSection}
							{renderSubmitBidSection({
								description: TSX_STRINGS.componentsForkAuctionSection.copy227,
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
						<SectionBlock badge={truthAuctionStateBadgeElement} title={TSX_STRINGS.componentsForkAuctionSection.copy228} variant='embedded'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>

						<SectionBlock title={TSX_STRINGS.componentsForkAuctionSection.copy229} variant='embedded'>
							<p className='detail'>
								{TSX_STRINGS.componentsForkAuctionSection.copy230}
								{AUCTIONED_BOND_ALLOWANCE_LABEL}
								{TSX_STRINGS.componentsForkAuctionSection.copy231}
							</p>
							{startTruthAuctionReadyInText === undefined ? undefined : <p className='detail'>{startTruthAuctionReadyInText}</p>}
							{truthAuctionBypassReason === undefined ? undefined : <p className='detail'>{truthAuctionBypassReason}</p>}
							<div className='actions'>
								{renderStageActionButton({
									action: 'startTruthAuction',
									availability: createActionAvailability(!hasSelectedAuctionChildPool ? UI_STRINGS.forkAuctionSection.childUniverseNotCreatedForOutcomeDetail(selectedAuctionLabel) : startTruthAuctionAvailabilityMessage),
									forceEnabled: hasSelectedAuctionChildPool,
									idleLabel: truthAuctionBypassReason === undefined ? TSX_STRINGS.componentsForkAuctionSection.copy232 : TSX_STRINGS.componentsForkAuctionSection.copy233,
									onClick: onStartTruthAuctionSubmit,
									pendingLabel: truthAuctionBypassReason === undefined ? TSX_STRINGS.componentsForkAuctionSection.copy234 : TSX_STRINGS.componentsForkAuctionSection.copy235,
									tone: 'primary',
								})}
							</div>
						</SectionBlock>

						{renderSubmitBidSection({ description: TSX_STRINGS.componentsForkAuctionSection.copy236 })}
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
						<SectionBlock badge={truthAuctionStateBadgeElement} title={TSX_STRINGS.componentsForkAuctionSection.copy237} variant='embedded'>
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
					{!showSecurityPoolAddressInput ? undefined : <LookupFieldRow label={TSX_STRINGS.componentsForkAuctionSection.copy238} value={forkAuctionForm.securityPoolAddress} onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })} placeholder={TSX_STRINGS.componentsForkAuctionSection.copy239} />}
					{hasLoadedPoolContext ? undefined : <p className='detail'>{TSX_STRINGS.componentsForkAuctionSection.copy240}</p>}
				</div>
			)}
			{forkWorkflowStageNavigator}
			{hasLoadedPoolContext ? stagePanel : undefined}

			<ErrorNotice message={forkAuctionError} />
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={TSX_STRINGS.componentsForkAuctionSection.copy241}>
			{content}
		</RouteWorkflowPanel>
	)
}
