import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { type Address, isAddress, zeroAddress } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { MetricField } from './MetricField.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TimestampValue } from './TimestampValue.js'
import { TruthAuctionDepthChart, type TruthAuctionDepthPoint } from './TruthAuctionDepthChart.js'
import { UniverseLink } from './UniverseLink.js'
import { WorkflowTransactionStatus } from './WorkflowTransactionStatus.js'
import { loadAllSecurityPools, loadForkAuctionDetails, loadForkOutcomeMigrationSeedStatus, loadTruthAuctionActiveTickPage, loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage } from '../contracts.js'
import { createActionAvailability } from '../lib/actionAvailability.js'
import { sameAddress } from '../lib/address.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import {
	AUCTION_TIME_SECONDS,
	estimateRepPurchased,
	getForkAuctionStageLabel,
	getForkAuctionStageOrder,
	getForkAuctionStageView,
	getTimeRemaining,
	getTruthAuctionBidGuardMessage,
	getTruthAuctionPriceAtTick,
	getTruthAuctionTickAtPrice,
	TRUTH_AUCTION_PRICE_PRECISION,
	type ForkAuctionStageView,
} from '../lib/forkAuction.js'
import { formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { tryParseBigIntInput, tryParseTruthAuctionAmountInput, tryParseTruthAuctionPriceInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { getEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import type { ForkAuctionActionResult, ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = '-'
const TRUTH_AUCTION_TICK_PAGE_SIZE = 25
const TRUTH_AUCTION_BID_PAGE_SIZE = 25
type DisplayMetric = {
	label: string
	value: ComponentChildren
}
type TruthAuctionDisposition = {
	label: string
	tone: 'default' | 'danger' | 'success' | 'warning'
}

type TruthAuctionFinalizedSettlementKind = 'ethRefund' | 'none' | 'repClaim'

type TruthAuctionBidSummaryKind = 'losing' | 'neutral' | 'partial' | 'refundable' | 'refunded' | 'repClaimable' | 'winning'

type TruthAuctionBidDisposition = TruthAuctionDisposition & {
	canPrefillRefund: boolean
	canPrefillSettle: boolean
	settlementKind: TruthAuctionFinalizedSettlementKind
	summaryKind: TruthAuctionBidSummaryKind
}

type TruthAuctionBookData = {
	tickSummaries: TruthAuctionTickSummary[]
	tickCount: bigint
	viewerBids: TruthAuctionBidView[]
	viewerBidCount: bigint
}

type TruthAuctionViewerBidSummary = {
	refundableCount: number
	partialCount: number
	refundedCount: number
	repClaimableCount: number
	winningCount: number
}

type TruthAuctionSelectedBidSummary = {
	bid: TruthAuctionBidView
	disposition: TruthAuctionBidDisposition
	price: bigint
}

type TruthAuctionStateBadge = {
	label: string
	tone: 'blocked' | 'muted' | 'ok' | 'pending'
}

type ForkOutcomeMigrationSeedStatus = Awaited<ReturnType<typeof loadForkOutcomeMigrationSeedStatus>>

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
	if (previewPool.truthAuctionStartedAt > 0n) return 'Started/finished'
	return UNKNOWN_VALUE
}
function humanizeForkAuctionAction(actionName: ForkAuctionActionResult['action']) {
	return actionName.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase())
}

function getForkAuctionActionLabel(actionName: ForkAuctionActionResult['action']) {
	if (actionName === 'claimAuctionProceeds') return 'Settle Finalized Bid'
	return humanizeForkAuctionAction(actionName)
}

function getForkAuctionOutcomePresentation(result: ForkAuctionActionResult | undefined) {
	if (result === undefined) return undefined

	const dismissKey = `${result.action}:${result.hash}:outcome`
	switch (result.action) {
		case 'migrateVault':
			return {
				detail: 'Parent-pool REP collateral and security bond allowance were migrated into the selected child universe.',
				dismissKey,
				nextStep: 'Open the child-universe pool to inspect the migrated vault balances.',
				title: 'Vault Migrated',
			}
		case 'migrateEscalationDeposits':
			return {
				detail: 'Locked escalation REP was migrated into the selected child universe.',
				dismissKey,
				nextStep: 'Refresh the child-universe pool to inspect the migrated balances.',
				title: 'Escalation Deposits Migrated',
			}
		case 'migrateRepToZoltar':
			return {
				detail: 'Parent-pool REP was migrated into the selected child outcomes.',
				dismissKey,
				nextStep: 'Open the target child pool to inspect the updated migration balance.',
				title: 'Pool REP Migrated',
			}
		case 'createChildUniverse':
			return {
				detail: 'The selected child universe pool was created.',
				dismissKey,
				nextStep: 'Continue with vault or pool REP migration for that outcome.',
				title: 'Child Universe Created',
			}
		case 'startTruthAuction':
			return {
				detail: 'The truth auction was started for this child pool.',
				dismissKey,
				nextStep: 'Review the order book and submit bids as needed.',
				title: 'Truth Auction Started',
			}
		case 'submitBid':
			return {
				detail: 'Your truth auction bid was submitted.',
				dismissKey,
				nextStep: 'Watch the order book and settlement state before your next bid.',
				title: 'Bid Submitted',
			}
		case 'finalizeTruthAuction':
			return {
				detail: 'The truth auction was finalized.',
				dismissKey,
				nextStep: 'Review refundable bids and settle finalized positions.',
				title: 'Truth Auction Finalized',
			}
		case 'refundLosingBids':
			return {
				detail: 'The selected losing bid refund was submitted.',
				dismissKey,
				nextStep: 'Review your remaining auction bids and settlement actions.',
				title: 'Losing Bid Refunded',
			}
		case 'claimAuctionProceeds':
			return {
				detail: 'Finalized truth auction proceeds were settled for the selected bid.',
				dismissKey,
				nextStep: 'Review the updated vault and bid state before further settlement actions.',
				title: 'Finalized Bid Settled',
			}
		default:
			return {
				detail: `${getForkAuctionActionLabel(result.action)} was submitted.`,
				dismissKey,
				title: `${getForkAuctionActionLabel(result.action)} Submitted`,
			}
	}
}

function getStageAheadMessage(stage: ForkAuctionStageView, currentStage: ForkAuctionStageView) {
	if (getForkAuctionStageOrder(stage) <= getForkAuctionStageOrder(currentStage)) return undefined
	if (currentStage === 'initiate') return undefined
	const currentStageText = `in ${getForkAuctionStageLabel(currentStage)}`
	switch (stage) {
		case 'migration':
			return `This pool is currently ${currentStageText}. Migration controls become meaningful once the pool has forked.`
		case 'auction':
			return undefined
		case 'settlement':
			return `This pool is currently ${currentStageText}. Settlement controls become meaningful after bidding progresses or the truth auction finalizes.`
		case 'initiate':
			return undefined
		default:
			return undefined
	}
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
function estimateBidRep(bidAmount: string, bidPrice: bigint | undefined) {
	if (bidPrice === undefined) return undefined
	const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseTruthAuctionAmountInput(bidAmount)
	if (parsedBidAmount === undefined) return undefined
	return estimateRepPurchased(parsedBidAmount, bidPrice)
}
function parseOptionalBigInt(value: string) {
	const trimmedValue = value.trim()
	if (trimmedValue === '') return undefined
	return tryParseBigIntInput(trimmedValue)
}

function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return 'Migration timing is unavailable.'
	if (currentTimestamp === undefined) return 'Loading current chain time.'
	if (currentTimestamp <= migrationEndsAt) return 'Migration is still active. Truth auction can start once migration ends.'
	return undefined
}

function getTruthAuctionBypassReason({ migratedRep, parentCollateralAmount, repAtFork }: { migratedRep: bigint; parentCollateralAmount: bigint | undefined; repAtFork: bigint | undefined }) {
	if (parentCollateralAmount === 0n) return 'No parent collateral remains to auction, so this step immediately bypasses bidding and finalizes the child pool.'
	if (repAtFork === undefined) return undefined
	if (repAtFork === 0n) return 'No REP was present at fork, so no truth auction is needed for this child universe.'
	if (migratedRep >= repAtFork) return 'This child universe already has all REP migrated from the parent pool, so no truth auction is needed.'
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

function getRefundTruthAuctionBidGuardMessage({ refundBidIndexInput, refundTickInput, truthAuction }: { refundBidIndexInput: string; refundTickInput: string; truthAuction: TruthAuctionMetrics | undefined }) {
	if (truthAuction === undefined) return 'Load the truth auction before refunding bids.'
	if (truthAuction.finalized) return 'Refunds are only available before finalization.'
	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined) return 'Losing bids cannot be refunded until the auction has a clearing tick.'
	if (parseOptionalBigInt(refundTickInput) === undefined) return 'Enter a valid refund tick.'
	if (parseOptionalBigInt(refundBidIndexInput) === undefined) return 'Enter a valid refund bid index.'
	return undefined
}

function getSettleFinalizedTruthAuctionBidGuardMessage({
	claimBidIndexInput,
	claimBidTickInput,
	claimingAvailable,
	settlementAddressInput,
	truthAuction,
}: {
	claimBidIndexInput: string
	claimBidTickInput: string
	claimingAvailable: boolean
	settlementAddressInput: string
	truthAuction: TruthAuctionMetrics | undefined
}) {
	if (truthAuction === undefined) return 'Load the truth auction before settling finalized bids.'
	if (!truthAuction.finalized) return 'Finalized settlement becomes available after the truth auction is finalized.'
	if (!claimingAvailable) return 'Finalized settlement is not yet available for this pool.'
	if (parseOptionalBigInt(claimBidTickInput) === undefined) return 'Enter a valid settlement bid tick.'
	if (parseOptionalBigInt(claimBidIndexInput) === undefined) return 'Enter a valid settlement bid index.'
	const trimmedSettlementAddress = settlementAddressInput.trim()
	if (trimmedSettlementAddress !== '' && !isAddress(trimmedSettlementAddress)) return 'Enter a valid bidder address.'
	return undefined
}

function clampPercentage(value: bigint, maxValue: bigint) {
	if (value <= 0n || maxValue <= 0n) return 0
	const boundedValue = value > maxValue ? maxValue : value
	return Number((boundedValue * 10000n) / maxValue) / 100
}

function getTruthAuctionWinningThresholdPrice(truthAuction: TruthAuctionMetrics | undefined) {
	if (truthAuction === undefined || !truthAuction.finalized || !truthAuction.underfunded || truthAuction.maxRepBeingSold === 0n) return undefined
	return (truthAuction.ethRaised * TRUTH_AUCTION_PRICE_PRECISION) / truthAuction.maxRepBeingSold
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
	if (bid.refunded) return { label: 'Refunded', tone: 'default', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refunded' }
	if (truthAuction === undefined) {
		if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'none', summaryKind: 'neutral' }
		return { label: 'Pending', tone: 'default', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'none', summaryKind: 'neutral' }
	}

	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	if (winningThresholdPrice !== undefined) {
		if (getTruthAuctionPriceAtTick(bid.tick) >= winningThresholdPrice) {
			if (truthAuction.finalized) {
				if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'repClaim', summaryKind: 'neutral' }
				return { label: 'Winning', tone: 'success', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'winning' }
			}
			return {
				label: 'Provisional',
				tone: 'warning',
				canPrefillRefund: false,
				canPrefillSettle: false,
				settlementKind: 'none',
				summaryKind: 'neutral',
			}
		}
		if (truthAuction.finalized) {
			if (bid.claimed) return { label: 'Refunded', tone: 'default', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refunded' }
			return { label: 'Refundable', tone: 'danger', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'ethRefund', summaryKind: 'refundable' }
		}
		return {
			label: 'In Book',
			tone: 'default',
			canPrefillRefund: false,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'neutral',
		}
	}

	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		if (truthAuction.finalized) {
			if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'repClaim', summaryKind: 'neutral' }
			return { label: 'Winning', tone: 'success', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'winning' }
		}
		return {
			label: 'In Book',
			tone: 'default',
			canPrefillRefund: false,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'neutral',
		}
	}

	if (bid.tick > truthAuction.clearingTick) {
		if (truthAuction.finalized) {
			if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'repClaim', summaryKind: 'neutral' }
			return { label: 'Winning', tone: 'success', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'winning' }
		}
		return {
			label: 'Above Clearing',
			tone: 'warning',
			canPrefillRefund: false,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'neutral',
		}
	}
	if (bid.tick < truthAuction.clearingTick) {
		if (truthAuction.finalized) {
			if (bid.claimed) return { label: 'Refunded', tone: 'default', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refunded' }
			return { label: 'Refundable', tone: 'danger', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'ethRefund', summaryKind: 'refundable' }
		}
		return {
			label: 'Below Clearing',
			tone: 'danger',
			canPrefillRefund: !truthAuction.finalized,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'losing',
		}
	}

	const previousCumulativeEth = bid.activeCumulativeEthBeforeBid
	const activeCumulativeEth = previousCumulativeEth + bid.ethAmount
	if (truthAuction.ethAtClearingTick <= previousCumulativeEth) {
		if (truthAuction.finalized) {
			if (bid.claimed) return { label: 'Refunded', tone: 'default', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refunded' }
			return { label: 'Refundable', tone: 'danger', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'ethRefund', summaryKind: 'refundable' }
		}
		return {
			label: 'Below Clearing',
			tone: 'danger',
			canPrefillRefund: true,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'losing',
		}
	}
	if (truthAuction.ethAtClearingTick >= activeCumulativeEth) {
		if (truthAuction.finalized) {
			if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'repClaim', summaryKind: 'neutral' }
			return { label: 'Winning', tone: 'success', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'winning' }
		}
		return {
			label: 'At Clearing',
			tone: 'warning',
			canPrefillRefund: false,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'neutral',
		}
	}
	if (truthAuction.finalized) {
		if (bid.claimed) return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'repClaim', summaryKind: 'neutral' }
		return { label: 'Partial', tone: 'warning', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'partial' }
	}
	return {
		label: 'At Clearing',
		tone: 'warning',
		canPrefillRefund: false,
		canPrefillSettle: false,
		settlementKind: 'none',
		summaryKind: 'neutral',
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

function sortTruthAuctionTickSummariesDescending(tickSummaries: TruthAuctionTickSummary[]) {
	return [...tickSummaries].sort((left, right) => {
		if (left.tick === right.tick) return 0
		return left.tick > right.tick ? -1 : 1
	})
}

function buildTruthAuctionDepthPoints({ enteredBidTick, selectedBookTick, tickSummaries, truthAuction }: { enteredBidTick: bigint | undefined; selectedBookTick: bigint | undefined; tickSummaries: TruthAuctionTickSummary[]; truthAuction: TruthAuctionMetrics | undefined }): TruthAuctionDepthPoint[] {
	let cumulativeEth = 0n

	return tickSummaries
		.filter(tickSummary => tickSummary.active || tickSummary.currentTotalEth > 0n)
		.map(tickSummary => {
			cumulativeEth += tickSummary.currentTotalEth
			return {
				tick: tickSummary.tick,
				price: tickSummary.price,
				currentTotalEth: tickSummary.currentTotalEth,
				cumulativeEth,
				disposition: getTickDisposition(tickSummary, truthAuction),
				isSelected: selectedBookTick === tickSummary.tick,
				isPreviewTick: enteredBidTick !== undefined && enteredBidTick === tickSummary.tick,
			}
		})
}

function getTruthAuctionOverviewProgress(truthAuction: TruthAuctionMetrics | undefined, tickSummaries: TruthAuctionTickSummary[]) {
	if (truthAuction === undefined) return undefined
	if (truthAuction.finalized) {
		return {
			ethRaised: truthAuction.ethRaised,
			repSold: truthAuction.totalRepPurchased,
		}
	}

	const activeTickSummaries = sortTruthAuctionTickSummariesDescending(tickSummaries).filter(tickSummary => tickSummary.currentTotalEth > 0n)
	if (activeTickSummaries.length === 0) {
		return {
			ethRaised: truthAuction.ethRaised,
			repSold: truthAuction.totalRepPurchased,
		}
	}

	let provisionalEthRaised = 0n
	let provisionalRepSold = 0n

	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		for (const tickSummary of activeTickSummaries) {
			provisionalEthRaised += tickSummary.currentTotalEth
			provisionalRepSold += estimateRepPurchased(tickSummary.currentTotalEth, tickSummary.price)
		}
	} else {
		let remainingCap = truthAuction.ethRaiseCap
		for (const tickSummary of activeTickSummaries) {
			if (remainingCap <= 0n) break

			let acceptedEth = 0n
			if (tickSummary.tick > truthAuction.clearingTick) acceptedEth = tickSummary.currentTotalEth
			else if (tickSummary.tick === truthAuction.clearingTick) acceptedEth = truthAuction.ethAtClearingTick < tickSummary.currentTotalEth ? truthAuction.ethAtClearingTick : tickSummary.currentTotalEth

			if (acceptedEth <= 0n) continue
			if (acceptedEth > remainingCap) acceptedEth = remainingCap

			provisionalEthRaised += acceptedEth
			provisionalRepSold += estimateRepPurchased(acceptedEth, tickSummary.price)
			remainingCap -= acceptedEth
		}
	}

	const ethRaised = provisionalEthRaised > truthAuction.ethRaiseCap ? truthAuction.ethRaiseCap : provisionalEthRaised
	const repSold = provisionalRepSold > truthAuction.maxRepBeingSold ? truthAuction.maxRepBeingSold : provisionalRepSold

	return {
		ethRaised,
		repSold,
	}
}

function summarizeViewerTruthAuctionBids(viewerBids: TruthAuctionBidView[], truthAuction: TruthAuctionMetrics | undefined): TruthAuctionViewerBidSummary {
	return viewerBids.reduce<TruthAuctionViewerBidSummary>(
		(summary, bid) => {
			const disposition = getBidDisposition(bid, truthAuction)

			if (disposition.summaryKind === 'refunded') {
				summary.refundedCount += 1
				return summary
			}
			if (disposition.summaryKind === 'winning') {
				summary.winningCount += 1
			} else if (disposition.summaryKind === 'partial') {
				summary.partialCount += 1
			} else if (disposition.summaryKind === 'losing' || disposition.summaryKind === 'refundable') {
				summary.refundableCount += 1
			}
			if (disposition.canPrefillSettle && disposition.settlementKind === 'repClaim') summary.repClaimableCount += 1

			return summary
		},
		{
			partialCount: 0,
			refundableCount: 0,
			refundedCount: 0,
			repClaimableCount: 0,
			winningCount: 0,
		},
	)
}

async function loadTruthAuctionActiveTickPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, pageCount: number) {
	const tickSummaries: TruthAuctionTickSummary[] = []
	let tickCount = 0n
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
		const page = await loadTruthAuctionActiveTickPage(client, truthAuctionAddress, pageIndex, TRUTH_AUCTION_TICK_PAGE_SIZE)
		tickCount = page.tickCount
		tickSummaries.push(...page.ticks)
		if (BigInt(tickSummaries.length) >= tickCount || page.ticks.length === 0) break
	}
	return {
		tickCount,
		tickSummaries,
	}
}

async function loadTruthAuctionTickBidPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tick: bigint, pageCount: number) {
	const bids: TruthAuctionBidView[] = []
	let bidCount = 0n
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
		const page = await loadTruthAuctionTickBidPage(client, truthAuctionAddress, tick, pageIndex, TRUTH_AUCTION_BID_PAGE_SIZE)
		bidCount = page.bidCount
		bids.push(...page.bids)
		if (BigInt(bids.length) >= bidCount || page.bids.length === 0) break
	}
	return {
		bidCount,
		bids,
	}
}

async function loadTruthAuctionBidderBidPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, bidder: Address, pageCount: number) {
	const bids: TruthAuctionBidView[] = []
	let bidCount = 0n
	for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
		const page = await loadTruthAuctionBidderBidPage(client, truthAuctionAddress, bidder, pageIndex, TRUTH_AUCTION_BID_PAGE_SIZE)
		bidCount = page.bidCount
		bids.push(...page.bids)
		if (BigInt(bids.length) >= bidCount || page.bids.length === 0) break
	}
	return {
		bidCount,
		bids,
	}
}

function sortTruthAuctionBidsByPriority(bids: TruthAuctionBidView[]) {
	return [...bids].sort((left, right) => {
		if (left.tick !== right.tick) return left.tick > right.tick ? -1 : 1
		if (left.bidIndex !== right.bidIndex) return left.bidIndex < right.bidIndex ? -1 : 1
		return 0
	})
}

function dedupeTruthAuctionBids(bids: TruthAuctionBidView[]) {
	return sortTruthAuctionBidsByPriority(Array.from(new Map(bids.map(bid => [`${bid.tick.toString()}:${bid.bidIndex.toString()}`, bid])).values()))
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

async function loadAggregatedTruthAuctionBidPages(client: Pick<ReadClient, 'readContract'>, truthAuctionAddress: Address, tickSummaries: TruthAuctionTickSummary[], pageCount: number) {
	const uniqueTickSummaries = sortTruthAuctionTickSummariesDescending(Array.from(new Map(tickSummaries.map(tickSummary => [tickSummary.tick.toString(), tickSummary])).values()))
	const bidPages = await Promise.all(uniqueTickSummaries.map(async tickSummary => ({ bidData: await loadTruthAuctionTickBidPages(client, truthAuctionAddress, tickSummary.tick, pageCount), tickSummary })))
	const dedupedBids = new Map<string, TruthAuctionBidView>()
	for (const { bidData } of bidPages) {
		for (const bid of bidData.bids) {
			dedupedBids.set(`${bid.tick.toString()}:${bid.bidIndex.toString()}`, bid)
		}
	}
	return {
		bids: sortTruthAuctionBidsByPriority(Array.from(dedupedBids.values())),
		bidCountForLoadedTicks: uniqueTickSummaries.reduce((sum, tickSummary) => sum + tickSummary.submissionCount, 0n),
	}
}

function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}

export function ForkAuctionSection({
	accountState,
	auctionDetailsOverride,
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
	onMigrateVault,
	onRefundLosingBids,
	onReportingFormChange,
	onStartTruthAuction,
	onSubmitBid,
	previewPool,
	reportingDetails,
	reportingForm,
	securityPools = [],
	stageView,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	truthAuctionReadClient,
}: ForkAuctionSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
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
	const connectedWalletVaultSummary = accountState.address === undefined || previewPool === undefined ? undefined : previewPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const selectedOutcomeMigrationChildPool = securityPoolAddress === undefined ? undefined : securityPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === forkAuctionForm.selectedOutcome)
	const selectedOutcomeMigrationChildVault = selectedOutcomeMigrationChildPool === undefined || accountState.address === undefined ? undefined : selectedOutcomeMigrationChildPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const [selectedAuctionDetails, setSelectedAuctionDetails] = useState<ForkAuctionSectionProps['forkAuctionDetails']>(undefined)
	const [selectedAuctionError, setSelectedAuctionError] = useState<string | undefined>(undefined)
	const [loadingSelectedAuctionDetails, setLoadingSelectedAuctionDetails] = useState(false)
	const [recoveredSelectedAuctionChildPool, setRecoveredSelectedAuctionChildPool] = useState<ListedSecurityPool | undefined>(undefined)
	const selectedAuctionChildPool = selectedOutcomeMigrationChildPool ?? recoveredSelectedAuctionChildPool
	const selectedAuctionPoolAddress = selectedAuctionChildPool?.securityPoolAddress
	const selectedAuctionContext = auctionDetailsOverride ?? (selectedAuctionDetails?.securityPoolAddress !== undefined && selectedAuctionPoolAddress !== undefined && sameAddress(selectedAuctionDetails.securityPoolAddress, selectedAuctionPoolAddress) ? selectedAuctionDetails : undefined)
	const auctionSecurityPoolAddress = selectedAuctionContext?.securityPoolAddress ?? selectedAuctionChildPool?.securityPoolAddress
	const auctionTruthAuctionAddress = selectedAuctionContext?.truthAuctionAddress ?? selectedAuctionChildPool?.truthAuctionAddress
	const auctionTruthAuctionStatus = selectedAuctionContext?.truthAuction
	const auctionHasStartedAtValue = selectedAuctionContext?.truthAuctionStartedAt ?? selectedAuctionChildPool?.truthAuctionStartedAt ?? 0n
	const hasSelectedAuctionChildPool = selectedAuctionChildPool !== undefined
	const selectedAuctionContextError = selectedAuctionError
	const selectedEscalationMigrationSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome)
	const selectedEscalationMigrationDeposits = selectedEscalationMigrationSide?.userDeposits ?? []
	const selectedEscalationMigrationDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? []
	const showSelectedEscalationMigrationDeposits = !loadingReportingDetails && reportingDetails?.status === 'active'
	const hasSelectedEscalationMigrationDeposits = selectedEscalationMigrationDeposits.length > 0
	const [selectedOutcomeMigrationSeedStatus, setSelectedOutcomeMigrationSeedStatus] = useState<ForkOutcomeMigrationSeedStatus | undefined>(undefined)
	const [selectedOutcomeMigrationSeedStatusError, setSelectedOutcomeMigrationSeedStatusError] = useState<string | undefined>(undefined)
	const [loadingSelectedOutcomeMigrationSeedStatus, setLoadingSelectedOutcomeMigrationSeedStatus] = useState(false)
	const [isStartTruthAuctionInProgressState, setIsStartTruthAuctionInProgressState] = useState(false)
	const [isVaultMigrationPending, setIsVaultMigrationPending] = useState(false)
	const [hasCompletedVaultMigration, setHasCompletedVaultMigration] = useState(false)
	const [pendingEscalationMigrationSelection, setPendingEscalationMigrationSelection] = useState<{ depositIndexes: bigint[]; outcome: ReportingOutcomeKey } | undefined>(undefined)
	const [optimisticMigratedEscalationRep, setOptimisticMigratedEscalationRep] = useState(0n)
	const previousVaultMigrationContextKeyRef = useRef<string | undefined>(undefined)
	const [truthAuctionBookData, setTruthAuctionBookData] = useState<TruthAuctionBookData>({
		tickSummaries: [],
		tickCount: 0n,
		viewerBids: [],
		viewerBidCount: 0n,
	})
	const [selectedBookTick, setSelectedBookTick] = useState<bigint | undefined>(undefined)
	const [loadedTickPageCount, setLoadedTickPageCount] = useState(1)
	const [loadedViewerBidPageCount, setLoadedViewerBidPageCount] = useState(1)
	const [loadedAuctionBidPageCount, setLoadedAuctionBidPageCount] = useState(1)
	const [aggregatedAuctionBids, setAggregatedAuctionBids] = useState<TruthAuctionBidView[]>([])
	const [aggregatedAuctionBidCountForLoadedTicks, setAggregatedAuctionBidCountForLoadedTicks] = useState(0n)
	const [loadingTruthAuctionBook, setLoadingTruthAuctionBook] = useState(false)
	const [loadingAggregatedAuctionBids, setLoadingAggregatedAuctionBids] = useState(false)
	const [truthAuctionBookError, setTruthAuctionBookError] = useState<string | undefined>(undefined)
	const effectiveLockedRepInEscalationGame = (() => {
		if (connectedWalletVaultSummary === undefined) return undefined
		if (connectedWalletVaultSummary.lockedRepInEscalationGame > optimisticMigratedEscalationRep) {
			return connectedWalletVaultSummary.lockedRepInEscalationGame - optimisticMigratedEscalationRep
		}
		return 0n
	})()
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
					{ label: 'Locked REP', value: <CurrencyValue value={effectiveLockedRepInEscalationGame ?? 0n} suffix='REP' /> },
				])}
				<div className='form-grid'>
					<label className='field'>
						<span>Outcome</span>
						<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					</label>
				</div>
				{selectedOutcomeMigrationVaultBalanceContent}
			</>
		)
	})()
	const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.repDepositShare > 0n || connectedWalletVaultSummary.securityBondAllowance > 0n)
	const hasWalletEscalationMigrationBalance = effectiveLockedRepInEscalationGame !== undefined && effectiveLockedRepInEscalationGame > 0n
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? 'No REP collateral or security bond allowance remains to migrate for the connected wallet.' : undefined
	const migrateEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? 'No locked REP remains to migrate for the connected wallet.' : undefined
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
	const selectedStage = stageView === 'initiate' ? 'migration' : stageView
	const selectedStageAheadMessage = getStageAheadMessage(selectedStage, currentStage)
	const selectedAuctionLabel = getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)
	const showAuctionChildPoolMessage = (selectedStage === 'auction' || selectedStage === 'settlement') && !hasSelectedAuctionChildPool
	const enteredBidPrice = tryParseTruthAuctionPriceInput(forkAuctionForm.submitBidPrice)
	const enteredBidTick = enteredBidPrice === undefined ? undefined : getTruthAuctionTickAtPrice(enteredBidPrice)
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, enteredBidPrice)
	const optimisticTruthAuctionStartedAt =
		forkAuctionResult?.action === 'startTruthAuction' && auctionSecurityPoolAddress !== undefined && sameAddress(forkAuctionResult.securityPoolAddress, auctionSecurityPoolAddress) ? (effectiveCurrentTimestamp ?? forkAuctionDetails?.migrationEndsAt ?? selectedAuctionContext?.currentTime ?? 1n) : undefined
	let effectiveTruthAuctionStartedAt = optimisticTruthAuctionStartedAt
	if (auctionHasStartedAtValue > 0n) effectiveTruthAuctionStartedAt = auctionHasStartedAtValue
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const hasStartedTruthAuction = effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n
	const truthAuctionFallback = (() => {
		if (auctionTruthAuctionStatus !== undefined) return UNKNOWN_VALUE
		if (hasSelectedAuctionChildPool) return UNKNOWN_VALUE
		return forkOnlyFallbackText
	})()
	const truthAuctionStatus = auctionTruthAuctionStatus
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && auctionTruthAuctionAddress !== undefined && auctionTruthAuctionAddress !== zeroAddress
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
	const truthAuctionTimeRemaining = (() => {
		if (truthAuctionStatus?.finalized === true) return 0n
		if (truthAuctionEndsAt === undefined || effectiveCurrentTimestamp === undefined) return truthAuctionStatus?.timeRemaining
		return getTimeRemaining(truthAuctionEndsAt, effectiveCurrentTimestamp)
	})()
	const activeTickSummaries = sortTruthAuctionTickSummariesDescending(truthAuctionBookData.tickSummaries)
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
	const viewerBidSummary = summarizeViewerTruthAuctionBids(truthAuctionBookData.viewerBids, truthAuctionStatus)
	const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick)
	const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick)
	const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined)
	const maxTickEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalEth > maximumEth ? point.currentTotalEth : maximumEth), 0n)
	const knownTruthAuctionBids = dedupeTruthAuctionBids([...truthAuctionBookData.viewerBids, ...aggregatedAuctionBids])
	const hasMoreTickSummaries = BigInt(truthAuctionBookData.tickSummaries.length) < truthAuctionBookData.tickCount
	const hasMoreViewerBids = BigInt(truthAuctionBookData.viewerBids.length) < truthAuctionBookData.viewerBidCount
	const hasMoreAggregatedAuctionBids = BigInt(aggregatedAuctionBids.length) < aggregatedAuctionBidCountForLoadedTicks
	const selectTruthAuctionTick = (tick: bigint) => {
		if (selectedBookTick === tick) return
		setSelectedBookTick(tick)
	}
	const timeLeftDisplay = (() => {
		if (truthAuctionStatus === undefined) return truthAuctionFallback
		if (truthAuctionTimeRemaining === undefined) return formatDuration(AUCTION_TIME_SECONDS)

		return formatDuration(truthAuctionTimeRemaining)
	})()
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
	const viewerRefundMetricLabel = truthAuctionStatus?.finalized ? 'Refundable' : 'Below Clearing'
	const selectedRefundBidSummary = (() => {
		const refundTick = parseOptionalBigInt(forkAuctionForm.refundTick)
		const refundBidIndex = parseOptionalBigInt(forkAuctionForm.refundBidIndex)
		if (refundTick === undefined || refundBidIndex === undefined || truthAuctionStatus === undefined) return undefined
		const bid = knownTruthAuctionBids.find(candidate => candidate.tick === refundTick && candidate.bidIndex === refundBidIndex)
		if (bid === undefined) return undefined
		return {
			bid,
			disposition: getBidDisposition(bid, truthAuctionStatus),
			price: getTruthAuctionPriceAtTick(bid.tick),
		} satisfies TruthAuctionSelectedBidSummary
	})()
	const selectedSettlementBidSummary = (() => {
		const claimBidTick = parseOptionalBigInt(forkAuctionForm.claimBidTick)
		const claimBidIndex = parseOptionalBigInt(forkAuctionForm.claimBidIndex)
		if (claimBidTick === undefined || claimBidIndex === undefined || truthAuctionStatus === undefined) return undefined
		const bid = knownTruthAuctionBids.find(candidate => candidate.tick === claimBidTick && candidate.bidIndex === claimBidIndex)
		if (bid === undefined) return undefined
		return {
			bid,
			disposition: getBidDisposition(bid, truthAuctionStatus),
			price: getTruthAuctionPriceAtTick(bid.tick),
		} satisfies TruthAuctionSelectedBidSummary
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
		lifecycleState:
			lifecycleStateOverride ??
			deriveSecurityPoolLifecycleState({
				questionOutcome,
				systemState,
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
					<strong>Truth auction has ended.</strong> {truthAuctionStatus.finalized ? 'Bidding is closed and finalized settlement paths are now in effect.' : 'Bidding is closed. Finalize the truth auction to settle against the final clearing result.'}{' '}
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
		repAtFork: forkAuctionDetails?.repAtFork,
	})
	const bidPriceValidationMessage = (() => {
		if (forkAuctionForm.submitBidPrice.trim() === '') return 'Enter a bid price greater than zero.'
		if (enteredBidPrice === undefined || enteredBidTick === undefined) return 'Enter a valid bid price.'
		if (enteredBidPrice <= 0n) return 'Enter a bid price greater than zero.'
		return undefined
	})()
	const startTruthAuctionAvailabilityMessage = (() => {
		if (hasStartedTruthAuction) return 'Truth auction already started.'
		if (isStartTruthAuctionInProgress) return 'Starting truth auction...'
		return startTruthAuctionGuardMessage
	})()
	const refundTruthAuctionBidGuardMessage = getRefundTruthAuctionBidGuardMessage({
		refundBidIndexInput: forkAuctionForm.refundBidIndex,
		refundTickInput: forkAuctionForm.refundTick,
		truthAuction: truthAuctionStatus,
	})
	const primaryRefundTruthAuctionBidGuardMessage = selectedRefundBidSummary === undefined ? 'Pick one of your bids to load a refund target.' : refundTruthAuctionBidGuardMessage
	const settleFinalizedTruthAuctionBidGuardMessage = getSettleFinalizedTruthAuctionBidGuardMessage({
		claimBidIndexInput: forkAuctionForm.claimBidIndex,
		claimBidTickInput: forkAuctionForm.claimBidTick,
		claimingAvailable: selectedAuctionContext?.claimingAvailable ?? false,
		settlementAddressInput: forkAuctionForm.settlementAddress,
		truthAuction: truthAuctionStatus,
	})
	const primarySettleFinalizedTruthAuctionBidGuardMessage = selectedSettlementBidSummary === undefined ? 'Pick one of your bids to load a settlement target.' : settleFinalizedTruthAuctionBidGuardMessage
	const prefillSettleBid = (bid: TruthAuctionBidView) => {
		onForkAuctionFormChange({
			claimBidIndex: bid.bidIndex.toString(),
			claimBidTick: bid.tick.toString(),
			settlementAddress: bid.bidder,
		})
	}
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
		if (selectedEscalationMigrationDeposits.length === 0) return `No ${selectedOutcomeLabel} escalation deposits are currently available to migrate for this wallet.`
		if (selectedEscalationMigrationDepositIndexes.length > 0) return undefined
		return 'Select at least one deposit to migrate or use the all-deposits action below.'
	})()
	const migrateAllEscalationDepositsGuardMessage = (() => {
		if (migrateEscalationBalanceGuardMessage !== undefined) return migrateEscalationBalanceGuardMessage
		if (loadingReportingDetails) return 'Loading eligible escalation deposits.'
		if (reportingDetails?.status !== 'active') return 'Escalation deposit details are unavailable for this pool right now.'
		if (selectedEscalationMigrationDeposits.length > 0) return undefined
		return `No ${selectedOutcomeLabel} escalation deposits are currently available to migrate for this wallet.`
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
	const migrateVaultGuardMessage = migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage
	const submitBidGuardMessage = truthAuctionBidGuardMessage ?? bidPriceValidationMessage
	const migrationStatusBadge = isVaultMigrationComplete ? <span className='badge ok'>Migrated</span> : undefined
	const fullTruthAuctionReadClient = isFullReadClient(truthAuctionReadClient) ? truthAuctionReadClient : undefined
	const onStartTruthAuctionSubmit = () => {
		setIsStartTruthAuctionInProgressState(true)
		onStartTruthAuction(selectedAuctionPoolAddress)
	}
	const onSubmitBidForSelectedAuction = () => {
		onSubmitBid(selectedAuctionPoolAddress)
	}
	function onFinalizeTruthAuctionForSelectedAuction() {
		onFinalizeTruthAuction(selectedAuctionPoolAddress)
	}
	const onRefundLosingBidsForSelectedAuction = () => {
		onRefundLosingBids(selectedAuctionPoolAddress)
	}
	const onClaimAuctionProceedsForSelectedAuction = () => {
		onClaimAuctionProceeds(selectedAuctionPoolAddress)
	}
	const onMigrateVaultSubmit = () => {
		setIsVaultMigrationPending(true)
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
	const onMigrateAllEscalationDeposits = () => {
		const depositIndexes = selectedEscalationMigrationDeposits.map(deposit => deposit.depositIndex)
		setPendingEscalationMigrationSelection({
			depositIndexes,
			outcome: forkAuctionForm.selectedOutcome,
		})
		onMigrateEscalationDeposits(forkAuctionForm.selectedOutcome, depositIndexes)
	}
	function renderStageActionButton({
		action,
		availability,
		forceEnabled,
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
		forceEnabled?: boolean
		idleLabel: string
		onClick: () => void
		pendingLabel: string
		tone?: 'primary' | 'secondary'
	}) {
		const resolvedAvailability = availability ?? { disabled: false, reason: undefined }
		const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled
		const disabledReason = interactionDisabledReason ?? resolvedAvailability.reason
		return (
			<TransactionActionButton
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={forkAuctionActiveAction === action}
				tone={tone}
				availability={{
					disabled: !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
					reason: disabledReason,
				}}
			/>
		)
	}
	const renderSelectedBidSummary = ({ emptyCopy, selectedBidSummary }: { emptyCopy: string; selectedBidSummary: TruthAuctionSelectedBidSummary | undefined }) => {
		if (selectedBidSummary === undefined) return <p className='detail'>{emptyCopy}</p>
		return (
			<div className='truth-auction-selected-bid-summary'>
				<MetricField label='Price'>{renderTruthAuctionPriceValue(selectedBidSummary.price)}</MetricField>
				<MetricField label='Bidder'>{<AddressValue address={selectedBidSummary.bid.bidder} />}</MetricField>
				<MetricField label='Amount'>{<CurrencyValue value={selectedBidSummary.bid.ethAmount} suffix='ETH' />}</MetricField>
				<MetricField label='Status'>
					<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(selectedBidSummary.disposition.tone)}`}>{selectedBidSummary.disposition.label}</span>
				</MetricField>
			</div>
		)
	}
	const renderBidActionButtons = ({ bid, disposition, hasActions = true, showViewPriceAction = true, showEmptyState = false }: { bid: TruthAuctionBidView; disposition: TruthAuctionBidDisposition; hasActions?: boolean; showViewPriceAction?: boolean; showEmptyState?: boolean }) => {
		if (!hasActions) return undefined
		const isViewerBid = sameAddress(bid.bidder, accountState.address)
		const canPrefillRefund = isViewerBid && disposition.canPrefillRefund
		const canPrefillSettle = isViewerBid && disposition.canPrefillSettle
		const hasVisibleAction = canPrefillRefund || canPrefillSettle
		return (
			<div className='truth-auction-bid-row-actions'>
				{showViewPriceAction ? (
					<button className='secondary' onClick={() => selectTruthAuctionTick(bid.tick)} type='button'>
						View Price
					</button>
				) : undefined}
				{showEmptyState && !hasVisibleAction ? <span className='truth-auction-row-empty'>—</span> : undefined}
				{canPrefillRefund ? (
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
						Refund
					</button>
				) : undefined}
				{canPrefillSettle ? (
					<button className='secondary' onClick={() => prefillSettleBid(bid)} type='button'>
						Settle
					</button>
				) : undefined}
			</div>
		)
	}
	const renderAuctionBidsHeader = ({ showActions = false }: { showActions?: boolean }) => (
		<div className={`truth-auction-bid-row is-wide ${showActions ? '' : 'is-no-actions'} is-header`}>
			<span className='truth-auction-bid-row-label'>Price (ETH / REP)</span>
			<span>Bidder</span>
			<span>Bid Amount (ETH)</span>
			<span>Loaded Depth (ETH)</span>
			<span className='truth-auction-bid-row-status'>Status</span>
			{showActions ? <span>Actions</span> : undefined}
		</div>
	)
	const renderMyBidsHeader = ({ showActions = true }: { showActions?: boolean }) => (
		<div className={`truth-auction-bid-row is-wallet ${showActions ? '' : 'is-no-actions'} is-header`}>
			<span className='truth-auction-bid-row-label'>Price (ETH / REP)</span>
			<span>Bid Amount (ETH)</span>
			{showActions ? <span>Actions</span> : undefined}
			<span className='truth-auction-bid-row-status'>Status</span>
		</div>
	)
	const renderSubmitBidSection = ({ description, density = 'balanced', headingLevel = 3, title = 'Submit Bid', variant = 'default' }: { description?: ComponentChildren; density?: 'balanced' | 'compact'; headingLevel?: 3 | 4; title?: ComponentChildren; variant?: 'default' | 'embedded' }) => (
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
	const renderRefundBidSection = ({
		idleLabel,
		title,
		description,
		density = 'balanced',
		headingLevel = 3,
		tone = 'secondary',
		variant = 'default',
	}: {
		description?: ComponentChildren
		density?: 'balanced' | 'compact'
		headingLevel?: 3 | 4
		idleLabel: string
		title?: ComponentChildren
		tone?: 'primary' | 'secondary'
		variant?: 'default' | 'embedded'
	}) => (
		<SectionBlock {...(description === undefined ? {} : { description })} density={density} headingLevel={headingLevel} title={title} variant={variant}>
			<div className='form-grid'>
				{variant === 'embedded' ? (
					<>
						<label className='field'>
							<span>Refund Tick</span>
							<FormInput value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
						</label>
						<label className='field'>
							<span>Refund Bid Index</span>
							<FormInput value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
						</label>
					</>
				) : (
					renderSelectedBidSummary({
						emptyCopy: 'Pick one of your bids to load a refund target.',
						selectedBidSummary: selectedRefundBidSummary,
					})
				)}
				<div className='actions'>
					{renderStageActionButton({
						action: 'refundLosingBids',
						availability: createActionAvailability(variant === 'embedded' ? refundTruthAuctionBidGuardMessage : primaryRefundTruthAuctionBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel,
						onClick: onRefundLosingBidsForSelectedAuction,
						pendingLabel: 'Refunding losing bid...',
						tone,
					})}
				</div>
			</div>
		</SectionBlock>
	)
	const renderFinalizedSettlementSection = ({
		density = 'balanced',
		headingLevel = 3,
		idleLabel,
		title,
		tone = 'secondary',
		variant = 'default',
	}: {
		density?: 'balanced' | 'compact'
		headingLevel?: 3 | 4
		idleLabel: string
		title?: ComponentChildren
		tone?: 'primary' | 'secondary'
		variant?: 'default' | 'embedded'
	}) => (
		<SectionBlock density={density} headingLevel={headingLevel} title={title} variant={variant}>
			<div className='form-grid'>
				{variant === 'embedded' ? (
					<>
						<label className='field'>
							<span>Bidder Address</span>
							<FormInput value={forkAuctionForm.settlementAddress} onInput={event => onForkAuctionFormChange({ settlementAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>Settlement Bid Tick</span>
								<FormInput value={forkAuctionForm.claimBidTick} onInput={event => onForkAuctionFormChange({ claimBidTick: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Settlement Bid Index</span>
								<FormInput value={forkAuctionForm.claimBidIndex} onInput={event => onForkAuctionFormChange({ claimBidIndex: event.currentTarget.value })} />
							</label>
						</div>
					</>
				) : (
					renderSelectedBidSummary({
						emptyCopy: 'Pick one of your bids to load a settlement target.',
						selectedBidSummary: selectedSettlementBidSummary,
					})
				)}
				<div className='actions'>
					{renderStageActionButton({
						action: 'claimAuctionProceeds',
						availability: createActionAvailability(variant === 'embedded' ? settleFinalizedTruthAuctionBidGuardMessage : primarySettleFinalizedTruthAuctionBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel,
						onClick: onClaimAuctionProceedsForSelectedAuction,
						pendingLabel: 'Settling finalized bid...',
						tone,
					})}
				</div>
			</div>
		</SectionBlock>
	)
	useEffect(() => {
		if (selectedStage === 'migration' || securityPoolAddress === undefined) {
			setRecoveredSelectedAuctionChildPool(undefined)
			return
		}
		if (selectedOutcomeMigrationChildPool !== undefined) {
			setRecoveredSelectedAuctionChildPool(currentPool => (currentPool?.securityPoolAddress === selectedOutcomeMigrationChildPool.securityPoolAddress ? currentPool : selectedOutcomeMigrationChildPool))
			return
		}
		let cancelled = false
		void loadAllSecurityPools(fullTruthAuctionReadClient ?? createConnectedReadClient())
			.then(allPools => {
				if (cancelled) return
				const recoveredPool = allPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === forkAuctionForm.selectedOutcome)
				setRecoveredSelectedAuctionChildPool(recoveredPool)
			})
			.catch(() => {
				if (cancelled) return
				setRecoveredSelectedAuctionChildPool(undefined)
			})
		return () => {
			cancelled = true
		}
	}, [forkAuctionForm.selectedOutcome, forkAuctionResult?.hash, fullTruthAuctionReadClient, securityPoolAddress, selectedOutcomeMigrationChildPool, selectedStage])
	useEffect(() => {
		if ((selectedStage !== 'auction' && selectedStage !== 'settlement') || selectedAuctionPoolAddress === undefined) {
			setSelectedAuctionDetails(undefined)
			setSelectedAuctionError(undefined)
			setLoadingSelectedAuctionDetails(false)
			return
		}
		const client = fullTruthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingSelectedAuctionDetails(true)
		setSelectedAuctionError(undefined)
		void loadForkAuctionDetails(client, selectedAuctionPoolAddress)
			.then(details => {
				if (cancelled) return
				setSelectedAuctionDetails(details)
			})
			.catch(error => {
				if (cancelled) return
				setSelectedAuctionDetails(undefined)
				setSelectedAuctionError(getErrorMessage(error, `Unable to load auction details for the ${selectedAuctionLabel} child universe.`))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingSelectedAuctionDetails(false)
			})
		return () => {
			cancelled = true
		}
	}, [forkAuctionResult?.hash, fullTruthAuctionReadClient, selectedAuctionLabel, selectedAuctionPoolAddress, selectedStage])
	useEffect(() => {
		if (selectedStage !== 'migration' || securityPoolAddress === undefined || universeId === undefined) {
			setSelectedOutcomeMigrationSeedStatus(undefined)
			setSelectedOutcomeMigrationSeedStatusError(undefined)
			setLoadingSelectedOutcomeMigrationSeedStatus(false)
			return
		}
		const client = forkMigrationReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingSelectedOutcomeMigrationSeedStatus(true)
		setSelectedOutcomeMigrationSeedStatusError(undefined)
		void loadForkOutcomeMigrationSeedStatus(client, {
			childSecurityPoolAddress: selectedOutcomeMigrationChildPool?.securityPoolAddress,
			outcome: forkAuctionForm.selectedOutcome,
			securityPoolAddress,
			universeId,
		})
			.then(status => {
				if (cancelled) return
				setSelectedOutcomeMigrationSeedStatus(status)
			})
			.catch(error => {
				if (cancelled) return
				setSelectedOutcomeMigrationSeedStatus(undefined)
				setSelectedOutcomeMigrationSeedStatusError(getErrorMessage(error, `Unable to verify whether pool REP is ready for the ${selectedOutcomeLabel} child pool.`))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingSelectedOutcomeMigrationSeedStatus(false)
			})
		return () => {
			cancelled = true
		}
	}, [forkAuctionForm.selectedOutcome, forkAuctionResult?.hash, forkMigrationReadClient, securityPoolAddress, selectedOutcomeLabel, selectedOutcomeMigrationChildPool?.securityPoolAddress, selectedStage, universeId])
	useEffect(() => {
		const nextContextKey = securityPoolAddress === undefined || accountState.address === undefined ? undefined : `${accountState.address.toLowerCase()}:${securityPoolAddress.toLowerCase()}`
		if (previousVaultMigrationContextKeyRef.current === nextContextKey) return
		previousVaultMigrationContextKeyRef.current = nextContextKey
		setIsVaultMigrationPending(false)
		setHasCompletedVaultMigration(false)
		setPendingEscalationMigrationSelection(undefined)
		setOptimisticMigratedEscalationRep(0n)
	}, [accountState.address, securityPoolAddress])
	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateVault' || forkAuctionResult.securityPoolAddress !== securityPoolAddress) return
		setHasCompletedVaultMigration(true)
		setIsVaultMigrationPending(false)
	}, [forkAuctionResult?.action, forkAuctionResult?.hash, forkAuctionResult?.securityPoolAddress, securityPoolAddress])
	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateEscalationDeposits' || forkAuctionResult.securityPoolAddress !== securityPoolAddress) return
		if (pendingEscalationMigrationSelection === undefined) return
		const migrationSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === pendingEscalationMigrationSelection.outcome)
		const migratedRep = migrationSide?.userDeposits.filter(deposit => pendingEscalationMigrationSelection.depositIndexes.includes(deposit.depositIndex)).reduce((total, deposit) => total + deposit.amount, 0n)
		if (migratedRep !== undefined && migratedRep > 0n) {
			setOptimisticMigratedEscalationRep(currentReduction => currentReduction + migratedRep)
		}
		setPendingEscalationMigrationSelection(undefined)
	}, [forkAuctionResult, pendingEscalationMigrationSelection, reportingDetails, securityPoolAddress])
	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (hasStartedTruthAuction) {
			setIsStartTruthAuctionInProgressState(false)
			return
		}
		if (forkAuctionError !== undefined && forkAuctionActiveAction === undefined) {
			setIsStartTruthAuctionInProgressState(false)
		}
	}, [forkAuctionActiveAction, forkAuctionError, hasStartedTruthAuction, isStartTruthAuctionInProgressState, securityPoolAddress])
	useEffect(() => {
		if (!isVaultMigrationPending) return
		if (forkAuctionActiveAction === 'migrateVault') return
		if (forkAuctionError === undefined || securityPoolAddress === undefined) return
		if (forkAuctionError !== undefined) setIsVaultMigrationPending(false)
	}, [forkAuctionActiveAction, forkAuctionError, isVaultMigrationPending, securityPoolAddress])
	useEffect(() => {
		if (forkAuctionActiveAction === 'migrateEscalationDeposits') return
		if (forkAuctionError === undefined) return
		setPendingEscalationMigrationSelection(undefined)
	}, [forkAuctionActiveAction, forkAuctionError])
	useEffect(() => {
		setOptimisticMigratedEscalationRep(0n)
	}, [connectedWalletVaultSummary?.lockedRepInEscalationGame])
	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (accountState.address === undefined || securityPoolAddress === undefined) setIsStartTruthAuctionInProgressState(false)
	}, [accountState.address, isStartTruthAuctionInProgressState, securityPoolAddress])
	useEffect(() => {
		setLoadedTickPageCount(1)
		setLoadedViewerBidPageCount(1)
		setLoadedAuctionBidPageCount(1)
		setSelectedBookTick(undefined)
	}, [accountState.address, auctionTruthAuctionAddress])
	useEffect(() => {
		if (!shouldShowTruthAuctionVisualization || auctionTruthAuctionAddress === undefined || auctionTruthAuctionAddress === zeroAddress || (selectedStage !== 'auction' && selectedStage !== 'settlement')) {
			setTruthAuctionBookData({
				tickSummaries: [],
				tickCount: 0n,
				viewerBids: [],
				viewerBidCount: 0n,
			})
			setSelectedBookTick(undefined)
			setLoadingTruthAuctionBook(false)
			setAggregatedAuctionBids([])
			setAggregatedAuctionBidCountForLoadedTicks(0n)
			setLoadingAggregatedAuctionBids(false)
			setTruthAuctionBookError(undefined)
			return
		}
		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingTruthAuctionBook(true)
		setTruthAuctionBookError(undefined)
		void Promise.all([loadTruthAuctionActiveTickPages(client, auctionTruthAuctionAddress, loadedTickPageCount), accountState.address === undefined ? Promise.resolve({ bidCount: 0n, bids: [] }) : loadTruthAuctionBidderBidPages(client, auctionTruthAuctionAddress, accountState.address, loadedViewerBidPageCount)])
			.then(([tickPageData, viewerBidData]) => {
				if (cancelled) return
				const sortedTickSummaries = sortTruthAuctionTickSummariesDescending(tickPageData.tickSummaries)
				setTruthAuctionBookData({
					tickSummaries: sortedTickSummaries,
					tickCount: tickPageData.tickCount,
					viewerBids: viewerBidData.bids,
					viewerBidCount: viewerBidData.bidCount,
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
					tickCount: 0n,
					viewerBids: [],
					viewerBidCount: 0n,
				})
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
	}, [accountState.address, auctionTruthAuctionAddress, enteredBidTick, forkAuctionResult?.hash, loadedTickPageCount, loadedViewerBidPageCount, selectedStage, shouldShowTruthAuctionVisualization, truthAuctionReadClient, truthAuctionStatus?.clearingTick])
	useEffect(() => {
		if (!shouldShowTruthAuctionVisualization || auctionTruthAuctionAddress === undefined || auctionTruthAuctionAddress === zeroAddress || (selectedStage !== 'auction' && selectedStage !== 'settlement')) {
			setAggregatedAuctionBids([])
			setAggregatedAuctionBidCountForLoadedTicks(0n)
			setLoadingAggregatedAuctionBids(false)
			return
		}
		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingAggregatedAuctionBids(true)
		void loadAggregatedTruthAuctionBidPages(client, auctionTruthAuctionAddress, truthAuctionBookData.tickSummaries, loadedAuctionBidPageCount)
			.then(({ bids, bidCountForLoadedTicks }) => {
				if (cancelled) return
				setAggregatedAuctionBids(bids)
				setAggregatedAuctionBidCountForLoadedTicks(bidCountForLoadedTicks)
			})
			.catch(error => {
				if (cancelled) return
				setAggregatedAuctionBids([])
				setAggregatedAuctionBidCountForLoadedTicks(0n)
				setTruthAuctionBookError(currentError => currentError ?? getErrorMessage(error, 'Failed to load truth auction bids across the visible price levels'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingAggregatedAuctionBids(false)
			})
		return () => {
			cancelled = true
		}
	}, [auctionTruthAuctionAddress, forkAuctionResult?.hash, loadedAuctionBidPageCount, selectedStage, shouldShowTruthAuctionVisualization, truthAuctionBookData.tickSummaries, truthAuctionReadClient])
	const latestForkAuctionAction =
		forkAuctionResult === undefined
			? undefined
			: {
					dismissKey: forkAuctionResult.hash,
					title: 'Latest Fork / Auction Action',
					embedInCard,
					rows: [
						{ label: 'Action', value: getForkAuctionActionLabel(forkAuctionResult.action) },
						{ label: 'Pool', value: <AddressValue address={forkAuctionResult.securityPoolAddress} /> },
						{ label: 'Universe', value: <UniverseLink universeId={forkAuctionResult.universeId} /> },
						{ label: 'Transaction', value: <TransactionHashLink hash={forkAuctionResult.hash} /> },
					],
				}
	const forkAuctionOutcome = getForkAuctionOutcomePresentation(forkAuctionResult)
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
			label: 'Fork Type',
			value: resolvedForkTypeLabel,
		},
	]
	const truthAuctionStateBadgeElement = <span className={`badge ${truthAuctionStateBadge.tone}`}>{truthAuctionStateBadge.label}</span>
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: 'Auction Address', value: renderAddress(auctionTruthAuctionAddress) },
		{ label: 'Started', value: startedDisplay },
		{ label: 'Ends', value: endsDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix='REP' /> },
		{ label: 'Clearing Price', value: clearingPriceDisplay },
		{ label: 'Min Bid Size', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix='ETH' /> },
		{ label: 'Max REP Being Sold', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix='REP' /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: 'Auctioned Allowance', value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix='ETH' /> },
		{ label: 'Settlement Available', value: settlementAvailableDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix='REP' /> },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid'>
			<label className='field'>
				<span>Outcome</span>
				<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
			</label>
		</div>
	)
	const selectedAuctionChildPoolNotice = showAuctionChildPoolMessage ? <p className='detail'>Child universe not created for the {selectedAuctionLabel} outcome yet.</p> : undefined
	const selectedAuctionDetailsNotice = (() => {
		if (!hasSelectedAuctionChildPool || selectedStage === 'migration') return undefined
		if (loadingSelectedAuctionDetails) return <p className='detail'>Loading {selectedAuctionLabel} child auction details.</p>
		if (selectedAuctionContextError === undefined) return undefined
		return <p className='detail'>{selectedAuctionContextError}</p>
	})()
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<SectionBlock badge={truthAuctionStateBadgeElement} title={selectedStage === 'settlement' ? 'Settlement Overview' : 'Auction Overview'}>
				<div className='truth-auction-hero'>
					<div className='truth-auction-hero-primary'>
						<div className='truth-auction-progress-group'>
							<div className='truth-auction-progress-copy'>
								<span>ETH Raised</span>
								<strong>
									<CurrencyValue value={displayedEthRaised} suffix='ETH' /> / <CurrencyValue value={truthAuctionStatus.ethRaiseCap} suffix='ETH' />
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
									<CurrencyValue value={displayedRepSold} suffix='REP' /> / <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix='REP' />
								</strong>
							</div>
							<div className='truth-auction-progress-track'>
								<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
							</div>
						</div>
					</div>
					<div className='truth-auction-hero-grid'>
						<MetricField label='Clearing Price'>{renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)}</MetricField>
						<MetricField label='Min Bid'>{<CurrencyValue value={truthAuctionStatus.minBidSize} suffix='ETH' />}</MetricField>
						<MetricField label='Time Left'>{timeLeftDisplay}</MetricField>
						{winningThresholdPrice === undefined ? undefined : <MetricField label='Winning Threshold'>{renderTruthAuctionPriceValue(winningThresholdPrice)}</MetricField>}
					</div>
				</div>
			</SectionBlock>
		)
	})()
	const truthAuctionMarketViewSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<SectionBlock title='Market View'>
				{truthAuctionBookError === undefined ? undefined : <p className='detail truth-auction-book-error'>{truthAuctionBookError}</p>}
				<div className='truth-auction-market-board'>
					<div className='truth-auction-market-section truth-auction-depth-panel'>
						<div className='truth-auction-depth-header'>
							<div>
								<h4>Visible Depth</h4>
							</div>
						</div>
						{loadingTruthAuctionBook ? <p className='detail'>Loading order book…</p> : undefined}
						{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>No live price levels are currently active for this auction.</p> : undefined}
						{truthAuctionDepthPoints.length === 0 ? undefined : <TruthAuctionDepthChart onSelectTick={selectTruthAuctionTick} points={truthAuctionDepthPoints} {...(truthAuctionStatus.hitCap && truthAuctionStatus.clearingTick !== undefined ? { clearingTick: truthAuctionStatus.clearingTick } : {})} />}
					</div>
					<div className='truth-auction-market-detail-grid'>
						<div className='truth-auction-market-section'>
							<div className='truth-auction-panel-header'>
								<div>
									<h4>Price Ladder</h4>
								</div>
							</div>
							<div className='truth-auction-ladder'>
								{loadingTruthAuctionBook ? <p className='detail'>Loading price levels…</p> : undefined}
								{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>No active levels are visible yet.</p> : undefined}
								{truthAuctionDepthPoints.map(point => (
									<button
										aria-pressed={point.isSelected}
										className={`truth-auction-price-row truth-auction-ladder-row ${getTruthAuctionDispositionClassName(point.disposition.tone)}${point.isSelected ? ' is-selected' : ''}${point.isPreviewTick ? ' is-preview' : ''}${truthAuctionStatus.clearingTick === point.tick ? ' is-clearing' : ''}`}
										key={point.tick.toString()}
										onClick={() => selectTruthAuctionTick(point.tick)}
										type='button'
									>
										<div className='truth-auction-price-row-bar' style={{ width: `${clampPercentage(point.currentTotalEth, maxTickEth)}%` }} />
										<div className='truth-auction-price-row-copy'>
											<div className='truth-auction-price-row-main'>
												<div>
													<strong>{renderTruthAuctionPriceValue(point.price)}</strong>
													<span className='truth-auction-price-row-price'>Price level</span>
												</div>
												<div className='truth-auction-price-row-badges'>
													{truthAuctionStatus.clearingTick === point.tick ? <span className='truth-auction-ladder-helper'>Clearing level</span> : undefined}
													{point.isPreviewTick ? <span className='truth-auction-ladder-helper'>Current form price</span> : undefined}
													<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(point.disposition.tone)}`}>{point.disposition.label}</span>
												</div>
											</div>
											<div className='truth-auction-price-row-meta'>
												<span>
													Current size <CurrencyValue value={point.currentTotalEth} suffix='ETH' />
												</span>
												<span className='truth-auction-ladder-row-cumulative'>
													Loaded depth <CurrencyValue value={point.cumulativeEth} suffix='ETH' />
												</span>
												<span>{activeTickSummaries.find(tickSummary => tickSummary.tick === point.tick)?.submissionCount.toString() ?? '0'} submissions</span>
											</div>
										</div>
									</button>
								))}
								{hasMoreTickSummaries ? (
									<div className='actions'>
										<button className='secondary' onClick={() => setLoadedTickPageCount(currentPageCount => currentPageCount + 1)} type='button'>
											Load More Price Levels
										</button>
									</div>
								) : undefined}
							</div>
						</div>
					</div>
				</div>
			</SectionBlock>
		)
	})()
	const auctionWideBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<SectionBlock title='Auction Bids'>
				<div className='truth-auction-bid-coverage-summary'>
					<MetricField label='Loaded Levels'>{truthAuctionBookData.tickSummaries.length.toString()}</MetricField>
					<MetricField label='Loaded Bids'>{aggregatedAuctionBids.length.toString()}</MetricField>
					<MetricField label='Coverage'>{`Showing ${aggregatedAuctionBids.length.toString()} of ${aggregatedAuctionBidCountForLoadedTicks.toString()} bids across loaded levels`}</MetricField>
				</div>
				{loadingAggregatedAuctionBids ? <p className='detail'>Loading auction bids…</p> : undefined}
				{!loadingAggregatedAuctionBids && truthAuctionBookData.tickSummaries.length === 0 ? <p className='detail'>No active prices are currently visible for this auction.</p> : undefined}
				{!loadingAggregatedAuctionBids && truthAuctionBookData.tickSummaries.length > 0 && aggregatedAuctionBids.length === 0 ? <p className='detail'>No bids are currently indexed for the loaded prices.</p> : undefined}
				{aggregatedAuctionBids.length === 0 ? undefined : (
					<div className='truth-auction-bid-table'>
						{renderAuctionBidsHeader({ showActions: false })}
						{aggregatedAuctionBids.map(bid => {
							const disposition = getBidDisposition(bid, truthAuctionStatus)
							return (
								<div className='truth-auction-bid-row is-wide is-no-actions' key={`aggregate:${bid.tick.toString()}:${bid.bidIndex.toString()}`}>
									<span className='truth-auction-bid-row-label'>{renderTruthAuctionPriceValue(getTruthAuctionPriceAtTick(bid.tick))}</span>
									<div className='truth-auction-bid-row-address'>
										<AddressValue address={bid.bidder} />
									</div>
									<span>
										<CurrencyValue value={bid.ethAmount} suffix='ETH' />
									</span>
									<span>
										<CurrencyValue value={bid.cumulativeEth} suffix='ETH' />
									</span>
									<span className='truth-auction-bid-row-status'>
										<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(disposition.tone)}`}>{disposition.label}</span>
									</span>
									{renderBidActionButtons({ bid, disposition, hasActions: false })}
								</div>
							)
						})}
					</div>
				)}
				{hasMoreAggregatedAuctionBids ? (
					<div className='actions'>
						<button className='secondary' onClick={() => setLoadedAuctionBidPageCount(currentPageCount => currentPageCount + 1)} type='button'>
							Load More Auction Bids
						</button>
					</div>
				) : undefined}
			</SectionBlock>
		)
	})()
	const viewerTruthAuctionBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		const viewerBidsWithDisposition = truthAuctionBookData.viewerBids.map(bid => ({ bid, disposition: getBidDisposition(bid, truthAuctionStatus) }))
		const hasViewerBidActions = viewerBidsWithDisposition.some(({ bid, disposition }) => sameAddress(bid.bidder, accountState.address) && (disposition.canPrefillRefund || disposition.canPrefillSettle))

		return (
			<SectionBlock title='My Bids' description='Your bids and their current status.'>
				{accountState.address === undefined ? <p className='detail'>Connect a wallet to inspect your submitted truth auction bids.</p> : undefined}
				{accountState.address !== undefined ? (
					<div className='truth-auction-wallet-summary'>
						<MetricField label='Winning'>{viewerBidSummary.winningCount.toString()}</MetricField>
						<MetricField label='Partial'>{viewerBidSummary.partialCount.toString()}</MetricField>
						<MetricField label={viewerRefundMetricLabel}>{viewerBidSummary.refundableCount.toString()}</MetricField>
						<MetricField label='REP Claimable'>{viewerBidSummary.repClaimableCount.toString()}</MetricField>
						<MetricField label='Refunded'>{viewerBidSummary.refundedCount.toString()}</MetricField>
					</div>
				) : undefined}
				{accountState.address !== undefined && loadingTruthAuctionBook ? <p className='detail'>Loading your bids…</p> : undefined}
				{accountState.address !== undefined && !loadingTruthAuctionBook && truthAuctionBookData.viewerBids.length === 0 ? <p className='detail'>No bids from this wallet are indexed for the current auction.</p> : undefined}
				{truthAuctionBookData.viewerBids.length === 0 ? undefined : (
					<div className='truth-auction-bid-table'>
						{renderMyBidsHeader({ showActions: hasViewerBidActions })}
						{viewerBidsWithDisposition.map(({ bid, disposition }) => {
							return (
								<div className={`truth-auction-bid-row is-wallet ${hasViewerBidActions ? '' : 'is-no-actions'}`} key={`viewer:${bid.tick.toString()}:${bid.bidIndex.toString()}`}>
									<span className='truth-auction-bid-row-label'>{renderTruthAuctionPriceValue(getTruthAuctionPriceAtTick(bid.tick))}</span>
									<span>
										<CurrencyValue value={bid.ethAmount} suffix='ETH' />
									</span>
									{hasViewerBidActions ? renderBidActionButtons({ bid, disposition, hasActions: hasViewerBidActions, showViewPriceAction: false }) : undefined}
									<span className='truth-auction-bid-row-status'>
										<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(disposition.tone)}`}>{disposition.label}</span>
									</span>
								</div>
							)
						})}
					</div>
				)}
				{accountState.address !== undefined && hasMoreViewerBids ? (
					<div className='actions'>
						<button className='secondary' onClick={() => setLoadedViewerBidPageCount(currentPageCount => currentPageCount + 1)} type='button'>
							Load More Of My Bids
						</button>
					</div>
				) : undefined}
			</SectionBlock>
		)
	})()
	const truthAuctionRefundSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined || truthAuctionStatus.finalized) return undefined
		return renderRefundBidSection({
			description: 'Use a bid row to load a refund target.',
			idleLabel: 'Refund Losing Bid',
			title: 'Refund Losing Bid',
			tone: 'primary',
		})
	})()
	const truthAuctionFinalizedSettlementSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined || !truthAuctionStatus.finalized) return undefined
		return renderFinalizedSettlementSection({
			idleLabel: 'Settle Finalized Bid',
			title: 'Settle Finalized Bid',
			tone: 'primary',
		})
	})()
	const stagePanel = (() => {
		if (selectedStage === 'migration')
			return (
				<fieldset className='fork-stage-panel' disabled={disabled}>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
					<SectionBlock badge={migrationStatusBadge} title='Migration Status'>
						{renderWorkflowMetricGrid(migrationStatusMetrics)}
					</SectionBlock>

					<SectionBlock title='Your Migration Balances' description='Wallet-level balances in the parent pool that may still need migration.'>
						{migrationBalancesContent}
						{accountState.address === undefined ? undefined : (
							<>
								<SectionBlock density='compact' headingLevel={4} title='Migrate Escalation Deposits' variant='embedded'>
									{connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? <p className='detail'>No locked REP is currently visible for winning non-decision escalation deposits on the connected wallet.</p> : undefined}
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
										{renderStageActionButton({
											action: 'migrateEscalationDeposits',
											availability: createActionAvailability(migrateAllEscalationDepositsGuardMessage),
											idleLabel: `Migrate All ${selectedOutcomeLabel} Deposits`,
											onClick: onMigrateAllEscalationDeposits,
											pendingLabel: 'Migrating escalation deposits...',
										})}
									</div>
								</SectionBlock>
								<SectionBlock density='compact' headingLevel={4} title='Migrate Pool To Universe' variant='embedded'>
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
						<fieldset className='fork-stage-panel' disabled={disabled}>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{auctionOutcomeSelector}
							{selectedAuctionDetailsNotice}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							{truthAuctionMarketViewSection}
							{auctionWideBidsSection}
							{renderSubmitBidSection({
								description: 'Enter a price and ETH amount.',
							})}
							{viewerTruthAuctionBidsSection}
						</fieldset>
					)
				return (
					<fieldset className='fork-stage-panel' disabled={disabled}>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{auctionOutcomeSelector}
						{selectedAuctionChildPoolNotice}
						{selectedAuctionDetailsNotice}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title='Auction Status'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>

						<SectionBlock title='Start Truth Auction'>
							{startTruthAuctionReadyInText === undefined ? undefined : <p className='detail'>{startTruthAuctionReadyInText}</p>}
							{truthAuctionBypassReason === undefined ? undefined : <p className='detail'>{truthAuctionBypassReason}</p>}
							<div className='actions'>
								{renderStageActionButton({
									action: 'startTruthAuction',
									availability: createActionAvailability(!hasSelectedAuctionChildPool ? `Child universe not created for the ${selectedAuctionLabel} outcome yet.` : startTruthAuctionAvailabilityMessage),
									forceEnabled: hasSelectedAuctionChildPool,
									idleLabel: truthAuctionBypassReason === undefined ? 'Start Truth Auction' : 'Bypass Auction',
									onClick: onStartTruthAuctionSubmit,
									pendingLabel: truthAuctionBypassReason === undefined ? 'Starting truth auction...' : 'Bypassing auction...',
									tone: 'primary',
								})}
							</div>
						</SectionBlock>

						{renderSubmitBidSection({ description: 'Enter a price and ETH amount.' })}
					</fieldset>
				)
			}
			if (selectedStage === 'settlement') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset className='fork-stage-panel' disabled={disabled}>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{auctionOutcomeSelector}
							{selectedAuctionDetailsNotice}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							{viewerTruthAuctionBidsSection}
							{truthAuctionRefundSection}
							{truthAuctionFinalizedSettlementSection}
						</fieldset>
					)
				return (
					<fieldset className='fork-stage-panel' disabled={disabled}>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{auctionOutcomeSelector}
						{selectedAuctionChildPoolNotice}
						{selectedAuctionDetailsNotice}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title='Settlement Status'>
							{renderWorkflowMetricGrid(settlementStatusMetrics)}
						</SectionBlock>
						{truthAuctionStatus?.finalized ? undefined : renderRefundBidSection({ idleLabel: 'Refund Losing Bid', title: 'Refund Losing Bid', tone: 'primary' })}
						{!truthAuctionStatus?.finalized ? undefined : renderFinalizedSettlementSection({ idleLabel: 'Settle Finalized Bid', title: 'Settle Finalized Bid', tone: 'primary' })}
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
			<WorkflowTransactionStatus latestAction={latestForkAuctionAction} outcome={forkAuctionOutcome} />
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
