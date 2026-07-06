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
import type { ActionSafetyId } from '../lib/actionSafety/ids.js'
import { getForkAuctionActionSafetyId } from '../lib/actionSafety/ids.js'
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
import { writeSecurityPoolQueryParam, writeUniverseQueryParam } from '../lib/urlParams.js'
import { getVisualRatio } from '../lib/visualMetrics.js'
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js'
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js'
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = '-'

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
const FORK_WORKFLOW_STAGE_LABELS: Record<ForkWorkflowSelectionStage, string> = {
	'fork-triggered': 'Fork Triggered',
	migration: 'Migration',
	auction: 'Truth Auction',
	settlement: 'Settlement',
}

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
		<span className='truth-auction-price-value' title={`${exactPrice} ETH / REP`}>
			{formattedPrice} ETH / REP
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
					<strong>Winning bids buy more than REP.</strong> When you later claim a filled bid, the vault also receives a pro-rata share of the {AUCTIONED_BOND_ALLOWANCE_LABEL}. That allowance is the remaining open-interest debt being assigned to auction participants.
				</p>
			</WarningSurface>
		)
	}

	if (showRefundOnlySettlementCopy) {
		return (
			<WarningSurface as='section' variant='compact'>
				<p className='detail'>
					<strong>Refund-only settlement returns locked ETH.</strong> Finalized refund-only settlement uses the child-pool settlement path to unlock ETH, and it does not assign child-pool REP or {AUCTIONED_BOND_ALLOWANCE_LABEL}.
				</p>
			</WarningSurface>
		)
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>Winning claims add REP and {AUCTIONED_BOND_ALLOWANCE_LABEL}.</strong> Claiming a winning bid adds child-pool REP and a pro-rata share of the {AUCTIONED_BOND_ALLOWANCE_LABEL} to the bidder vault. That allowance is the remaining open-interest debt being assigned during settlement. Refund-only bids just
				return locked ETH.
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
			return `Winning rows receive estimated child-pool REP plus estimated ${AUCTIONED_BOND_ALLOWANCE_LABEL}, while refund rows return locked ETH.`
		}
		if (selectedClaimCount > 0) {
			return `Winning rows receive estimated child-pool REP plus estimated ${AUCTIONED_BOND_ALLOWANCE_LABEL}.`
		}
		return `Refund-only settlement returns locked ETH and does not assign ${AUCTIONED_BOND_ALLOWANCE_LABEL}.`
	})()

	const refundDescription = estimatedEthRefunded > 0n ? 'Estimated ETH refunded includes fully losing bids and any unfilled remainder on partially cleared winning bids.' : undefined
	let roundingDescription: string | undefined
	if (selectedClaimCount > 0) {
		if (estimatedRepClaimed === undefined) {
			roundingDescription = 'Claim preview is unavailable for underfunded winning bids because the required per-tick ETH denominator is not exposed in current UI data.'
		} else {
			roundingDescription = 'These are pre-transaction estimates. Final on-chain settlement can differ slightly because claim math is rounded on-chain.'
		}
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>Selected-bid settlement preview.</strong> {summaryDescription}
			</p>
			{renderWorkflowMetricGrid([
				{ label: 'Selected Bids', value: selectedRowCount.toString() },
				{ label: 'Selected Winning Bids', value: selectedClaimCount.toString() },
				{ label: 'Selected Refund Rows', value: selectedRefundCount.toString() },
				{ label: 'Estimated REP Claimed', value: estimatedRepClaimed === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRepClaimed} suffix='REP' /> },
				{ label: `Estimated ${AUCTIONED_BOND_ALLOWANCE_LABEL}`, value: estimatedAssignedBondAllowance === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedAssignedBondAllowance} suffix='ETH' /> },
				{ label: 'Estimated ETH Refunded', value: <CurrencyValue value={estimatedEthRefunded} suffix='ETH' /> },
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
	return forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'
}

function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }: { hasPreviewForkActivity: boolean; isSyntheticForkTriggerPreview: boolean; previewPool: ListedSecurityPool | undefined }) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	if (isSyntheticForkTriggerPreview) return 'Not chosen yet'
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
		<SectionBlock density='compact' headingLevel={4} title='Child Security Pools' variant='embedded'>
			{auctionOutcomeSelector}
			{renderSelectedOutcomeChildPoolNotice()}
			{childSecurityPools.length === 0 ? null : (
				<div className='fork-workflow-child-pool-list'>
					{childSecurityPools.map(pool => {
						const childPoolHref = buildRouteHref(SECURITY_POOLS_ROUTE, writeUniverseQueryParam(writeSecurityPoolQueryParam('', pool.securityPoolAddress), pool.universeId))
						return (
							<article className='fork-workflow-child-pool-card' key={pool.securityPoolAddress}>
								<div className='fork-workflow-child-pool-card-copy'>
									<strong>{pool.questionOutcome === 'none' ? 'Pending outcome' : getReportingOutcomeLabel(pool.questionOutcome)}</strong>
									<span>{pool.systemState === 'operational' ? 'Operational' : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedRep: pool.migratedRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt }))}</span>
								</div>
								<div className='fork-workflow-child-pool-card-meta'>
									<span>
										<AddressValue address={pool.securityPoolAddress} />
									</span>
									<a href={childPoolHref}>Open security pool</a>
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
	if (migrationEndsAt === undefined) return 'Migration timing is unavailable.'
	if (currentTimestamp === undefined) return 'Loading current chain time.'
	if (currentTimestamp <= migrationEndsAt) return 'Migration is still active. Truth auction can start once migration ends.'
	return undefined
}

function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return 'Migration timing is unavailable.'
	if (currentTimestamp === undefined) return 'Loading current chain time.'
	if (currentTimestamp > migrationEndsAt) return 'Migration window has closed for this parent pool.'
	return undefined
}

function getTruthAuctionBypassReason({ migratedRep, parentCollateralAmount, auctionableRepAtFork }: { migratedRep: bigint; parentCollateralAmount: bigint | undefined; auctionableRepAtFork: bigint | undefined }) {
	if (parentCollateralAmount === 0n) return 'No parent collateral remains to auction, so this step immediately bypasses bidding and finalizes the child pool.'
	if (auctionableRepAtFork === undefined) return undefined
	if (auctionableRepAtFork === 0n) return 'No REP was present at fork, so no truth auction is needed for this child universe.'
	if (migratedRep >= auctionableRepAtFork) return 'This child universe already has all REP migrated from the parent pool, so no truth auction is needed.'
	return undefined
}

function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return 'Load the truth auction before finalizing.'
	if (truthAuction.finalized) return 'Truth auction is already finalized.'
	if (truthAuctionEndsAt === undefined) return 'Truth auction end time is unavailable.'
	if (currentTimestamp === undefined) return 'Loading current chain time.'
	if (currentTimestamp <= truthAuctionEndsAt) return 'Truth auction is still ongoing.'
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
			return { label: 'Pending', tone: 'pending' }
		}
		return { label: 'Inactive', tone: 'muted' }
	}
	if (!truthAuction.finalized) {
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) {
			return { label: 'Clearing', tone: 'pending' }
		}
		return { label: 'Open', tone: 'pending' }
	}
	if (truthAuction.underfunded) return { label: 'Shortfall', tone: 'blocked' }
	if (truthAuction.hitCap) return { label: 'Settled', tone: 'ok' }
	return { label: 'Unfilled', tone: 'muted' }
}

function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }): MigrationStateBadge {
	if (migrationEndsAt === undefined) return { label: 'Not Started', tone: 'muted' }
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: 'Closed', tone: 'ok' }
	if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt) return { label: 'Closed', tone: 'ok' }
	return { label: 'Open', tone: 'pending' }
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
				Child pool
			</a>
		)
	}

	const migrationBalancesContent = (() => {
		if (accountState.address === undefined) return <p className='detail'>Connect wallet to inspect your parent-pool balances.</p>
		if (connectedWalletVaultSummary === undefined) return <p className='detail'>Parent-pool vault balances are unavailable for the connected wallet. You can still use the migration actions below if this wallet has parent-pool state to move.</p>
		const selectedOutcomeMigrationVaultBalanceContent = (() => {
			if (selectedOutcomeMigrationChildPool === undefined) return undefined

			return (
				<>
					<p className='detail'>Migrated balances for this outcome:</p>
					{renderWorkflowMetricGrid([
						{ label: 'Selected Outcome REP Collateral', value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.repDepositShare ?? 0n} suffix='REP' /> },
						{ label: 'Selected Outcome Security Bond Allowance', value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.securityBondAllowance ?? 0n} suffix='ETH' /> },
					])}
				</>
			)
		})()

		return (
			<>
				{renderWorkflowMetricGrid([
					{ label: 'REP Collateral', value: <CurrencyValue value={connectedWalletVaultSummary.repDepositShare} suffix='REP' /> },
					{ label: 'Security Bond Allowance', value: <CurrencyValue value={connectedWalletVaultSummary.securityBondAllowance} suffix='ETH' /> },
					{ label: 'Escrowed REP', value: <CurrencyValue value={effectiveEscrowedRepInEscalationGame ?? 0n} suffix='REP' /> },
				])}
				<div className='form-grid fork-workflow-outcome-selector'>
					<label className='field'>
						<span>Outcome</span>
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
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? 'No REP collateral or security bond allowance remains to migrate for the connected wallet.' : undefined
	const migrateEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? 'No escrowed REP remains to migrate for the connected wallet.' : undefined
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
				fallbackText: 'Not started',
			})
		}
		if (isStartTruthAuctionInProgress) return 'Starting...'
		if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
			if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n) return `Starts in ${formatDuration(startTruthAuctionCountdown)}`
			return 'Not started'
		}
		return 'Not started'
	})()
	const endsDisplay = (() => {
		if (auctionWindow === undefined) return isStartTruthAuctionInProgress ? 'Pending confirmation' : 'Not started'
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
				<CurrencyValue value={displayedEthRaised} suffix='ETH' /> / <CurrencyValue value={truthAuctionStatus.ethRaiseCap} suffix='ETH' />
			</Fragment>
		)
	const clearingPriceDisplay = truthAuctionStatus === undefined ? truthAuctionFallback : renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)
	const settlementAvailableDisplay = (() => {
		if (!hasSelectedAuctionChildPool) return UNAVAILABLE_UNTIL_FORK
		if (selectedAuctionContext?.claimingAvailable) return 'Yes'

		return 'No'
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
	const settlementActionSafetyId: ActionSafetyId = truthAuctionStatus?.finalized === true && settlementSelectionMode === 'refund' ? 'fork-auction.settleAuctionRefunds' : getForkAuctionActionSafetyId(settlementAction)
	const showRefundOnlySettlementDebtNotice = truthAuctionStatus?.finalized === true && selectedRefundSettlementBidRows.length > 0 && selectedClaimSettlementBidRows.length === 0
	const settlementActionLabel = 'Settle Selected Bids'
	const settlementActionDescription = (() => {
		if (settlementSelectionMode === 'claim') return `Select winning bids and settle them together. Winning claims add child-pool REP plus ${AUCTIONED_BOND_ALLOWANCE_LABEL}.`
		if (settlementSelectionMode === 'refund') {
			if (truthAuctionStatus?.finalized === true) return `Select finalized refund rows and settle them together. These rows return locked ETH without adding ${AUCTIONED_BOND_ALLOWANCE_LABEL}.`
			return `Select refundable bids and settle them together. Refund-only settlement returns locked ETH without adding ${AUCTIONED_BOND_ALLOWANCE_LABEL}.`
		}
		return `Select winning and refundable bids and settle them together. Winning selections add REP plus ${AUCTIONED_BOND_ALLOWANCE_LABEL}, while refundable selections return locked ETH.`
	})()
	const settlementActionPendingLabel = 'Submitting settlement transaction...'
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
		if (accountState.address === undefined) return 'Connect a wallet before using fork and auction actions.'
		if (!isMainnet) return 'Switch to Ethereum mainnet before using fork and auction actions.'

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
					<strong>Truth auction has ended.</strong>{' '}
					{truthAuctionStatus.finalized ? `Bidding is closed and finalized settlement paths are now in effect. Winning claims receive REP plus ${AUCTIONED_BOND_ALLOWANCE_LABEL}, while losing bids are refunded.` : 'Bidding is closed. Finalize the truth auction to settle against the final clearing result.'}{' '}
					{truthAuctionEndsAt === undefined ? undefined : (
						<Fragment>
							Ended at: <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={truthAuctionEndsAt} />
						</Fragment>
					)}
				</p>
				{truthAuctionStatus.finalized ? undefined : (
					<div className='actions'>
						{renderStageActionButton({
							action: 'finalizeTruthAuction',
							availability: createActionAvailability(finalizeTruthAuctionGuardMessage),
							forceEnabled: hasSelectedAuctionChildPool,
							idleLabel: 'Finalize Truth Auction',
							onClick: onFinalizeTruthAuctionForSelectedAuction,
							pendingLabel: 'Finalizing truth auction...',
						})}
					</div>
				)}
			</div>
		)
	})()
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return `Truth auction can be started in ${formatDuration(startTruthAuctionCountdown)} once migration ends.`
	})()
	const isVaultMigrationComplete = hasCompletedVaultMigration || (connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance)
	const truthAuctionBypassReason = getTruthAuctionBypassReason({
		migratedRep: selectedAuctionContext?.migratedRep ?? selectedAuctionChildPool?.migratedRep ?? 0n,
		parentCollateralAmount: forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount,
		auctionableRepAtFork: forkAuctionDetails?.auctionableRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (hasStartedTruthAuction) return 'Truth auction already started.'
		if (isStartTruthAuctionInProgress) return 'Starting truth auction...'
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
		if (loadingReportingDetails) return 'Loading eligible escalation deposits.'
		if (reportingDetails?.status !== 'active') return 'Escalation deposit details are unavailable for this pool right now.'
		if (isMigrationRequired) return 'Use unresolved escalation migration for this parent pool.'
		if (isMigrationExpired) return 'The migration window for unresolved parent escalation deposits has closed.'
		if (selectedEscalationMigrationDeposits.length === 0) return `No ${selectedOutcomeLabel} escalation deposits are currently available to migrate for this wallet.`
		if (selectedEscalationMigrationDepositIndexes.length > 0) return undefined
		return 'Select at least one deposit to migrate.'
	})()
	const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrateUnresolvedEscalationGuardMessage = (() => {
		if (migrationWindowClosedGuardMessage !== undefined) return migrationWindowClosedGuardMessage
		if (!isMigrationRequired) return 'Unresolved escalation migration is unavailable for this pool.'
		if (loadingReportingDetails) return 'Loading unresolved escalation deposits.'
		if (activeReportingDetails === undefined) return 'Unresolved escalation deposit details are unavailable for this pool right now.'
		if (!hasUnresolvedMigrationDeposits) return 'No unresolved parent escalation deposits remain for the connected wallet.'
		return undefined
	})()
	const migratePoolToUniverseGuardMessage = (() => {
		if (loadingSelectedOutcomeMigrationSeedStatus) return `Checking whether pool REP has already been migrated for the ${selectedOutcomeLabel} child universe.`
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus?.seeded) return `Pool REP has already been migrated to the ${selectedOutcomeLabel} universe.`
		return undefined
	})()
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (loadingSelectedOutcomeMigrationSeedStatus) return `Checking whether pool REP has already been migrated for the ${selectedOutcomeLabel} child universe.`
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return `Migrate pool to the ${selectedOutcomeLabel} universe before moving vault balances.`
	})()
	const migrateVaultCompletedMessage = isVaultMigrationComplete ? 'Vault migration is already complete for this wallet.' : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationPending ? 'Migrating vault...' : undefined
	const migrateVaultGuardMessage = isMigrationRequired
		? 'Use unresolved escalation migration to move locked positions and vault balances together.'
		: (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage)
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
		safetyId,
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
		safetyId?: ActionSafetyId
		tone?: 'primary' | 'secondary'
	}) {
		const resolvedAvailability = availability ?? { disabled: false, reason: undefined }
		const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled
		const disabledReason = interactionDisabledReason ?? resolvedAvailability.reason
		const isPending = pending ?? forkAuctionActiveAction === action
		return (
			<TransactionActionButton
				safetyId={safetyId ?? getForkAuctionActionSafetyId(action)}
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={isPending}
				tone={tone}
				availability={{
					disabled: !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
					reason: disabledReason,
				}}
			/>
		)
	}
	function renderSelectedOutcomeChildPoolNotice() {
		if (selectedAuctionChildPool !== undefined) return undefined
		return (
			<div className='fork-workflow-outcome-notice'>
				<p className='detail'>Security Pool for {selectedOutcomeLabel} universe does not exist.</p>
			</div>
		)
	}
	const renderSubmitBidSection = ({ description, density = 'balanced', headingLevel = 3, title = 'Submit Bid', variant = 'embedded' }: { description?: ComponentChildren; density?: 'balanced' | 'compact'; headingLevel?: 3 | 4; title?: ComponentChildren; variant?: 'default' | 'embedded' }) => (
		<SectionBlock {...(description === undefined ? {} : { description })} density={density} headingLevel={headingLevel} title={title} variant={variant}>
			<div className='form-grid'>
				{submitBidPreviewTickSummary === undefined ? undefined : <p className='detail'>Selected ladder price: {renderTruthAuctionPriceValue(submitBidPreviewTickSummary.price)}</p>}
				<div className='field-row'>
					<label className='field'>
						<span>Bid Price (ETH / REP)</span>
						<FormInput value={forkAuctionForm.submitBidPrice} onInput={event => onForkAuctionFormChange({ submitBidPrice: event.currentTarget.value })} />
					</label>
					<label className='field'>
						<span>Bid Amount (ETH)</span>
						<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
					</label>
				</div>
				{enteredBidPrice === undefined ? undefined : <p className='detail'>At the entered price, this bid would buy roughly {estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix='REP' />} if fully filled.</p>}
				{renderTruthAuctionDebtNotice('bid')}
				<div className='actions'>
					{renderStageActionButton({
						action: 'submitBid',
						availability: createActionAvailability(submitBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel: 'Submit Bid',
						onClick: onSubmitBidForSelectedAuction,
						pendingLabel: 'Submitting bid...',
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
		safetyId,
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
		safetyId?: ActionSafetyId
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
					...(safetyId === undefined ? {} : { safetyId }),
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
	const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionableRepAtFork} suffix='REP' />
	const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, 'REP', UNKNOWN_VALUE)
	const migrationCollateralDisplay = renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, 'ETH', UNKNOWN_VALUE)
	const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? 'Not started' : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={migrationStartedAt} />
	const migrationEndsDisplay = (() => {
		if (forkAuctionDetails === undefined) return migrationSummaryText
		if (hasStartedSelectedTruthAuctionTimeline && effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) {
			return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={effectiveTruthAuctionStartedAt} />
		}
		if (forkAuctionDetails.migrationEndsAt === undefined) return 'Not started'

		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
	})()
	const truthAuctionStateBadgeElement = <Badge tone={truthAuctionStateBadge.tone}>{truthAuctionStateBadge.label}</Badge>
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: 'Truth Auction Address', value: renderAddress(auctionTruthAuctionAddress) },
		{ label: 'Started', value: startedDisplay },
		{ label: 'Ends', value: endsDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix='REP' /> },
		{ label: 'Clearing Price', value: clearingPriceDisplay },
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix='ETH' /> },
		{ label: 'Min Bid Size', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix='ETH' /> },
		{ label: 'Max REP Being Sold', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix='REP' /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix='ETH' /> },
		{ label: 'Settlement Available', value: settlementAvailableDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix='REP' /> },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid fork-workflow-outcome-selector'>
			<label className='field'>
				<span>Outcome</span>
				<div className='fork-workflow-outcome-selector-row'>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					{renderSelectedOutcomeChildPoolLink()}
				</div>
			</label>
		</div>
	)
	const selectedAuctionDetailsNotice = (() => {
		if (!hasSelectedAuctionChildPool || selectedStage === 'migration') return undefined
		if (loadingSelectedAuctionDetails) return <p className='detail'>Loading {selectedAuctionLabel} child auction details.</p>
		if (selectedAuctionContextError === undefined) return undefined
		return <p className='detail'>{selectedAuctionContextError}</p>
	})()
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedBondAllowanceDisplay={selectedAuctionContext === undefined ? UNKNOWN_VALUE : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix='ETH' />}
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
		<SectionBlock badge={migrationStatusBadge} className='fork-workflow-summary-card migration-summary-card' title='Migration Status'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary migration-summary-primary'>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>REP At Fork</span>
							<strong>{migrationRepAtForkDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>Migrated REP</span>
							<strong>{migrationRepDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>Collateral</span>
							<strong>{migrationCollateralDisplay}</strong>
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label='Migration Started'>{migrationStartedDisplay}</MetricField>
					<MetricField label='Migration Ends'>{migrationEndsDisplay}</MetricField>
					<MetricField label='Fork Type'>{resolvedForkTypeLabel}</MetricField>
				</div>
			</div>
			{forkAuctionDetails?.ownForkRepBuckets === undefined ? undefined : (
				<ReadOnlyDetailAccordion title='Advanced Diagnostics'>
					<div className='fork-workflow-summary-metrics'>
						<MetricField label='Pool REP At Fork'>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.vaultRepAtFork} suffix='REP' />
						</MetricField>
						<MetricField label='Unallocated Escrow Child REP'>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.unallocatedEscrowChildRep} suffix='REP' />
						</MetricField>
						<MetricField label='Escrow Source REP At Fork'>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtFork} suffix='REP' />
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
			safetyId: settlementActionSafetyId,
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
						idleLabel: `Settle Selected ${sideLabel} Fork-Carried Deposits`,
						onClick: () => onWithdrawForkedEscalationSubmit(outcome),
						pendingLabel: 'Settling fork-carried deposits...',
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
			<div aria-label='Fork lifecycle stages' className='fork-workflow-stage-nav' role='tablist'>
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
									{selectedStage === stage ? <span className='fork-workflow-stage-indicator'>Viewing</span> : undefined}
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
					<SectionBlock title='Fork Triggered' variant='embedded'>
						{hasTriggeredFork ? (
							renderWorkflowMetricGrid([
								{ label: 'Status', value: 'System is forking' },
								{
									label: 'Triggered At',
									value: <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={universeForkTime} />,
								},
							])
						) : (
							<p className='detail'>The system is not forking.</p>
						)}
					</SectionBlock>
				</fieldset>
			)
		if (selectedStage === 'migration')
			return (
				<fieldset aria-labelledby='fork-workflow-stage-migration' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-migration' role='tabpanel'>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
					{migrationSummaryCard}

					<SectionBlock title='Your Migration Balances' variant='embedded' description='Wallet-level balances in the parent pool that may still need migration.'>
						{migrationBalancesContent}
						{accountState.address === undefined ? undefined : (
							<>
								{hasUnresolvedMigrationState ? (
									<SectionBlock density='compact' headingLevel={4} title='Migrate Unresolved Escalation Locks' variant='embedded'>
										<p className='detail'>{isMigrationExpired ? 'The migration window for these unresolved parent escalation deposits has closed.' : 'All unresolved parent escalation locks on this wallet will migrate together with your vault into the selected child universe.'}</p>
										{loadingReportingDetails ? <p className='detail'>Loading unresolved escalation deposits for the connected wallet…</p> : undefined}
										{loadingReportingDetails || activeReportingDetails !== undefined ? undefined : <p className='detail'>Unresolved escalation deposit details are unavailable for this pool right now.</p>}
										{activeReportingDetails !== undefined && !hasUnresolvedMigrationDeposits ? <p className='detail'>No unresolved parent escalation deposits remain for the connected wallet.</p> : undefined}
										<p className='detail'>All unresolved parent escalation locks on this wallet move together into the selected child universe. They cannot be split across multiple outcomes.</p>
										{activeReportingDetails === undefined
											? undefined
											: unresolvedMigrationSides.map(side => (
													<div className='field' key={side.key}>
														<span>{side.label}</span>
														{side.userDeposits.length === 0 ? (
															<p className='detail'>No {side.label.toLowerCase()} unresolved deposits remain for this wallet.</p>
														) : (
															<EscalationDepositSelectionList
																disabled
																items={side.userDeposits.map(deposit => ({
																	deposit,
																	details: [
																		<>
																			Initially deposited: <CurrencyValue value={deposit.amount} suffix='REP' />
																		</>,
																		'Current path: Must migrate into the selected child universe',
																		<>
																			Entry depth: <CurrencyValue value={deposit.cumulativeAmount} suffix='REP' />
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
													idleLabel: `Migrate Unresolved Escalation To ${selectedOutcomeLabel}`,
													onClick: onMigrateUnresolvedEscalationSubmit,
													pendingLabel: 'Migrating unresolved escalation...',
													tone: 'primary',
												})}
											</div>
										)}
									</SectionBlock>
								) : (
									<SectionBlock density='compact' headingLevel={4} title='Migrate Resolved Escalation Deposits' variant='embedded'>
										<p className='detail'>Selected deposits leave the parent pool and reappear on the chosen child universe for later settlement.</p>
										{connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? <p className='detail'>No escrowed REP is currently visible for migratable escalation deposits on the connected wallet.</p> : undefined}
										{loadingReportingDetails ? <p className='detail'>Loading escalation deposits for the selected wallet…</p> : undefined}
										{loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : <p className='detail'>Escalation deposit details are unavailable for this pool right now.</p>}
										{showSelectedEscalationMigrationDeposits && !hasSelectedEscalationMigrationDeposits ? <p className='detail'>No {selectedOutcomeLabel} escalation deposits are currently available to migrate for this wallet.</p> : undefined}
										{showSelectedEscalationMigrationDeposits && hasSelectedEscalationMigrationDeposits ? (
											<div className='field'>
												<span>Choose deposits to migrate</span>
												<EscalationDepositSelectionList
													disabled={forkAuctionActiveAction === 'migrateEscalationDeposits'}
													items={selectedEscalationMigrationDeposits.map(deposit => {
														const claimAmount = getEscalationDepositClaimAmount(reportingDetails, forkAuctionForm.selectedOutcome, deposit)
														return {
															deposit,
															details: [
																<>
																	Initially deposited: <CurrencyValue value={deposit.amount} suffix='REP' />
																</>,
																claimAmount === undefined ? (
																	'Worth now: Pending migration/finalization'
																) : (
																	<>
																		Worth now: <CurrencyValue value={claimAmount} suffix='REP' />
																	</>
																),
																'Current path: Eligible for child-pool migration',
																<>
																	Entry depth: <CurrencyValue value={deposit.cumulativeAmount} suffix='REP' />
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
												idleLabel: `Migrate Selected ${selectedOutcomeLabel} Deposits`,
												onClick: onMigrateSelectedEscalationDeposits,
												pendingLabel: 'Migrating escalation deposits...',
											})}
										</div>
									</SectionBlock>
								)}
								<SectionBlock density='compact' headingLevel={4} title='Migrate Pool To Universe' variant='embedded'>
									<p className='detail'>This moves pool-level REP shared by the selected outcome into the child universe. It affects the outcome pool, not just your vault.</p>
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>Checking whether pool REP is already ready for the selected child universe.</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalance > 0n ? 'Pool REP has already been migrated to the selected child universe.' : 'Pool REP for this outcome is already staged and will sweep into the child universe during vault migration.'}</p>
									)}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateRepToZoltar',
											availability: createActionAvailability(migratePoolToUniverseGuardMessage),
											idleLabel: `Migrate Pool To ${selectedOutcomeLabel} Universe`,
											onClick: onMigrateSelectedOutcomeRepToZoltar,
											pendingLabel: 'Migrating pool to universe...',
										})}
									</div>
								</SectionBlock>
								<SectionBlock density='compact' headingLevel={4} title='Migrate Vault' variant='embedded'>
									<p className='detail'>This moves all remaining REP collateral and security-bond allowance from your parent vault into the selected child pool for this outcome.</p>
									{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>No REP collateral or security bond allowance remains to migrate for the connected wallet.</p> : undefined}
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>Checking whether pool REP is already ready for the selected child universe.</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateVault',
											availability: createActionAvailability(migrateVaultGuardMessage),
											idleLabel: `Migrate Vault To ${selectedOutcomeLabel}`,
											onClick: onMigrateVaultSubmit,
											pendingLabel: 'Migrating vault...',
											tone: 'primary',
										})}
									</div>
									{isVaultMigrationComplete ? <p className='detail'>Already migrated</p> : undefined}
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
								description: 'Submitting a bid locks ETH until settlement. Losing bids are refunded during settlement.',
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
						<SectionBlock badge={truthAuctionStateBadgeElement} title='Truth Auction Status' variant='embedded'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>

						<SectionBlock title='Start Truth Auction' variant='embedded'>
							<p className='detail'>Start the ETH-for-REP truth auction only after migration closes. Winning bids later claim REP plus {AUCTIONED_BOND_ALLOWANCE_LABEL}, while losing bids are refunded during settlement.</p>
							{startTruthAuctionReadyInText === undefined ? undefined : <p className='detail'>{startTruthAuctionReadyInText}</p>}
							{truthAuctionBypassReason === undefined ? undefined : <p className='detail'>{truthAuctionBypassReason}</p>}
							<div className='actions'>
								{renderStageActionButton({
									action: 'startTruthAuction',
									availability: createActionAvailability(!hasSelectedAuctionChildPool ? `Child universe not created for the ${selectedAuctionLabel} outcome yet.` : startTruthAuctionAvailabilityMessage),
									forceEnabled: hasSelectedAuctionChildPool,
									idleLabel: truthAuctionBypassReason === undefined ? 'Start Truth Auction' : 'Bypass Truth Auction',
									onClick: onStartTruthAuctionSubmit,
									pendingLabel: truthAuctionBypassReason === undefined ? 'Starting truth auction...' : 'Bypassing auction...',
									tone: 'primary',
								})}
							</div>
						</SectionBlock>

						{renderSubmitBidSection({ description: 'Submitting a bid locks ETH until settlement. Losing bids are refunded during settlement.' })}
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
						<SectionBlock badge={truthAuctionStateBadgeElement} title='Settlement Status' variant='embedded'>
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
					{!showSecurityPoolAddressInput ? undefined : <LookupFieldRow label='Security Pool Address' value={forkAuctionForm.securityPoolAddress} onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })} placeholder='0x...' />}
					{hasLoadedPoolContext ? undefined : <p className='detail'>Load a pool to inspect fork progress, migration, and the truth auction.</p>}
				</div>
			)}
			{forkWorkflowStageNavigator}
			{hasLoadedPoolContext ? stagePanel : undefined}

			<ErrorNotice message={forkAuctionError} />
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel description='Open a pool to inspect fork progress, migration, and the truth auction.' showHeader={showHeader} title='Fork & Truth Auction'>
			{content}
		</RouteWorkflowPanel>
	)
}
