import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { type Address, zeroAddress } from 'viem'
import { AddressValue } from './AddressValue.js'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { ChildUniverseDeploymentModal } from './ChildUniverseDeploymentModal.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { TimestampValue } from './TimestampValue.js'
import { ViewTabs } from './ViewTabs.js'
import { WorkflowTransactionStatus } from './WorkflowTransactionStatus.js'
import { loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage, loadTruthAuctionTickPage } from '../contracts.js'
import { createActionAvailability } from '../lib/actionAvailability.js'
import { sameAddress } from '../lib/address.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { AUCTION_TIME_SECONDS, type ForkAuctionStageView, estimateRepPurchased, getForkAuctionStageView, getForkStageDescription, getForkStageDescriptionForState, getOutcomeActionLabel, getTimeRemaining, getTruthAuctionBidGuardMessage, hasForkActivity, MIGRATION_TIME_SECONDS } from '../lib/forkAuction.js'
import { formatDuration } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { getSecurityPoolLifecycleLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import type { ListedSecurityPool, ReadClient, TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '../types/contracts.js'
import type { ForkAuctionSectionProps, ReadinessAction } from '../types/components.js'
const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = 'Unavailable until fork'
const TRUTH_AUCTION_BOOK_PAGE_SIZE = 100
const PRICE_PRECISION = 10n ** 18n
const STAGE_VIEWS: readonly ForkAuctionStageView[] = ['initiate', 'migration', 'auction', 'settlement']
const STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: 'Initiate',
	migration: 'Migration',
	auction: 'Auction',
	settlement: 'Settlement',
}
const STAGE_ORDER: Record<ForkAuctionStageView, number> = {
	initiate: 0,
	migration: 1,
	auction: 2,
	settlement: 3,
}
type DisplayMetric = {
	label: string
	value: ComponentChildren
}
type TruthAuctionDisposition = {
	label: string
	tone: 'default' | 'danger' | 'success' | 'warning'
}

type TruthAuctionBidDisposition = TruthAuctionDisposition & {
	canPrefillClaim: boolean
	canPrefillRefund: boolean
}

type TruthAuctionBookData = {
	tickSummaries: TruthAuctionTickSummary[]
	viewerBids: TruthAuctionBidView[]
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
function renderAddress(address: string | undefined) {
	if (address === undefined) return UNKNOWN_VALUE
	return <AddressValue address={address} />
}
function renderTimestamp({ displayTimestamp, fallbackText }: { displayTimestamp: bigint | undefined; fallbackText: string }) {
	if (displayTimestamp === undefined) return fallbackText
	return <TimestampValue timestamp={displayTimestamp} />
}
function getForkOnlyFallbackText(hasPreviewForkActivity: boolean) {
	return hasPreviewForkActivity ? UNKNOWN_VALUE : UNAVAILABLE_UNTIL_FORK
}
function getPreviewForkType(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	return previewPool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'
}
function getPreviewMigrationSummary(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	if (previewPool.truthAuctionStartedAt > 0n) return 'Started/finished'
	return UNKNOWN_VALUE
}
function getStageLabel(stage: ForkAuctionStageView) {
	return STAGE_LABELS[stage]
}
function getStageAheadMessage(stage: ForkAuctionStageView, currentStage: ForkAuctionStageView) {
	if (STAGE_ORDER[stage] <= STAGE_ORDER[currentStage]) return undefined
	switch (stage) {
		case 'migration':
			return `This pool is currently in ${getStageLabel(currentStage)}. Migration controls become meaningful once the pool has forked.`
		case 'auction':
			return `This pool is currently in ${getStageLabel(currentStage)}. Auction controls become meaningful after migration completes and the truth auction starts.`
		case 'settlement':
			return `This pool is currently in ${getStageLabel(currentStage)}. Settlement controls become meaningful after bidding progresses or the truth auction finalizes.`
		case 'initiate':
			return undefined
		default:
			return undefined
	}
}
function renderSummaryMetricGrid(metrics: DisplayMetric[]) {
	return (
		<div className='fork-summary-grid'>
			{metrics.map(metric => (
				<MetricField key={metric.label} className='entity-metric' label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</div>
	)
}
function renderWorkflowMetricGrid(metrics: DisplayMetric[]) {
	return (
		<div className='workflow-metric-grid'>
			{metrics.map(metric => (
				<MetricField key={metric.label} label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</div>
	)
}
function estimateBidRep(bidAmount: string, selectedAuctionPrice: bigint | undefined) {
	if (selectedAuctionPrice === undefined) return undefined
	try {
		return estimateRepPurchased(BigInt(bidAmount === '' ? '0' : bidAmount), selectedAuctionPrice)
	} catch {
		return undefined
	}
}
function parseOptionalBigInt(value: string) {
	const trimmedValue = value.trim()
	if (trimmedValue === '') return undefined
	try {
		return BigInt(trimmedValue)
	} catch {
		return undefined
	}
}

function clampPercentage(value: bigint, maxValue: bigint) {
	if (value <= 0n || maxValue <= 0n) return 0
	const boundedValue = value > maxValue ? maxValue : value
	return Number((boundedValue * 10000n) / maxValue) / 100
}

function getTruthAuctionWinningThresholdPrice(truthAuction: TruthAuctionMetrics | undefined) {
	if (truthAuction === undefined || !truthAuction.finalized || !truthAuction.underfunded || truthAuction.maxRepBeingSold === 0n) return undefined
	return (truthAuction.ethRaised * PRICE_PRECISION) / truthAuction.maxRepBeingSold
}

function getTickDisposition(tickSummary: TruthAuctionTickSummary, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionDisposition {
	if (tickSummary.currentTotalEth === 0n) return { label: 'Historical', tone: 'default' }
	if (truthAuction === undefined) return { label: 'Live', tone: 'default' }
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	if (winningThresholdPrice !== undefined) return tickSummary.price >= winningThresholdPrice ? { label: 'Winning', tone: 'success' } : { label: 'Out', tone: 'danger' }
	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) return truthAuction.finalized ? { label: 'Winning', tone: 'success' } : { label: 'In Book', tone: 'default' }
	if (tickSummary.tick > truthAuction.clearingTick) return { label: truthAuction.finalized ? 'Winning' : 'Above Clearing', tone: 'success' }
	if (tickSummary.tick < truthAuction.clearingTick) return { label: truthAuction.finalized ? 'Out' : 'Below Clearing', tone: 'danger' }
	return { label: truthAuction.finalized ? 'Clearing' : 'At Clearing', tone: 'warning' }
}

function getBidDisposition(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionBidDisposition {
	if (bid.refunded) return { label: 'Refunded', tone: 'default', canPrefillClaim: false, canPrefillRefund: false }
	if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillClaim: false, canPrefillRefund: false }
	if (truthAuction === undefined) return { label: 'Pending', tone: 'default', canPrefillClaim: false, canPrefillRefund: false }

	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	if (winningThresholdPrice !== undefined) {
		if (bid.price >= winningThresholdPrice) {
			return {
				label: truthAuction.finalized ? 'Winning' : 'Provisional',
				tone: truthAuction.finalized ? 'success' : 'warning',
				canPrefillClaim: truthAuction.finalized,
				canPrefillRefund: false,
			}
		}
		return {
			label: truthAuction.finalized ? 'Owner Withdrawal' : 'In Book',
			tone: truthAuction.finalized ? 'danger' : 'default',
			canPrefillClaim: false,
			canPrefillRefund: false,
		}
	}

	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		return {
			label: truthAuction.finalized ? 'Winning' : 'In Book',
			tone: truthAuction.finalized ? 'success' : 'default',
			canPrefillClaim: truthAuction.finalized,
			canPrefillRefund: false,
		}
	}

	if (bid.tick > truthAuction.clearingTick) {
		return {
			label: truthAuction.finalized ? 'Winning' : 'Above Clearing',
			tone: truthAuction.finalized ? 'success' : 'warning',
			canPrefillClaim: truthAuction.finalized,
			canPrefillRefund: false,
		}
	}
	if (bid.tick < truthAuction.clearingTick) {
		return {
			label: truthAuction.finalized ? 'Owner Withdrawal' : 'Below Clearing',
			tone: 'danger',
			canPrefillClaim: false,
			canPrefillRefund: !truthAuction.finalized,
		}
	}

	const previousCumulativeEth = bid.cumulativeEth - bid.ethAmount
	if (truthAuction.ethAtClearingTick <= previousCumulativeEth) {
		return {
			label: truthAuction.finalized ? 'Owner Withdrawal' : 'Below Clearing',
			tone: 'danger',
			canPrefillClaim: false,
			canPrefillRefund: !truthAuction.finalized,
		}
	}
	if (truthAuction.ethAtClearingTick >= bid.cumulativeEth) {
		return {
			label: truthAuction.finalized ? 'Winning' : 'At Clearing',
			tone: truthAuction.finalized ? 'success' : 'warning',
			canPrefillClaim: truthAuction.finalized,
			canPrefillRefund: false,
		}
	}
	return {
		label: truthAuction.finalized ? 'Partial' : 'At Clearing',
		tone: 'warning',
		canPrefillClaim: truthAuction.finalized,
		canPrefillRefund: false,
	}
}

function getTruthAuctionDispositionClassName(tone: TruthAuctionDisposition['tone']) {
	switch (tone) {
		case 'danger':
			return 'is-danger'
		case 'success':
			return 'is-success'
		case 'warning':
			return 'is-warning'
		case 'default':
			return 'is-default'
		default:
			return 'is-default'
	}
}

function sortTruthAuctionTickSummaries(tickSummaries: TruthAuctionTickSummary[]) {
	return [...tickSummaries].sort((left, right) => {
		if (left.tick === right.tick) return 0
		return left.tick > right.tick ? -1 : 1
	})
}

async function loadAllTruthAuctionTicks(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address) {
	const tickSummaries: TruthAuctionTickSummary[] = []
	let pageIndex = 0
	let loadedTicks = 0n
	while (true) {
		const page = await loadTruthAuctionTickPage(client, truthAuctionAddress, pageIndex, TRUTH_AUCTION_BOOK_PAGE_SIZE)
		tickSummaries.push(...page.ticks)
		loadedTicks += BigInt(page.ticks.length)
		if (loadedTicks >= page.tickCount || page.ticks.length === 0) return tickSummaries
		pageIndex += 1
	}
}

async function loadAllTruthAuctionTickBids(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint) {
	const bids: TruthAuctionBidView[] = []
	let pageIndex = 0
	let loadedBids = 0n
	while (true) {
		const page = await loadTruthAuctionTickBidPage(client, truthAuctionAddress, tick, pageIndex, TRUTH_AUCTION_BOOK_PAGE_SIZE)
		bids.push(...page.bids)
		loadedBids += BigInt(page.bids.length)
		if (loadedBids >= page.bidCount || page.bids.length === 0) return bids
		pageIndex += 1
	}
}

async function loadAllTruthAuctionBidderBids(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, bidder: Address) {
	const bids: TruthAuctionBidView[] = []
	let pageIndex = 0
	let loadedBids = 0n
	while (true) {
		const page = await loadTruthAuctionBidderBidPage(client, truthAuctionAddress, bidder, pageIndex, TRUTH_AUCTION_BOOK_PAGE_SIZE)
		bids.push(...page.bids)
		loadedBids += BigInt(page.bids.length)
		if (loadedBids >= page.bidCount || page.bids.length === 0) return bids
		pageIndex += 1
	}
}
export function ForkAuctionSection({
	accountState,
	currentTimestamp,
	disabled = false,
	disabledMessage,
	embedInCard = false,
	forkAuctionDetails,
	forkAuctionActiveAction,
	forkAuctionError,
	forkAuctionForm,
	forkAuctionResult,
	loadingForkAuctionDetails,
	onClaimAuctionProceeds,
	onCreateChildUniverse,
	onFinalizeTruthAuction,
	onForkAuctionFormChange,
	onForkUniverse,
	onForkWithOwnEscalation,
	onInitiateFork,
	onLoadForkAuction,
	onMigrateEscalationDeposits,
	onMigrateRepToZoltar,
	onMigrateVault,
	onRefundLosingBids,
	onStartTruthAuction,
	onSubmitBid,
	onWithdrawBids,
	previewPool,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	truthAuctionReadClient,
}: ForkAuctionSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedAuctionPrice = forkAuctionDetails?.truthAuction?.clearingPrice
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, selectedAuctionPrice)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const migrationTimeRemaining = forkAuctionDetails === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, effectiveCurrentTimestamp ?? forkAuctionDetails.currentTime)
	const previewAuctionWindow = getTruthAuctionWindow(previewPool?.truthAuctionStartedAt)
	const auctionWindow = forkAuctionDetails === undefined ? previewAuctionWindow : getTruthAuctionWindow(forkAuctionDetails.truthAuctionStartedAt)
	const truthAuctionEndsAt = forkAuctionDetails?.truthAuction?.auctionEndsAt ?? auctionWindow?.endsAt
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const parentSecurityPoolAddress = forkAuctionDetails?.parentSecurityPoolAddress ?? previewPool?.parent
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const forkOutcome = forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome
	const questionOutcome = forkAuctionDetails?.questionOutcome ?? previewPool?.questionOutcome
	const truthAuctionAddress = forkAuctionDetails?.truthAuctionAddress ?? previewPool?.truthAuctionAddress
	const hasPreviewForkActivity = previewPool === undefined ? false : hasForkActivity(previewPool)
	const forkOnlyFallbackText = getForkOnlyFallbackText(hasPreviewForkActivity)
	const forkStageDescription = (() => {
		if (forkAuctionDetails === undefined) {
			if (systemState === undefined) return undefined

			return getForkStageDescriptionForState(systemState)
		}

		return getForkStageDescription(forkAuctionDetails)
	})()
	const migrationSummaryText = forkAuctionDetails === undefined ? getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) : undefined
	const hasLoadedPoolContext = securityPoolAddress !== undefined && systemState !== undefined
	const currentStage =
		systemState === undefined
			? 'initiate'
			: getForkAuctionStageView({
					claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
					forkOutcome: forkOutcome ?? 'none',
					migratedRep: forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep ?? 0n,
					systemState,
					truthAuction: forkAuctionDetails?.truthAuction,
					truthAuctionStartedAt: forkAuctionDetails?.truthAuctionStartedAt ?? previewPool?.truthAuctionStartedAt ?? 0n,
				})
	const [selectedStage, setSelectedStage] = useState<ForkAuctionStageView>(currentStage)
	const [childUniverseModalOpen, setChildUniverseModalOpen] = useState(false)
	const [truthAuctionBookData, setTruthAuctionBookData] = useState<TruthAuctionBookData>({
		tickSummaries: [],
		viewerBids: [],
	})
	const [selectedTickBids, setSelectedTickBids] = useState<TruthAuctionBidView[]>([])
	const [selectedBookTick, setSelectedBookTick] = useState<bigint | undefined>(undefined)
	const [loadingTruthAuctionBook, setLoadingTruthAuctionBook] = useState(false)
	const [loadingSelectedTickBids, setLoadingSelectedTickBids] = useState(false)
	const [truthAuctionBookError, setTruthAuctionBookError] = useState<string | undefined>(undefined)
	const lastPoolKeyRef = useRef<string | undefined>(undefined)
	const selectedStageAheadMessage = getStageAheadMessage(selectedStage, currentStage)
	const truthAuctionFallback = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : UNKNOWN_VALUE
	const truthAuctionStatus = forkAuctionDetails?.truthAuction
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && truthAuctionAddress !== undefined && truthAuctionAddress !== zeroAddress
	const sortedTruthAuctionTicks = sortTruthAuctionTickSummaries(truthAuctionBookData.tickSummaries)
	const selectedTickSummary = selectedBookTick === undefined ? undefined : sortedTruthAuctionTicks.find(tickSummary => tickSummary.tick === selectedBookTick)
	const enteredBidTick = parseOptionalBigInt(forkAuctionForm.submitBidTick)
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuctionStatus)
	const startedDisplay = (() => {
		if (forkAuctionDetails === undefined) {
			if (previewPool?.truthAuctionStartedAt === undefined || previewPool.truthAuctionStartedAt === 0n) return 'Not started'

			return renderTimestamp({
				displayTimestamp: previewPool.truthAuctionStartedAt,
				fallbackText: 'Not started',
			})
		}
		if (forkAuctionDetails.truthAuctionStartedAt === 0n) return 'Not started'

		return renderTimestamp({
			displayTimestamp: forkAuctionDetails.truthAuctionStartedAt,
			fallbackText: 'Not started',
		})
	})()
	const endsDisplay = auctionWindow === undefined ? 'Not started' : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={auctionWindow.endsAt} />
	const truthAuctionTimeRemaining = truthAuctionEndsAt === undefined || effectiveCurrentTimestamp === undefined ? forkAuctionDetails?.truthAuction?.timeRemaining : getTimeRemaining(truthAuctionEndsAt, effectiveCurrentTimestamp)
	const truthAuctionNote = (() => {
		if (truthAuctionStatus === undefined) return undefined
		if (!truthAuctionStatus.finalized) return 'The order book below reflects live demand and provisional clearing. Final allocation locks once the auction is finalized.'
		if (winningThresholdPrice !== undefined) return 'This auction finalized underfunded. Bids at or above the winning threshold share REP pro rata.'
		if (truthAuctionStatus.hitCap) return 'This auction finalized at a clearing tick. Bids above the clearing tick fill first and the clearing tick fills FIFO.'
		return 'This auction finalized without exhausting the configured cap.'
	})()
	const ethRaisedProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(truthAuctionStatus.ethRaised, truthAuctionStatus.ethRaiseCap)
	const repSoldProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(truthAuctionStatus.totalRepPurchased, truthAuctionStatus.maxRepBeingSold)
	const maxTickEth = sortedTruthAuctionTicks.reduce((maximumEth, tickSummary) => (tickSummary.currentTotalEth > maximumEth ? tickSummary.currentTotalEth : maximumEth), 0n)
	const timeLeftDisplay = (() => {
		if (forkAuctionDetails?.truthAuction === undefined) return forkOnlyFallbackText
		if (truthAuctionTimeRemaining === undefined) return formatDuration(AUCTION_TIME_SECONDS)

		return formatDuration(truthAuctionTimeRemaining)
	})()
	const ethRaisedCapDisplay =
		forkAuctionDetails?.truthAuction === undefined ? (
			forkOnlyFallbackText
		) : (
			<Fragment>
				<CurrencyValue value={forkAuctionDetails.truthAuction.ethRaised} suffix='ETH' /> / <CurrencyValue value={forkAuctionDetails.truthAuction.ethRaiseCap} suffix='ETH' />
			</Fragment>
		)
	const clearingPriceDisplay = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : renderMetricValue(forkAuctionDetails.truthAuction.clearingPrice, 'REP', UNKNOWN_VALUE)
	const finalizedDisplay = (() => {
		if (forkAuctionDetails?.truthAuction === undefined) return forkOnlyFallbackText
		if (forkAuctionDetails.truthAuction.finalized) return 'Yes'

		return 'No'
	})()
	const underfundedDisplay = (() => {
		if (forkAuctionDetails?.truthAuction === undefined) return forkOnlyFallbackText
		if (forkAuctionDetails.truthAuction.underfunded) return 'Yes'

		return 'No'
	})()
	const claimingAvailableDisplay = (() => {
		if (forkAuctionDetails === undefined) {
			if (hasPreviewForkActivity) return UNKNOWN_VALUE

			return UNAVAILABLE_UNTIL_FORK
		}
		if (forkAuctionDetails.claimingAvailable) return 'Yes'

		return 'No'
	})()
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
		lifecycleState: deriveSecurityPoolLifecycleState({
			questionOutcome,
			systemState,
		}),
		universeHasForked: previewPool?.universeHasForked === true,
	})
	const truthAuctionBidGuardMessage = getTruthAuctionBidGuardMessage({
		accountAddress: accountState.address,
		isMainnet,
		submitBidAmountInput: forkAuctionForm.submitBidAmount,
		truthAuction: forkAuctionDetails?.truthAuction,
		walletEthBalance: accountState.ethBalance,
	})
	const createChildUniverseEnabled = forkPoolState.actions.createChildUniverse.enabled
	const childUniverseRequirements = [
		{ key: 'pool', label: 'Forked pool loaded', resolved: hasLoadedPoolContext, ...(hasLoadedPoolContext ? {} : { detail: 'Load a forked pool before creating a child universe.' }) },
		{ key: 'outcome', label: 'Outcome selected', resolved: forkAuctionForm.selectedOutcome !== undefined, ...(forkAuctionForm.selectedOutcome === undefined ? { detail: 'Select the outcome whose child universe you want to create.' } : {}) },
		{ key: 'wallet', label: 'Wallet connected', resolved: accountState.address !== undefined, ...(accountState.address !== undefined ? {} : { detail: 'Connect a wallet before creating a child universe.' }) },
		{ key: 'mainnet', label: 'Ethereum mainnet selected', resolved: isMainnet, ...(isMainnet ? {} : { detail: 'Switch to Ethereum mainnet before creating a child universe.' }) },
	]
	const createChildUniverseLauncherAction: ReadinessAction = {
		actionLabel: 'Create child universe',
		description: 'Review the selected outcome and confirm the child-universe creation in a bounded execution modal.',
		key: 'create-child-universe',
		...(hasLoadedPoolContext && createChildUniverseEnabled ? { onAction: () => setChildUniverseModalOpen(true) } : {}),
		readiness: hasLoadedPoolContext && createChildUniverseEnabled ? 'ready' : 'blocked',
		title: `Create ${getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe`,
		...(hasLoadedPoolContext ? {} : { blocker: 'Load fork details for this pool first.' }),
	}
	const renderStageActionButton = ({
		action,
		availability,
		idleLabel,
		onClick,
		pendingLabel,
		tone = 'secondary',
	}: {
		action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>
		availability?: {
			disabled: boolean
			reason: string | undefined
		}
		idleLabel: string
		onClick: () => void
		pendingLabel: string
		tone?: 'primary' | 'secondary'
	}) => {
		const resolvedAvailability = availability ?? { disabled: false, reason: undefined }
		const actionEnabled = forkPoolState.actions[action].enabled
		return (
			<TransactionActionButton
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={forkAuctionActiveAction === action}
				tone={tone}
				availability={{
					disabled: !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
					reason: actionEnabled ? (interactionDisabledReason ?? resolvedAvailability.reason) : undefined,
				}}
			/>
		)
	}
	useEffect(() => {
		if (lastPoolKeyRef.current === securityPoolAddress) return
		lastPoolKeyRef.current = securityPoolAddress
		setSelectedStage(currentStage)
	}, [currentStage, securityPoolAddress])
	useEffect(() => {
		if (forkAuctionResult?.action !== 'createChildUniverse') return
		setChildUniverseModalOpen(false)
	}, [forkAuctionResult])
	useEffect(() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress || (selectedStage !== 'auction' && selectedStage !== 'settlement')) {
			setTruthAuctionBookData({
				tickSummaries: [],
				viewerBids: [],
			})
			setSelectedTickBids([])
			setSelectedBookTick(undefined)
			setLoadingTruthAuctionBook(false)
			setLoadingSelectedTickBids(false)
			setTruthAuctionBookError(undefined)
			return
		}
		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingTruthAuctionBook(true)
		setTruthAuctionBookError(undefined)
		void Promise.all([loadAllTruthAuctionTicks(client, truthAuctionAddress), accountState.address === undefined ? Promise.resolve([]) : loadAllTruthAuctionBidderBids(client, truthAuctionAddress, accountState.address)])
			.then(([tickSummaries, viewerBids]) => {
				if (cancelled) return
				const sortedTickSummaries = sortTruthAuctionTickSummaries(tickSummaries)
				setTruthAuctionBookData({
					tickSummaries,
					viewerBids,
				})
				setSelectedBookTick(currentSelection => {
					if (currentSelection !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === currentSelection)) return currentSelection
					if (enteredBidTick !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === enteredBidTick)) return enteredBidTick
					if (truthAuctionStatus?.clearingTick !== undefined && sortedTickSummaries.some(tickSummary => tickSummary.tick === truthAuctionStatus.clearingTick)) return truthAuctionStatus.clearingTick
					return sortedTickSummaries[0]?.tick
				})
			})
			.catch(error => {
				if (cancelled) return
				setTruthAuctionBookData({
					tickSummaries: [],
					viewerBids: [],
				})
				setSelectedTickBids([])
				setSelectedBookTick(undefined)
				setTruthAuctionBookError(getErrorMessage(error, 'Failed to load truth auction bidbook'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingTruthAuctionBook(false)
			})
		return () => {
			cancelled = true
		}
	}, [accountState.address, enteredBidTick, selectedStage, shouldShowTruthAuctionVisualization, truthAuctionAddress, truthAuctionReadClient, truthAuctionStatus?.clearingTick, truthAuctionStatus?.ethRaised, truthAuctionStatus?.finalized])
	useEffect(() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress || selectedBookTick === undefined) {
			setSelectedTickBids([])
			setLoadingSelectedTickBids(false)
			return
		}
		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingSelectedTickBids(true)
		setTruthAuctionBookError(undefined)
		void loadAllTruthAuctionTickBids(client, truthAuctionAddress, selectedBookTick)
			.then(bids => {
				if (cancelled) return
				setSelectedTickBids(bids)
			})
			.catch(error => {
				if (cancelled) return
				setSelectedTickBids([])
				setTruthAuctionBookError(getErrorMessage(error, 'Failed to load truth auction bids at the selected price level'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingSelectedTickBids(false)
			})
		return () => {
			cancelled = true
		}
	}, [selectedBookTick, shouldShowTruthAuctionVisualization, truthAuctionAddress, truthAuctionReadClient])
	const latestForkAuctionAction =
		forkAuctionResult === undefined
			? undefined
			: {
					dismissKey: forkAuctionResult.hash,
					title: 'Latest Fork / Auction Action',
					embedInCard,
					rows: [
						{ label: 'Action', value: forkAuctionResult.action },
						{ label: 'Pool', value: <AddressValue address={forkAuctionResult.securityPoolAddress} /> },
						{ label: 'Universe', value: <UniverseLink universeId={forkAuctionResult.universeId} /> },
						{ label: 'Transaction', value: <TransactionHashLink hash={forkAuctionResult.hash} /> },
					],
				}
	const poolSummaryMetrics: DisplayMetric[] = [
		{ label: 'Security Pool', value: renderAddress(securityPoolAddress) },
		{ label: 'Universe', value: universeId === undefined ? UNKNOWN_VALUE : <UniverseLink universeId={universeId} /> },
		{ label: 'Parent Pool', value: renderAddress(parentSecurityPoolAddress) },
		{ label: 'System State', value: getSecurityPoolLifecycleLabel(forkPoolState.lifecycleState) },
		{
			label: 'Fork Type',
			value: (() => {
				if (forkAuctionDetails === undefined) return getPreviewForkType(previewPool, hasPreviewForkActivity)
				if (forkAuctionDetails.forkOwnSecurityPool) return 'Own escalation fork'

				return 'Parent/Zoltar fork'
			})(),
		},
		{ label: 'Question Outcome', value: questionOutcome === undefined ? UNKNOWN_VALUE : getReportingOutcomeLabel(questionOutcome) },
		{ label: 'Fork Outcome', value: forkOutcome === undefined ? UNKNOWN_VALUE : getReportingOutcomeLabel(forkOutcome) },
		{ label: 'Collateral', value: renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, 'ETH', UNKNOWN_VALUE) },
	]
	const initiateStatusMetrics: DisplayMetric[] = [
		{ label: 'Current Stage', value: getStageLabel(currentStage) },
		{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
		{
			label: 'Fork Type',
			value: (() => {
				if (forkAuctionDetails === undefined) return getPreviewForkType(previewPool, hasPreviewForkActivity)
				if (forkAuctionDetails.forkOwnSecurityPool) return 'Own escalation fork'

				return 'Parent/Zoltar fork'
			})(),
		},
		{ label: 'Migration Window', value: formatDuration(MIGRATION_TIME_SECONDS) },
	]
	const migrationStatusMetrics: DisplayMetric[] = [
		{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
		{ label: 'Migrated REP', value: renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, 'REP', UNKNOWN_VALUE) },
		{ label: 'Collateral', value: renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, 'ETH', UNKNOWN_VALUE) },
		{
			label: 'Migration Ends',
			value: (() => {
				if (forkAuctionDetails === undefined) return migrationSummaryText
				if (forkAuctionDetails.migrationEndsAt === undefined) return 'Started/finished'

				return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
			})(),
		},
		{
			label: 'Time Left',
			value: (() => {
				if (forkAuctionDetails === undefined) return forkOnlyFallbackText
				if (migrationTimeRemaining === undefined) return formatDuration(MIGRATION_TIME_SECONDS)

				return formatDuration(migrationTimeRemaining)
			})(),
		},
		{
			label: 'Fork Type',
			value: (() => {
				if (forkAuctionDetails === undefined) return getPreviewForkType(previewPool, hasPreviewForkActivity)
				if (forkAuctionDetails.forkOwnSecurityPool) return 'Own escalation fork'

				return 'Parent/Zoltar fork'
			})(),
		},
	]
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: 'Auction Address', value: renderAddress(truthAuctionAddress) },
		{ label: 'Started', value: startedDisplay },
		{ label: 'Ends', value: endsDisplay },
		{ label: 'Time Left', value: timeLeftDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.totalRepPurchased} suffix='REP' /> },
		{ label: 'Clearing Tick', value: truthAuctionStatus?.clearingTick?.toString() ?? truthAuctionFallback },
		{ label: 'Clearing Price', value: clearingPriceDisplay },
		{ label: 'Min Bid Size', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix='ETH' /> },
		{ label: 'Max REP Being Sold', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix='REP' /> },
		{ label: 'Finalized', value: finalizedDisplay },
		{ label: 'Underfunded', value: underfundedDisplay },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: 'Finalized', value: finalizedDisplay },
		{ label: 'Underfunded', value: underfundedDisplay },
		{ label: 'Auctioned Allowance', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionedSecurityBondAllowance} suffix='ETH' /> },
		{ label: 'Claiming Available', value: claimingAvailableDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.totalRepPurchased} suffix='REP' /> },
	]
	const liveSnapshotMetrics: DisplayMetric[] = (() => {
		if (selectedStage === 'initiate')
			return [
				{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
				{
					label: 'Fork Type',
					value: (() => {
						if (forkAuctionDetails === undefined) return getPreviewForkType(previewPool, hasPreviewForkActivity)
						if (forkAuctionDetails.forkOwnSecurityPool) return 'Own escalation fork'

						return 'Parent/Zoltar fork'
					})(),
				},
				{ label: 'Parent Pool', value: renderAddress(parentSecurityPoolAddress) },
				{ label: 'Migration Window', value: formatDuration(MIGRATION_TIME_SECONDS) },
			]
		if (selectedStage === 'migration')
			return [
				{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
				{ label: 'Migrated REP', value: renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, 'REP', UNKNOWN_VALUE) },
				{
					label: 'Migration Ends',
					value: (() => {
						if (forkAuctionDetails === undefined) return migrationSummaryText
						if (forkAuctionDetails.migrationEndsAt === undefined) return 'Started/finished'

						return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
					})(),
				},
				{
					label: 'Time Left',
					value: (() => {
						if (forkAuctionDetails === undefined) return forkOnlyFallbackText
						if (migrationTimeRemaining === undefined) return formatDuration(MIGRATION_TIME_SECONDS)

						return formatDuration(migrationTimeRemaining)
					})(),
				},
			]

		return (() => {
			if (selectedStage === 'auction')
				return [
					{ label: 'Started', value: startedDisplay },
					{ label: 'Ends', value: endsDisplay },
					{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
					{ label: 'Clearing Price', value: clearingPriceDisplay },
				]
			if (selectedStage === 'settlement')
				return [
					{ label: 'Finalized', value: finalizedDisplay },
					{ label: 'Underfunded', value: underfundedDisplay },
					{ label: 'Auctioned Allowance', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionedSecurityBondAllowance} suffix='ETH' /> },
					{ label: 'Claiming Available', value: claimingAvailableDisplay },
				]

			return initiateStatusMetrics
		})()
	})()
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<SectionBlock title={selectedStage === 'settlement' ? 'Settlement Overview' : 'Auction Overview'} description={truthAuctionNote}>
				<div className='truth-auction-hero'>
					<div className='truth-auction-hero-primary'>
						<div className='truth-auction-progress-group'>
							<div className='truth-auction-progress-copy'>
								<span>ETH Raised</span>
								<strong>
									<CurrencyValue value={truthAuctionStatus.ethRaised} suffix='ETH' /> / <CurrencyValue value={truthAuctionStatus.ethRaiseCap} suffix='ETH' />
								</strong>
							</div>
							<div className='truth-auction-progress-track'>
								<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
							</div>
						</div>
						<div className='truth-auction-progress-group'>
							<div className='truth-auction-progress-copy'>
								<span>REP Sold</span>
								<strong>
									<CurrencyValue value={truthAuctionStatus.totalRepPurchased} suffix='REP' /> / <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix='REP' />
								</strong>
							</div>
							<div className='truth-auction-progress-track'>
								<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
							</div>
						</div>
					</div>
					<div className='truth-auction-hero-grid'>
						<MetricField label='Clearing Tick'>{truthAuctionStatus.clearingTick?.toString() ?? UNKNOWN_VALUE}</MetricField>
						<MetricField label='Clearing Price'>{truthAuctionStatus.clearingPrice === undefined ? UNKNOWN_VALUE : <CurrencyValue value={truthAuctionStatus.clearingPrice} suffix='ETH / REP' />}</MetricField>
						<MetricField label='Min Bid'>{<CurrencyValue value={truthAuctionStatus.minBidSize} suffix='ETH' />}</MetricField>
						<MetricField label='Time Left'>{timeLeftDisplay}</MetricField>
						<MetricField label='Finalized'>{truthAuctionStatus.finalized ? 'Yes' : 'No'}</MetricField>
						<MetricField label='Underfunded'>{truthAuctionStatus.underfunded ? 'Yes' : 'No'}</MetricField>
						{winningThresholdPrice === undefined ? undefined : <MetricField label='Winning Threshold'>{<CurrencyValue value={winningThresholdPrice} suffix='ETH / REP' />}</MetricField>}
					</div>
				</div>
			</SectionBlock>
		)
	})()
	const truthAuctionOrderBookSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<SectionBlock title='Bid Ladder' description={selectedStage === 'settlement' ? 'Review price levels and the bids stacked at each level. Select a row to inspect the underlying bids.' : 'Bids are ordered from highest tick to lowest tick. Select a price level to inspect the bids stacked there.'}>
				{truthAuctionBookError === undefined ? undefined : <p className='detail truth-auction-book-error'>{truthAuctionBookError}</p>}
				<div className='truth-auction-book-layout'>
					<div className='truth-auction-ladder'>
						{loadingTruthAuctionBook ? <p className='detail'>Loading order book…</p> : undefined}
						{!loadingTruthAuctionBook && sortedTruthAuctionTicks.length === 0 ? <p className='detail'>No bids have been indexed onchain for this auction yet.</p> : undefined}
						{sortedTruthAuctionTicks.map(tickSummary => {
							const disposition = getTickDisposition(tickSummary, truthAuctionStatus)
							const isSelected = selectedBookTick === tickSummary.tick
							const isPreviewTick = enteredBidTick !== undefined && enteredBidTick === tickSummary.tick
							return (
								<button className={`truth-auction-price-row ${getTruthAuctionDispositionClassName(disposition.tone)}${isSelected ? ' is-selected' : ''}${isPreviewTick ? ' is-preview' : ''}`} key={tickSummary.tick.toString()} onClick={() => setSelectedBookTick(tickSummary.tick)} type='button'>
									<div className='truth-auction-price-row-bar' style={{ width: `${clampPercentage(tickSummary.currentTotalEth, maxTickEth)}%` }} />
									<div className='truth-auction-price-row-copy'>
										<div className='truth-auction-price-row-main'>
											<div>
												<strong>Tick {tickSummary.tick.toString()}</strong>
												<span className='truth-auction-price-row-price'>{<CurrencyValue value={tickSummary.price} suffix='ETH / REP' />}</span>
											</div>
											<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(disposition.tone)}`}>{disposition.label}</span>
										</div>
										<div className='truth-auction-price-row-meta'>
											<span>
												Current size <CurrencyValue value={tickSummary.currentTotalEth} suffix='ETH' />
											</span>
											<span>{tickSummary.submissionCount.toString()} submissions</span>
											{isPreviewTick ? <span>Current bid form tick</span> : undefined}
										</div>
									</div>
								</button>
							)
						})}
					</div>
					<div className='truth-auction-level-detail'>
						{selectedTickSummary === undefined ? (
							<p className='detail'>Select a price level to inspect the bids queued there.</p>
						) : (
							<>
								<div className='truth-auction-level-header'>
									<div>
										<h4>Selected Price Level</h4>
										<p className='detail'>
											Tick {selectedTickSummary.tick.toString()} at <CurrencyValue value={selectedTickSummary.price} suffix='ETH / REP' />
										</p>
									</div>
									{selectedStage !== 'settlement' ? (
										<button className='secondary' onClick={() => onForkAuctionFormChange({ submitBidTick: selectedTickSummary.tick.toString() })} type='button'>
											Use This Tick
										</button>
									) : undefined}
								</div>
								<div className='workflow-metric-grid'>
									<MetricField label='Live ETH'>{<CurrencyValue value={selectedTickSummary.currentTotalEth} suffix='ETH' />}</MetricField>
									<MetricField label='Historical Bids'>{selectedTickSummary.submissionCount.toString()}</MetricField>
									<MetricField label='Status'>{getTickDisposition(selectedTickSummary, truthAuctionStatus).label}</MetricField>
								</div>
								{loadingSelectedTickBids ? <p className='detail'>Loading bids at this price level…</p> : undefined}
								{!loadingSelectedTickBids && selectedTickBids.length === 0 ? <p className='detail'>No bids are currently indexed for this price level.</p> : undefined}
								<div className='truth-auction-bid-list'>
									{selectedTickBids.map(bid => {
										const disposition = getBidDisposition(bid, truthAuctionStatus)
										const isViewerBid = sameAddress(bid.bidder, accountState.address)
										return (
											<div className='truth-auction-bid-card' key={`${bid.tick.toString()}:${bid.bidIndex.toString()}`}>
												<div className='truth-auction-bid-card-header'>
													<div>
														<strong>Bid #{bid.bidIndex.toString()}</strong>
														<div className='truth-auction-bid-card-address'>
															<AddressValue address={bid.bidder} />
														</div>
													</div>
													<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(disposition.tone)}`}>{disposition.label}</span>
												</div>
												<div className='truth-auction-bid-card-metrics'>
													<span>
														Amount <CurrencyValue value={bid.ethAmount} suffix='ETH' />
													</span>
													<span>
														Cumulative <CurrencyValue value={bid.cumulativeEth} suffix='ETH' />
													</span>
												</div>
												{!isViewerBid ? undefined : (
													<div className='truth-auction-bid-card-actions'>
														{disposition.canPrefillRefund ? (
															<button
																className='secondary'
																onClick={() =>
																	onForkAuctionFormChange({
																		refundBidIndex: bid.bidIndex.toString(),
																		refundTick: bid.tick.toString(),
																	})
																}
																type='button'
															>
																Prefill Refund
															</button>
														) : undefined}
														{disposition.canPrefillClaim ? (
															<button
																className='secondary'
																onClick={() =>
																	onForkAuctionFormChange({
																		claimBidIndex: bid.bidIndex.toString(),
																		claimBidTick: bid.tick.toString(),
																	})
																}
																type='button'
															>
																Prefill Claim
															</button>
														) : undefined}
													</div>
												)}
											</div>
										)
									})}
								</div>
							</>
						)}
					</div>
				</div>
			</SectionBlock>
		)
	})()
	const viewerTruthAuctionBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<SectionBlock title='My Bids' description='Your submitted bids and their current status. Use the row shortcuts to prefill claim or refund inputs.'>
				{accountState.address === undefined ? <p className='detail'>Connect a wallet to inspect your submitted truth auction bids.</p> : undefined}
				{accountState.address !== undefined && loadingTruthAuctionBook ? <p className='detail'>Loading your bids…</p> : undefined}
				{accountState.address !== undefined && !loadingTruthAuctionBook && truthAuctionBookData.viewerBids.length === 0 ? <p className='detail'>No bids from this wallet are indexed for the current auction.</p> : undefined}
				<div className='truth-auction-bid-list'>
					{[...truthAuctionBookData.viewerBids].reverse().map(bid => {
						const disposition = getBidDisposition(bid, truthAuctionStatus)
						return (
							<div className='truth-auction-bid-card' key={`viewer:${bid.tick.toString()}:${bid.bidIndex.toString()}`}>
								<div className='truth-auction-bid-card-header'>
									<div>
										<strong>Tick {bid.tick.toString()}</strong>
										<div className='truth-auction-bid-card-address'>Bid #{bid.bidIndex.toString()}</div>
									</div>
									<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(disposition.tone)}`}>{disposition.label}</span>
								</div>
								<div className='truth-auction-bid-card-metrics'>
									<span>
										Price <CurrencyValue value={bid.price} suffix='ETH / REP' />
									</span>
									<span>
										Amount <CurrencyValue value={bid.ethAmount} suffix='ETH' />
									</span>
									<span>
										Cumulative <CurrencyValue value={bid.cumulativeEth} suffix='ETH' />
									</span>
								</div>
								<div className='truth-auction-bid-card-actions'>
									<button className='secondary' onClick={() => setSelectedBookTick(bid.tick)} type='button'>
										Show Price Level
									</button>
									{disposition.canPrefillRefund ? (
										<button
											className='secondary'
											onClick={() =>
												onForkAuctionFormChange({
													refundBidIndex: bid.bidIndex.toString(),
													refundTick: bid.tick.toString(),
												})
											}
											type='button'
										>
											Prefill Refund
										</button>
									) : undefined}
									{disposition.canPrefillClaim ? (
										<button
											className='secondary'
											onClick={() =>
												onForkAuctionFormChange({
													claimBidIndex: bid.bidIndex.toString(),
													claimBidTick: bid.tick.toString(),
												})
											}
											type='button'
										>
											Prefill Claim
										</button>
									) : undefined}
								</div>
							</div>
						)
					})}
				</div>
			</SectionBlock>
		)
	})()
	const stagePanel = (() => {
		if (selectedStage === 'initiate')
			return (
				<fieldset className='fork-stage-panel' disabled={disabled}>
					<SectionBlock title='Fork Trigger'>{renderWorkflowMetricGrid(initiateStatusMetrics)}</SectionBlock>

					<SectionBlock title='Fork With Own Escalation'>
						<div className='actions'>{renderStageActionButton({ action: 'forkWithOwnEscalation', idleLabel: 'Fork With Own Escalation', onClick: onForkWithOwnEscalation, pendingLabel: 'Forking with own escalation...', tone: 'primary' })}</div>
					</SectionBlock>

					<SectionBlock title='Initiate Pool Fork'>
						<div className='actions'>{renderStageActionButton({ action: 'initiateFork', idleLabel: 'Initiate Pool Fork', onClick: onInitiateFork, pendingLabel: 'Initiating pool fork...' })}</div>
					</SectionBlock>

					<SectionBlock title='Direct Universe Fork'>
						<div className='form-grid'>
							<div className='field-row'>
								<label className='field'>
									<span>Direct Fork Universe ID</span>
									<FormInput value={forkAuctionForm.directForkUniverseId} onInput={event => onForkAuctionFormChange({ directForkUniverseId: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Direct Fork Question ID</span>
									<FormInput value={forkAuctionForm.directForkQuestionId} onInput={event => onForkAuctionFormChange({ directForkQuestionId: event.currentTarget.value })} placeholder='0x...' />
								</label>
							</div>
							<div className='actions'>{renderStageActionButton({ action: 'forkUniverse', idleLabel: 'Fork Universe Directly', onClick: onForkUniverse, pendingLabel: 'Forking universe directly...' })}</div>
						</div>
					</SectionBlock>
				</fieldset>
			)
		if (selectedStage === 'migration')
			return (
				<fieldset className='fork-stage-panel' disabled={disabled}>
					<SectionBlock title='Migration Status'>{renderWorkflowMetricGrid(migrationStatusMetrics)}</SectionBlock>

					<SectionBlock title='Create Child Universe'>
						<div className='form-grid'>
							<label className='field'>
								<span>Outcome</span>
								<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
							</label>
							<ActionLauncherCard action={createChildUniverseLauncherAction}>
								<p className='detail'>Selected outcome: {getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)}</p>
							</ActionLauncherCard>
						</div>
					</SectionBlock>

					<SectionBlock title='Migrate REP'>
						<div className='form-grid'>
							<label className='field'>
								<span>REP Migration Outcomes</span>
								<FormInput value={forkAuctionForm.repMigrationOutcomes} onInput={event => onForkAuctionFormChange({ repMigrationOutcomes: event.currentTarget.value })} placeholder='yes,no,invalid' />
							</label>
							<div className='actions'>{renderStageActionButton({ action: 'migrateRepToZoltar', idleLabel: 'Migrate REP To Zoltar', onClick: onMigrateRepToZoltar, pendingLabel: 'Migrating REP to Zoltar...' })}</div>
						</div>
					</SectionBlock>

					<SectionBlock title='Migrate Vault'>
						<div className='form-grid'>
							<label className='field'>
								<span>Outcome</span>
								<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
							</label>
							<label className='field'>
								<span>Vault Address</span>
								<FormInput value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
							</label>
							<div className='actions'>{renderStageActionButton({ action: 'migrateVault', idleLabel: 'Migrate Vault', onClick: onMigrateVault, pendingLabel: 'Migrating vault...', tone: 'primary' })}</div>
						</div>
					</SectionBlock>

					<SectionBlock title='Migrate Escalation Deposits'>
						<div className='form-grid'>
							<label className='field'>
								<span>Outcome</span>
								<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
							</label>
							<label className='field'>
								<span>Escalation Deposit Indexes</span>
								<FormInput value={forkAuctionForm.depositIndexes} onInput={event => onForkAuctionFormChange({ depositIndexes: event.currentTarget.value })} placeholder='0,1,2' />
							</label>
							<div className='actions'>{renderStageActionButton({ action: 'migrateEscalationDeposits', idleLabel: 'Migrate Escalation Deposits', onClick: onMigrateEscalationDeposits, pendingLabel: 'Migrating escalation deposits...' })}</div>
						</div>
					</SectionBlock>
				</fieldset>
			)

		return (() => {
			if (selectedStage === 'auction') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset className='fork-stage-panel' disabled={disabled}>
							{truthAuctionHero}
							{truthAuctionOrderBookSection}
							{viewerTruthAuctionBidsSection}
							<SectionBlock title='Submit Bid' description='Enter the tick and ETH amount you want to place into the auction. The ladder above can prefill a tick directly into this form.'>
								<div className='form-grid'>
									<div className='field-row'>
										<label className='field'>
											<span>Bid Tick</span>
											<FormInput value={forkAuctionForm.submitBidTick} onInput={event => onForkAuctionFormChange({ submitBidTick: event.currentTarget.value })} />
										</label>
										<label className='field'>
											<span>Bid Amount (ETH)</span>
											<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
										</label>
									</div>
									{selectedAuctionPrice === undefined ? undefined : <p className='detail'>At the current clearing price, this bid would buy roughly {estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix='REP' />} if it clears.</p>}
									<div className='actions'>
										{renderStageActionButton({
											action: 'submitBid',
											availability: createActionAvailability(truthAuctionBidGuardMessage),
											idleLabel: 'Submit Bid',
											onClick: onSubmitBid,
											pendingLabel: 'Submitting bid...',
										})}
									</div>
								</div>
							</SectionBlock>
						</fieldset>
					)
				return (
					<fieldset className='fork-stage-panel' disabled={disabled}>
						<SectionBlock title='Auction Status'>{renderWorkflowMetricGrid(auctionStatusMetrics)}</SectionBlock>

						<SectionBlock title='Start Truth Auction'>
							<div className='actions'>{renderStageActionButton({ action: 'startTruthAuction', idleLabel: 'Start Truth Auction', onClick: onStartTruthAuction, pendingLabel: 'Starting truth auction...', tone: 'primary' })}</div>
						</SectionBlock>

						<SectionBlock title='Submit Bid'>
							<div className='form-grid'>
								<label className='field'>
									<span>Bid Tick</span>
									<FormInput value={forkAuctionForm.submitBidTick} onInput={event => onForkAuctionFormChange({ submitBidTick: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Bid Amount (ETH)</span>
									<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
								</label>
								{selectedAuctionPrice === undefined ? undefined : <p className='detail'>At the current clearing price, this bid would buy roughly {estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix='REP' />} if it clears.</p>}
								<div className='actions'>
									{renderStageActionButton({
										action: 'submitBid',
										availability: createActionAvailability(truthAuctionBidGuardMessage),
										idleLabel: 'Submit Bid',
										onClick: onSubmitBid,
										pendingLabel: 'Submitting bid...',
									})}
								</div>
							</div>
						</SectionBlock>
					</fieldset>
				)
			}
			if (selectedStage === 'settlement') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset className='fork-stage-panel' disabled={disabled}>
							{truthAuctionHero}
							{viewerTruthAuctionBidsSection}
							{truthAuctionOrderBookSection}
							{truthAuctionStatus?.finalized ? undefined : (
								<SectionBlock title='Finalize Truth Auction' description='Finalize the auction once bidding has closed so vault claims can settle against the final clearing result.'>
									<div className='actions'>{renderStageActionButton({ action: 'finalizeTruthAuction', idleLabel: 'Finalize Truth Auction', onClick: onFinalizeTruthAuction, pendingLabel: 'Finalizing truth auction...' })}</div>
								</SectionBlock>
							)}
							<ReadOnlyDetailAccordion defaultOpen={false} title='Manual Settlement Tools'>
								<div className='truth-auction-manual-tools'>
									<p className='detail'>Keep these raw controls for manual settlement and operator workflows. Direct `withdrawBids` remains owner-only on the auction contract.</p>
									<SectionBlock title='Refund Losing Bid'>
										<div className='form-grid'>
											<div className='field-row'>
												<label className='field'>
													<span>Refund Tick</span>
													<FormInput value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
												</label>
												<label className='field'>
													<span>Refund Bid Index</span>
													<FormInput value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
												</label>
											</div>
											<div className='actions'>{renderStageActionButton({ action: 'refundLosingBids', idleLabel: 'Refund Losing Bid', onClick: onRefundLosingBids, pendingLabel: 'Refunding losing bid...', tone: 'primary' })}</div>
										</div>
									</SectionBlock>
									<SectionBlock title='Claim Auction Proceeds'>
										<div className='form-grid'>
											<label className='field'>
												<span>Vault Address</span>
												<FormInput value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
											</label>
											<div className='field-row'>
												<label className='field'>
													<span>Claim Bid Tick</span>
													<FormInput value={forkAuctionForm.claimBidTick} onInput={event => onForkAuctionFormChange({ claimBidTick: event.currentTarget.value })} />
												</label>
												<label className='field'>
													<span>Claim Bid Index</span>
													<FormInput value={forkAuctionForm.claimBidIndex} onInput={event => onForkAuctionFormChange({ claimBidIndex: event.currentTarget.value })} />
												</label>
											</div>
											<div className='actions'>{renderStageActionButton({ action: 'claimAuctionProceeds', idleLabel: 'Claim Auction Proceeds', onClick: onClaimAuctionProceeds, pendingLabel: 'Claiming auction proceeds...', tone: 'primary' })}</div>
										</div>
									</SectionBlock>
									<SectionBlock title='Withdraw Bids'>
										<div className='form-grid'>
											<div className='field-row'>
												<label className='field'>
													<span>Withdraw For Address</span>
													<FormInput value={forkAuctionForm.withdrawForAddress} onInput={event => onForkAuctionFormChange({ withdrawForAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
												</label>
												<label className='field'>
													<span>Withdraw Tick</span>
													<FormInput value={forkAuctionForm.withdrawTick} onInput={event => onForkAuctionFormChange({ withdrawTick: event.currentTarget.value })} />
												</label>
											</div>
											<label className='field'>
												<span>Withdraw Bid Index</span>
												<FormInput value={forkAuctionForm.withdrawBidIndex} onInput={event => onForkAuctionFormChange({ withdrawBidIndex: event.currentTarget.value })} />
											</label>
											<div className='actions'>{renderStageActionButton({ action: 'withdrawBids', idleLabel: 'Withdraw Bids', onClick: onWithdrawBids, pendingLabel: 'Withdrawing bids...' })}</div>
										</div>
									</SectionBlock>
								</div>
							</ReadOnlyDetailAccordion>
						</fieldset>
					)
				return (
					<fieldset className='fork-stage-panel' disabled={disabled}>
						<SectionBlock title='Settlement Status'>{renderWorkflowMetricGrid(settlementStatusMetrics)}</SectionBlock>

						<SectionBlock title='Finalize Truth Auction'>
							<div className='actions'>{renderStageActionButton({ action: 'finalizeTruthAuction', idleLabel: 'Finalize Truth Auction', onClick: onFinalizeTruthAuction, pendingLabel: 'Finalizing truth auction...' })}</div>
						</SectionBlock>

						<SectionBlock title='Refund Losing Bid'>
							<div className='form-grid'>
								<label className='field'>
									<span>Refund Tick</span>
									<FormInput value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Refund Bid Index</span>
									<FormInput value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
								</label>
								<div className='actions'>{renderStageActionButton({ action: 'refundLosingBids', idleLabel: 'Refund Losing Bid', onClick: onRefundLosingBids, pendingLabel: 'Refunding losing bid...', tone: 'primary' })}</div>
							</div>
						</SectionBlock>

						<SectionBlock title='Claim Auction Proceeds'>
							<div className='form-grid'>
								<label className='field'>
									<span>Vault Address</span>
									<FormInput value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
								</label>
								<div className='field-row'>
									<label className='field'>
										<span>Claim Bid Tick</span>
										<FormInput value={forkAuctionForm.claimBidTick} onInput={event => onForkAuctionFormChange({ claimBidTick: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Claim Bid Index</span>
										<FormInput value={forkAuctionForm.claimBidIndex} onInput={event => onForkAuctionFormChange({ claimBidIndex: event.currentTarget.value })} />
									</label>
								</div>
								<div className='actions'>{renderStageActionButton({ action: 'claimAuctionProceeds', idleLabel: 'Claim Auction Proceeds', onClick: onClaimAuctionProceeds, pendingLabel: 'Claiming auction proceeds...', tone: 'primary' })}</div>
							</div>
						</SectionBlock>

						<SectionBlock title='Withdraw Bids'>
							<div className='form-grid'>
								<div className='field-row'>
									<label className='field'>
										<span>Withdraw For Address</span>
										<FormInput value={forkAuctionForm.withdrawForAddress} onInput={event => onForkAuctionFormChange({ withdrawForAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
									</label>
									<label className='field'>
										<span>Withdraw Tick</span>
										<FormInput value={forkAuctionForm.withdrawTick} onInput={event => onForkAuctionFormChange({ withdrawTick: event.currentTarget.value })} />
									</label>
								</div>
								<label className='field'>
									<span>Withdraw Bid Index</span>
									<FormInput value={forkAuctionForm.withdrawBidIndex} onInput={event => onForkAuctionFormChange({ withdrawBidIndex: event.currentTarget.value })} />
								</label>
								<div className='actions'>{renderStageActionButton({ action: 'withdrawBids', idleLabel: 'Withdraw Bids', onClick: onWithdrawBids, pendingLabel: 'Withdrawing bids...' })}</div>
							</div>
						</SectionBlock>
					</fieldset>
				)
			}

			return undefined
		})()
	})()
	const content = (
		<>
			{showSecurityPoolAddressInput ? (
				<ReadOnlyDetailAccordion title='Pool Context'>
					<div className='form-grid'>
						<LookupFieldRow
							label='Security Pool Address'
							value={forkAuctionForm.securityPoolAddress}
							onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })}
							placeholder='0x...'
							action={
								<button className='secondary' onClick={onLoadForkAuction} disabled={loadingForkAuctionDetails}>
									{loadingForkAuctionDetails ? <LoadingText>Loading fork...</LoadingText> : 'Refresh fork'}
								</button>
							}
						/>

						{hasLoadedPoolContext ? renderSummaryMetricGrid(poolSummaryMetrics) : <p className='detail'>Load a pool to inspect fork progress, migration, and the truth auction.</p>}
						{disabledMessage === undefined ? undefined : <p className='detail'>{disabledMessage}</p>}
						{forkStageDescription === undefined ? undefined : <p className='detail'>{forkStageDescription}</p>}
					</div>
				</ReadOnlyDetailAccordion>
			) : undefined}

			{hasLoadedPoolContext ? <ReadOnlyDetailAccordion title='Live Snapshot'>{renderSummaryMetricGrid(liveSnapshotMetrics)}</ReadOnlyDetailAccordion> : undefined}

			<WorkflowTransactionStatus latestAction={latestForkAuctionAction} outcome={undefined} />
			{hasLoadedPoolContext ? (
				<SectionBlock title='Lifecycle'>
					<ViewTabs
						ariaLabel='Fork lifecycle stages'
						value={selectedStage}
						onChange={setSelectedStage}
						options={STAGE_VIEWS.map(stageView => ({
							label: getStageLabel(stageView),
							value: stageView,
						}))}
					/>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
				</SectionBlock>
			) : undefined}

			{hasLoadedPoolContext ? stagePanel : undefined}

			<ChildUniverseDeploymentModal
				actionAvailability={{
					disabled: !createChildUniverseEnabled || interactionDisabledReason !== undefined,
					reason: createChildUniverseEnabled ? interactionDisabledReason : undefined,
				}}
				description='Confirm the selected fork outcome and create its child universe in one bounded transaction flow.'
				idleLabel={`Create ${getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe`}
				isOpen={childUniverseModalOpen}
				onClose={() => setChildUniverseModalOpen(false)}
				onConfirm={onCreateChildUniverse}
				pending={forkAuctionActiveAction === 'createChildUniverse'}
				pendingLabel='Creating child universe...'
				requirements={childUniverseRequirements}
				title='Create Child Universe'
				tone='primary'
			>
				<SectionBlock headingLevel={4} title='Child Universe Context' variant='embedded'>
					<div className='workflow-metric-grid'>
						<MetricField label='Selected Outcome'>{getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)}</MetricField>
						<MetricField label='Pool'>{securityPoolAddress === undefined ? UNKNOWN_VALUE : <AddressValue address={securityPoolAddress} />}</MetricField>
						<MetricField label='Universe'>{universeId === undefined ? UNKNOWN_VALUE : <UniverseLink universeId={universeId} />}</MetricField>
						<MetricField label='Stage'>{getStageLabel(currentStage)}</MetricField>
					</div>
				</SectionBlock>
			</ChildUniverseDeploymentModal>

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
