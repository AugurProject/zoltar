import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
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
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TimestampValue } from './TimestampValue.js'
import { TruthAuctionDepthChart, type TruthAuctionDepthPoint } from './TruthAuctionDepthChart.js'
import { UniverseLink } from './UniverseLink.js'
import { WorkflowTransactionStatus } from './WorkflowTransactionStatus.js'
import { loadForkOutcomeMigrationSeedStatus, loadTruthAuctionActiveTickPage, loadTruthAuctionBidderBidPage, loadTruthAuctionTickBidPage, loadTruthAuctionTickSummary } from '../contracts.js'
import { createActionAvailability } from '../lib/actionAvailability.js'
import { sameAddress } from '../lib/address.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { getErrorMessage } from '../lib/errors.js'
import { AUCTION_TIME_SECONDS, estimateRepPurchased, getForkAuctionStageLabel, getForkAuctionStageOrder, getForkAuctionStageView, getTimeRemaining, getTruthAuctionBidGuardMessage, type ForkAuctionStageView } from '../lib/forkAuction.js'
import { formatDuration } from '../lib/formatters.js'
import { tryParseBigIntInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { getEscalationDepositClaimAmount } from '../lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import type { ForkAuctionActionResult, ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'
const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = 'Unavailable until fork'
const TRUTH_AUCTION_TICK_PAGE_SIZE = 25
const TRUTH_AUCTION_BID_PAGE_SIZE = 25
const PRICE_PRECISION = 10n ** 18n
const TRUTH_AUCTION_TICK_PRICE_POWERS = [
	1000100000000000000n,
	1000200010000000000n,
	1000400060004000100n,
	1000800280056007000n,
	1001601200560182043n,
	1003204964963598014n,
	1006420201727613920n,
	1012881622445451097n,
	1025929181087729343n,
	1052530684607338948n,
	1107820842039993613n,
	1227267018058200482n,
	1506184333613467388n,
	2268591246822644826n,
	5146506245160322222n,
	26486526531474198664n,
	701536087702486644953n,
	492152882348911033633683n,
	242214459604341065650571799093n,
	58667844441422969901301586347865591163491n,
] as const
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
function estimateBidRep(bidAmount: string, selectedAuctionPrice: bigint | undefined) {
	if (selectedAuctionPrice === undefined) return undefined
	const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseBigIntInput(bidAmount)
	if (parsedBidAmount === undefined) return undefined
	return estimateRepPurchased(parsedBidAmount, selectedAuctionPrice)
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
	return (truthAuction.ethRaised * PRICE_PRECISION) / truthAuction.maxRepBeingSold
}

function getTruthAuctionPriceAtTick(tick: bigint) {
	const absoluteTick = tick < 0n ? -tick : tick
	let price = PRICE_PRECISION
	for (let bitIndex = 0; bitIndex < TRUTH_AUCTION_TICK_PRICE_POWERS.length; bitIndex += 1) {
		const bitMask = 1n << BigInt(bitIndex)
		const pricePower = TRUTH_AUCTION_TICK_PRICE_POWERS[bitIndex]
		if (pricePower === undefined) throw new Error(`Missing truth auction tick price power for bit ${bitIndex}`)
		if ((absoluteTick & bitMask) !== 0n) price = (price * pricePower) / PRICE_PRECISION
	}
	return tick < 0n ? (PRICE_PRECISION * PRICE_PRECISION) / price : price
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
export function ForkAuctionSection({
	accountState,
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
	const selectedAuctionPrice = forkAuctionDetails?.truthAuction?.clearingPrice
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, selectedAuctionPrice)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const forkOutcome = forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome
	const questionOutcome = forkAuctionDetails?.questionOutcome ?? previewPool?.questionOutcome
	const truthAuctionAddress = forkAuctionDetails?.truthAuctionAddress ?? previewPool?.truthAuctionAddress
	const optimisticTruthAuctionStartedAt =
		forkAuctionResult?.action === 'startTruthAuction' && securityPoolAddress !== undefined && sameAddress(forkAuctionResult.securityPoolAddress, securityPoolAddress) ? (effectiveCurrentTimestamp ?? forkAuctionDetails?.migrationEndsAt ?? forkAuctionDetails?.currentTime ?? 1n) : undefined
	let effectiveTruthAuctionStartedAt = optimisticTruthAuctionStartedAt
	if (previewPool?.truthAuctionStartedAt !== undefined && previewPool.truthAuctionStartedAt > 0n) effectiveTruthAuctionStartedAt = previewPool.truthAuctionStartedAt
	if (forkAuctionDetails?.truthAuctionStartedAt !== undefined && forkAuctionDetails.truthAuctionStartedAt > 0n) effectiveTruthAuctionStartedAt = forkAuctionDetails.truthAuctionStartedAt
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = forkAuctionDetails?.truthAuction?.auctionEndsAt ?? auctionWindow?.endsAt
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
	const selectedEscalationMigrationSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome)
	const selectedEscalationMigrationDeposits = selectedEscalationMigrationSide?.userDeposits ?? []
	const selectedEscalationMigrationDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? []
	const showSelectedEscalationMigrationDeposits = !loadingReportingDetails && reportingDetails?.status === 'active'
	const hasSelectedEscalationMigrationDeposits = selectedEscalationMigrationDeposits.length > 0
	const migrationBalancesContent = (() => {
		if (accountState.address === undefined) return <p className='detail'>Connect wallet to inspect your parent-pool balances.</p>
		if (connectedWalletVaultSummary === undefined) return <p className='detail'>Parent-pool vault balances are unavailable for the connected wallet. You can still use the migration actions below if this wallet has parent-pool state to move.</p>
		const selectedOutcomeMigrationVaultBalanceContent = (() => {
			if (selectedOutcomeMigrationChildPool === undefined) return <p className='detail'>No child pool is currently selected for the selected outcome.</p>

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
					{ label: 'Locked REP', value: <CurrencyValue value={connectedWalletVaultSummary.lockedRepInEscalationGame} suffix='REP' /> },
				])}
				<div className='form-grid'>
					<label className='field'>
						<span>Outcome</span>
						<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					</label>
				</div>
				{selectedOutcomeMigrationVaultBalanceContent}
				<p className='detail'>Migrate Vault moves your REP collateral and security bond allowance for the connected wallet. Locked REP only clears through Migrate Escalation Deposits.</p>
			</>
		)
	})()
	const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.repDepositShare > 0n || connectedWalletVaultSummary.securityBondAllowance > 0n)
	const hasWalletEscalationMigrationBalance = connectedWalletVaultSummary !== undefined && connectedWalletVaultSummary.lockedRepInEscalationGame > 0n
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
	const [selectedOutcomeMigrationSeedStatus, setSelectedOutcomeMigrationSeedStatus] = useState<ForkOutcomeMigrationSeedStatus | undefined>(undefined)
	const [selectedOutcomeMigrationSeedStatusError, setSelectedOutcomeMigrationSeedStatusError] = useState<string | undefined>(undefined)
	const [loadingSelectedOutcomeMigrationSeedStatus, setLoadingSelectedOutcomeMigrationSeedStatus] = useState(false)
	const [isStartTruthAuctionInProgressState, setIsStartTruthAuctionInProgressState] = useState(false)
	const [pendingVaultMigrationOutcome, setPendingVaultMigrationOutcome] = useState<ReportingOutcomeKey | undefined>(undefined)
	const [completedVaultMigrationOutcomes, setCompletedVaultMigrationOutcomes] = useState<ReportingOutcomeKey[]>([])
	const [truthAuctionBookData, setTruthAuctionBookData] = useState<TruthAuctionBookData>({
		tickSummaries: [],
		tickCount: 0n,
		viewerBids: [],
		viewerBidCount: 0n,
	})
	const [selectedTickBids, setSelectedTickBids] = useState<TruthAuctionBidView[]>([])
	const [selectedBookTick, setSelectedBookTick] = useState<bigint | undefined>(undefined)
	const [selectedTickSummary, setSelectedTickSummary] = useState<TruthAuctionTickSummary | undefined>(undefined)
	const [selectedTickBidCount, setSelectedTickBidCount] = useState(0n)
	const [loadedTickPageCount, setLoadedTickPageCount] = useState(1)
	const [loadedViewerBidPageCount, setLoadedViewerBidPageCount] = useState(1)
	const [loadedSelectedTickBidPageCount, setLoadedSelectedTickBidPageCount] = useState(1)
	const [loadingTruthAuctionBook, setLoadingTruthAuctionBook] = useState(false)
	const [loadingSelectedTickBids, setLoadingSelectedTickBids] = useState(false)
	const [truthAuctionBookError, setTruthAuctionBookError] = useState<string | undefined>(undefined)
	const selectedStageAheadMessage = getStageAheadMessage(selectedStage, currentStage)
	const truthAuctionFallback = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : UNKNOWN_VALUE
	const truthAuctionStatus = forkAuctionDetails?.truthAuction
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && truthAuctionAddress !== undefined && truthAuctionAddress !== zeroAddress
	const enteredBidTick = parseOptionalBigInt(forkAuctionForm.submitBidTick)
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuctionStatus)
	const startTruthAuctionCountdown = forkAuctionDetails?.migrationEndsAt === undefined || effectiveCurrentTimestamp === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, effectiveCurrentTimestamp)
	const startedDisplay = (() => {
		if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
			if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n) return `Starts in ${formatDuration(startTruthAuctionCountdown)}`
			return 'Not started'
		}

		return renderTimestamp({
			displayTimestamp: effectiveTruthAuctionStartedAt,
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
	const activeTickSummaries = sortTruthAuctionTickSummariesDescending(truthAuctionBookData.tickSummaries)
	const truthAuctionDepthPoints = buildTruthAuctionDepthPoints({
		enteredBidTick,
		selectedBookTick,
		tickSummaries: activeTickSummaries,
		truthAuction: truthAuctionStatus,
	})
	const viewerBidSummary = summarizeViewerTruthAuctionBids(truthAuctionBookData.viewerBids, truthAuctionStatus)
	const selectedLoadedDepthPoint = selectedBookTick === undefined ? undefined : truthAuctionDepthPoints.find(point => point.tick === selectedBookTick)
	const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick)
	const resolvedSelectedTickSummary = selectedBookTick === undefined ? undefined : (selectedLoadedTickSummary ?? (selectedTickSummary?.tick === selectedBookTick ? selectedTickSummary : undefined))
	const resolvedSelectedTickBids = selectedBookTick === undefined ? [] : selectedTickBids.filter(bid => bid.tick === selectedBookTick)
	const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick)
	const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined) ?? (enteredBidTick !== undefined && resolvedSelectedTickSummary?.tick === enteredBidTick ? resolvedSelectedTickSummary : undefined)
	const maxTickEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalEth > maximumEth ? point.currentTotalEth : maximumEth), 0n)
	const hasMoreTickSummaries = BigInt(truthAuctionBookData.tickSummaries.length) < truthAuctionBookData.tickCount
	const hasMoreViewerBids = BigInt(truthAuctionBookData.viewerBids.length) < truthAuctionBookData.viewerBidCount
	const hasMoreSelectedTickBids = selectedTickSummary?.tick === selectedBookTick && BigInt(resolvedSelectedTickBids.length) < selectedTickBidCount
	const selectTruthAuctionTick = (tick: bigint) => {
		if (selectedBookTick === tick) return
		setSelectedBookTick(tick)
		setSelectedTickBids([])
		setSelectedTickBidCount(0n)
		setLoadingSelectedTickBids(true)
		const matchingSummary = activeTickSummaries.find(tickSummary => tickSummary.tick === tick)
		setSelectedTickSummary(matchingSummary)
	}
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
	const settlementAvailableDisplay = (() => {
		if (forkAuctionDetails === undefined) {
			if (hasPreviewForkActivity) return UNKNOWN_VALUE

			return UNAVAILABLE_UNTIL_FORK
		}
		if (forkAuctionDetails.claimingAvailable) return 'Yes'

		return 'No'
	})()
	const viewerRefundMetricLabel = truthAuctionStatus?.finalized ? 'Refundable' : 'Below Clearing'
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
		truthAuction: forkAuctionDetails?.truthAuction,
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
	const hasStartedTruthAuction = effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return `Truth auction can be started in ${formatDuration(startTruthAuctionCountdown)} once migration ends.`
	})()
	const isVaultMigrationCompleteForSelectedOutcome = (() => {
		if (completedVaultMigrationOutcomes.includes(forkAuctionForm.selectedOutcome)) return true
		if (selectedOutcomeMigrationChildVault === undefined) return false
		return selectedOutcomeMigrationChildVault.repDepositShare > 0n || selectedOutcomeMigrationChildVault.securityBondAllowance > 0n
	})()
	const isVaultMigrationInProgressForSelectedOutcome = pendingVaultMigrationOutcome === forkAuctionForm.selectedOutcome
	const isStartTruthAuctionInProgress = (() => {
		if (hasStartedTruthAuction) return false
		if (isStartTruthAuctionInProgressState) return true
		if (forkAuctionActiveAction === 'startTruthAuction') return true

		return false
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
	const settleFinalizedTruthAuctionBidGuardMessage = getSettleFinalizedTruthAuctionBidGuardMessage({
		claimBidIndexInput: forkAuctionForm.claimBidIndex,
		claimBidTickInput: forkAuctionForm.claimBidTick,
		claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
		settlementAddressInput: forkAuctionForm.settlementAddress,
		truthAuction: truthAuctionStatus,
	})
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
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (loadingSelectedOutcomeMigrationSeedStatus) return `Checking whether pool REP has already been migrated for the ${selectedOutcomeLabel} child pool.`
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return `Migrate pool REP to the ${selectedOutcomeLabel} child pool before moving vault balances.`
	})()
	const migrateVaultCompletedMessage = isVaultMigrationCompleteForSelectedOutcome ? 'Vault migration for this outcome is already complete for this wallet.' : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationInProgressForSelectedOutcome ? 'Migrating vault...' : undefined
	const migrateVaultGuardMessage = migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage
	const onStartTruthAuctionSubmit = () => {
		setIsStartTruthAuctionInProgressState(true)
		onStartTruthAuction()
	}
	const onMigrateVaultSubmit = () => {
		setPendingVaultMigrationOutcome(forkAuctionForm.selectedOutcome)
		onMigrateVault()
	}
	const onMigrateSelectedOutcomeRepToZoltar = () => {
		onMigrateRepToZoltar([forkAuctionForm.selectedOutcome])
	}
	const onMigrateSelectedEscalationDeposits = () => {
		onMigrateEscalationDeposits(forkAuctionForm.selectedOutcome, selectedEscalationMigrationDepositIndexes)
	}
	const onMigrateAllEscalationDeposits = () => {
		onMigrateEscalationDeposits(
			forkAuctionForm.selectedOutcome,
			selectedEscalationMigrationDeposits.map(deposit => deposit.depositIndex),
		)
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
		if (securityPoolAddress === undefined || accountState.address === undefined) {
			setPendingVaultMigrationOutcome(undefined)
			setCompletedVaultMigrationOutcomes([])
			return
		}
	}, [accountState.address, securityPoolAddress])
	useEffect(() => {
		if (forkAuctionResult === undefined || forkAuctionResult.action !== 'migrateVault' || forkAuctionResult.securityPoolAddress !== securityPoolAddress) return
		if (pendingVaultMigrationOutcome === undefined) return
		setCompletedVaultMigrationOutcomes(currentOutcomes => (currentOutcomes.includes(pendingVaultMigrationOutcome) ? currentOutcomes : [...currentOutcomes, pendingVaultMigrationOutcome]))
		setPendingVaultMigrationOutcome(undefined)
	}, [forkAuctionResult?.action, forkAuctionResult?.hash, forkAuctionResult?.securityPoolAddress, pendingVaultMigrationOutcome, securityPoolAddress])
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
		if (!isVaultMigrationInProgressForSelectedOutcome) return
		if (forkAuctionActiveAction === 'migrateVault') return
		if (forkAuctionError === undefined || securityPoolAddress === undefined) return
		if (forkAuctionError !== undefined) setPendingVaultMigrationOutcome(undefined)
	}, [forkAuctionActiveAction, forkAuctionError, isVaultMigrationInProgressForSelectedOutcome, securityPoolAddress])
	useEffect(() => {
		if (!isStartTruthAuctionInProgressState) return
		if (accountState.address === undefined || securityPoolAddress === undefined) setIsStartTruthAuctionInProgressState(false)
	}, [accountState.address, isStartTruthAuctionInProgressState, securityPoolAddress])
	useEffect(() => {
		setLoadedTickPageCount(1)
		setLoadedViewerBidPageCount(1)
		setLoadedSelectedTickBidPageCount(1)
		setSelectedBookTick(undefined)
		setSelectedTickSummary(undefined)
	}, [accountState.address, truthAuctionAddress])
	useEffect(() => {
		setLoadedSelectedTickBidPageCount(1)
	}, [selectedBookTick])
	useEffect(() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress || (selectedStage !== 'auction' && selectedStage !== 'settlement')) {
			setTruthAuctionBookData({
				tickSummaries: [],
				tickCount: 0n,
				viewerBids: [],
				viewerBidCount: 0n,
			})
			setSelectedTickBids([])
			setSelectedBookTick(undefined)
			setSelectedTickSummary(undefined)
			setSelectedTickBidCount(0n)
			setLoadingTruthAuctionBook(false)
			setLoadingSelectedTickBids(false)
			setTruthAuctionBookError(undefined)
			return
		}
		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingTruthAuctionBook(true)
		setTruthAuctionBookError(undefined)
		void Promise.all([loadTruthAuctionActiveTickPages(client, truthAuctionAddress, loadedTickPageCount), accountState.address === undefined ? Promise.resolve({ bidCount: 0n, bids: [] }) : loadTruthAuctionBidderBidPages(client, truthAuctionAddress, accountState.address, loadedViewerBidPageCount)])
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
					if (currentSelection !== undefined && (sortedTickSummaries.some(tickSummary => tickSummary.tick === currentSelection) || (selectedTickSummary?.tick === currentSelection && selectedTickSummary.submissionCount > 0n))) return currentSelection
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
				setSelectedTickBids([])
				setSelectedBookTick(undefined)
				setSelectedTickSummary(undefined)
				setSelectedTickBidCount(0n)
				setTruthAuctionBookError(getErrorMessage(error, 'Failed to load truth auction bidbook'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingTruthAuctionBook(false)
			})
		return () => {
			cancelled = true
		}
	}, [accountState.address, enteredBidTick, forkAuctionResult?.hash, loadedTickPageCount, loadedViewerBidPageCount, selectedStage, shouldShowTruthAuctionVisualization, truthAuctionAddress, truthAuctionReadClient, truthAuctionStatus?.clearingTick])
	useEffect(() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionAddress === undefined || truthAuctionAddress === zeroAddress || selectedBookTick === undefined) {
			setSelectedTickBids([])
			setSelectedTickSummary(undefined)
			setSelectedTickBidCount(0n)
			setLoadingSelectedTickBids(false)
			return
		}
		const client = truthAuctionReadClient ?? createConnectedReadClient()
		let cancelled = false
		setLoadingSelectedTickBids(true)
		setTruthAuctionBookError(undefined)
		void Promise.all([loadTruthAuctionTickSummary(client, truthAuctionAddress, selectedBookTick), loadTruthAuctionTickBidPages(client, truthAuctionAddress, selectedBookTick, loadedSelectedTickBidPageCount)])
			.then(([tickSummary, bidData]) => {
				if (cancelled) return
				setSelectedTickSummary(tickSummary)
				setSelectedTickBids(bidData.bids)
				setSelectedTickBidCount(bidData.bidCount)
			})
			.catch(error => {
				if (cancelled) return
				setSelectedTickBids([])
				setSelectedTickSummary(undefined)
				setSelectedTickBidCount(0n)
				setTruthAuctionBookError(getErrorMessage(error, 'Failed to load truth auction bids at the selected price level'))
			})
			.finally(() => {
				if (cancelled) return
				setLoadingSelectedTickBids(false)
			})
		return () => {
			cancelled = true
		}
	}, [forkAuctionResult?.hash, loadedSelectedTickBidPageCount, selectedBookTick, shouldShowTruthAuctionVisualization, truthAuctionAddress, truthAuctionReadClient])
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
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: 'Auction Address', value: renderAddress(truthAuctionAddress) },
		{ label: 'Started', value: startedDisplay },
		{ label: 'Ends', value: endsDisplay },
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
		{ label: 'Settlement Available', value: settlementAvailableDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.totalRepPurchased} suffix='REP' /> },
	]
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
	const truthAuctionMarketViewSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		const selectedTickDisposition = resolvedSelectedTickSummary === undefined ? undefined : getTickDisposition(resolvedSelectedTickSummary, truthAuctionStatus)

		return (
			<SectionBlock title='Market View' description={selectedStage === 'settlement' ? 'Review loaded visible depth, inspect the active ladder, and open an individual price level before settling bids.' : 'Review visible depth, inspect the active ladder, and choose a price level before placing a bid.'}>
				{truthAuctionBookError === undefined ? undefined : <p className='detail truth-auction-book-error'>{truthAuctionBookError}</p>}
				<div className='truth-auction-market-board'>
					<div className='truth-auction-market-stack'>
						<div className='truth-auction-panel truth-auction-depth-panel'>
							<div className='truth-auction-depth-header'>
								<div>
									<h4>Visible Depth</h4>
									<p className='detail'>Loaded price levels only. Use Load More to extend the visible portion of the book.</p>
								</div>
							</div>
							{loadingTruthAuctionBook ? <p className='detail'>Loading order book…</p> : undefined}
							{!loadingTruthAuctionBook && truthAuctionDepthPoints.length === 0 ? <p className='detail'>No live price levels are currently active for this auction.</p> : undefined}
							{truthAuctionDepthPoints.length === 0 ? undefined : (
								<TruthAuctionDepthChart
									loadedTickCount={truthAuctionDepthPoints.length}
									onSelectTick={selectTruthAuctionTick}
									points={truthAuctionDepthPoints}
									totalActiveTickCount={truthAuctionBookData.tickCount}
									{...(truthAuctionStatus.hitCap && truthAuctionStatus.clearingTick !== undefined ? { clearingTick: truthAuctionStatus.clearingTick } : {})}
								/>
							)}
						</div>
						<div className='truth-auction-panel'>
							<div className='truth-auction-panel-header'>
								<div>
									<h4>Price Ladder</h4>
									<p className='detail'>Highest tick first. Each row shows the live size at that level and the loaded depth above it.</p>
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
													<strong>Tick {point.tick.toString()}</strong>
													<span className='truth-auction-price-row-price'>{<CurrencyValue value={point.price} suffix='ETH / REP' />}</span>
												</div>
												<div className='truth-auction-price-row-badges'>
													{truthAuctionStatus.clearingTick === point.tick ? <span className='truth-auction-ladder-helper'>Clearing level</span> : undefined}
													{point.isPreviewTick ? <span className='truth-auction-ladder-helper'>Current form tick</span> : undefined}
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
					<div className='truth-auction-level-detail'>
						{resolvedSelectedTickSummary === undefined ? (
							<p className='detail'>{loadingSelectedTickBids && selectedBookTick !== undefined ? 'Loading selected price level…' : 'Select a price level to inspect the bids queued there.'}</p>
						) : (
							<>
								<div className='truth-auction-level-header'>
									<div>
										<h4>Selected Price Level</h4>
										<p className='detail'>
											Tick {resolvedSelectedTickSummary.tick.toString()} at <CurrencyValue value={resolvedSelectedTickSummary.price} suffix='ETH / REP' />
										</p>
									</div>
									{selectedStage !== 'settlement' ? (
										<button className='secondary' onClick={() => onForkAuctionFormChange({ submitBidTick: resolvedSelectedTickSummary.tick.toString() })} type='button'>
											Use This Tick
										</button>
									) : undefined}
								</div>
								<div className='workflow-metric-grid'>
									<MetricField label='Live ETH'>{<CurrencyValue value={resolvedSelectedTickSummary.currentTotalEth} suffix='ETH' />}</MetricField>
									<MetricField label='Loaded Depth'>{selectedLoadedDepthPoint === undefined ? 'Not in loaded ladder' : <CurrencyValue value={selectedLoadedDepthPoint.cumulativeEth} suffix='ETH' />}</MetricField>
									<MetricField label='Historical Bids'>{resolvedSelectedTickSummary.submissionCount.toString()}</MetricField>
									<MetricField label='Status'>{selectedTickDisposition?.label ?? UNKNOWN_VALUE}</MetricField>
								</div>
								{loadingSelectedTickBids ? <p className='detail'>Loading bids at this price level…</p> : undefined}
								{!loadingSelectedTickBids && resolvedSelectedTickBids.length === 0 ? <p className='detail'>No bids are currently indexed for this price level.</p> : undefined}
								{resolvedSelectedTickBids.length === 0 ? undefined : (
									<div className='truth-auction-bid-table'>
										<div className='truth-auction-bid-row is-header'>
											<span>Bid</span>
											<span>Bidder</span>
											<span>Amount</span>
											<span>Cumulative</span>
											<span>Status</span>
											<span>Actions</span>
										</div>
										{resolvedSelectedTickBids.map(bid => {
											const disposition = getBidDisposition(bid, truthAuctionStatus)
											const isViewerBid = sameAddress(bid.bidder, accountState.address)
											const hasRowAction = isViewerBid && (disposition.canPrefillRefund || disposition.canPrefillSettle)
											return (
												<div className='truth-auction-bid-row' key={`${bid.tick.toString()}:${bid.bidIndex.toString()}`}>
													<span className='truth-auction-bid-row-label'>Bid #{bid.bidIndex.toString()}</span>
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
													<div className='truth-auction-bid-row-actions'>
														{!hasRowAction ? <span className='truth-auction-row-empty'>—</span> : undefined}
														{isViewerBid && disposition.canPrefillRefund ? (
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
														{isViewerBid && disposition.canPrefillSettle ? (
															<button className='secondary' onClick={() => prefillSettleBid(bid)} type='button'>
																Prefill Settle
															</button>
														) : undefined}
													</div>
												</div>
											)
										})}
									</div>
								)}
								{hasMoreSelectedTickBids ? (
									<div className='actions'>
										<button className='secondary' onClick={() => setLoadedSelectedTickBidPageCount(currentPageCount => currentPageCount + 1)} type='button'>
											Load More Bids At This Level
										</button>
									</div>
								) : undefined}
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
			<SectionBlock title='My Bids' description='Your submitted bids and their current status. Use the row shortcuts to jump to the price level or prefill settlement actions.'>
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
						<div className='truth-auction-bid-row is-header is-wallet'>
							<span>Tick</span>
							<span>Price</span>
							<span>Amount</span>
							<span>Status</span>
							<span>Actions</span>
						</div>
						{truthAuctionBookData.viewerBids.map(bid => {
							const disposition = getBidDisposition(bid, truthAuctionStatus)
							return (
								<div className='truth-auction-bid-row is-wallet' key={`viewer:${bid.tick.toString()}:${bid.bidIndex.toString()}`}>
									<span className='truth-auction-bid-row-label'>
										Tick {bid.tick.toString()}
										<small>Bid #{bid.bidIndex.toString()}</small>
									</span>
									<span>
										<CurrencyValue value={getTruthAuctionPriceAtTick(bid.tick)} suffix='ETH / REP' />
									</span>
									<span>
										<CurrencyValue value={bid.ethAmount} suffix='ETH' />
									</span>
									<span className='truth-auction-bid-row-status'>
										<span className={`truth-auction-status-pill ${getTruthAuctionDispositionClassName(disposition.tone)}`}>{disposition.label}</span>
									</span>
									<div className='truth-auction-bid-row-actions'>
										<button className='secondary' onClick={() => selectTruthAuctionTick(bid.tick)} type='button'>
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
										{disposition.canPrefillSettle ? (
											<button className='secondary' onClick={() => prefillSettleBid(bid)} type='button'>
												Prefill Settle
											</button>
										) : undefined}
									</div>
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
		return (
			<SectionBlock title='Refund Losing Bid' description='Refund a losing bid before finalization when the selected row indicates it is below clearing.'>
				<div className='truth-auction-panel truth-auction-settlement-panel'>
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
						<div className='actions'>{renderStageActionButton({ action: 'refundLosingBids', availability: createActionAvailability(refundTruthAuctionBidGuardMessage), idleLabel: 'Refund Losing Bid', onClick: onRefundLosingBids, pendingLabel: 'Refunding losing bid...', tone: 'primary' })}</div>
					</div>
				</div>
			</SectionBlock>
		)
	})()
	const truthAuctionFinalizedSettlementSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined || !truthAuctionStatus.finalized) return undefined
		return (
			<SectionBlock title='Settle Finalized Bid'>
				<div className='truth-auction-panel truth-auction-settlement-panel'>
					<div className='form-grid'>
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
						<div className='actions'>{renderStageActionButton({ action: 'claimAuctionProceeds', availability: createActionAvailability(settleFinalizedTruthAuctionBidGuardMessage), idleLabel: 'Settle Finalized Bid', onClick: onClaimAuctionProceeds, pendingLabel: 'Settling finalized bid...', tone: 'primary' })}</div>
					</div>
				</div>
			</SectionBlock>
		)
	})()
	const truthAuctionOperatorToolsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<ReadOnlyDetailAccordion defaultOpen={false} title='Operator Tools'>
				<div className='truth-auction-manual-tools'>
					{truthAuctionStatus.finalized ? undefined : (
						<SectionBlock density='compact' headingLevel={4} title='Raw Refund Fallback' variant='embedded'>
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
								<div className='actions'>{renderStageActionButton({ action: 'refundLosingBids', availability: createActionAvailability(refundTruthAuctionBidGuardMessage), idleLabel: 'Run Raw Refund', onClick: onRefundLosingBids, pendingLabel: 'Refunding losing bid...' })}</div>
							</div>
						</SectionBlock>
					)}
					{!truthAuctionStatus.finalized ? undefined : (
						<SectionBlock density='compact' headingLevel={4} title='Raw Finalized Settlement' variant='embedded'>
							<div className='form-grid'>
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
								<div className='actions'>{renderStageActionButton({ action: 'claimAuctionProceeds', availability: createActionAvailability(settleFinalizedTruthAuctionBidGuardMessage), idleLabel: 'Run Raw Finalized Settlement', onClick: onClaimAuctionProceeds, pendingLabel: 'Settling finalized bid...' })}</div>
							</div>
						</SectionBlock>
					)}
				</div>
			</ReadOnlyDetailAccordion>
		)
	})()
	const stagePanel = (() => {
		if (selectedStage === 'migration')
			return (
				<fieldset className='fork-stage-panel' disabled={disabled}>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
					<SectionBlock title='Migration Status'>{renderWorkflowMetricGrid(migrationStatusMetrics)}</SectionBlock>

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
								<SectionBlock density='compact' headingLevel={4} title='Migrate Vault' description={"Move the connected wallet's REP collateral and security bond allowance into the selected child universe."} variant='embedded'>
									{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>No REP collateral or security bond allowance remains to migrate for the connected wallet.</p> : undefined}
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>Checking whether pool REP is already ready for the selected child universe.</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalance > 0n ? 'Pool REP is already available in the selected child universe.' : 'Pool REP for this outcome is already staged and will sweep into the child universe during vault migration.'}</p>
									)}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<>
											<p className='detail'>This child outcome is not seeded with parent-pool REP yet. Migrate the pool REP first, then move your vault balances.</p>
											<div className='actions'>
												{renderStageActionButton({
													action: 'migrateRepToZoltar',
													idleLabel: `Migrate Collateral To ${selectedOutcomeLabel} Universe`,
													onClick: onMigrateSelectedOutcomeRepToZoltar,
													pendingLabel: 'Migrating pool REP...',
												})}
											</div>
										</>
									)}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateVault',
											availability: createActionAvailability(migrateVaultGuardMessage),
											idleLabel: 'Migrate Vault',
											onClick: onMigrateVaultSubmit,
											pendingLabel: 'Migrating vault...',
											tone: 'primary',
										})}
									</div>
									{isVaultMigrationCompleteForSelectedOutcome ? <p className='detail'>Already migrated</p> : undefined}
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
							{truthAuctionHero}
							{truthAuctionMarketViewSection}
							<div className='truth-auction-stage-actions'>
								<SectionBlock title='Submit Bid' description='Enter the tick and ETH amount you want to place into the auction. The ladder above can prefill a tick directly into this form.'>
									<div className='form-grid'>
										{submitBidPreviewTickSummary === undefined ? undefined : (
											<p className='detail'>
												Selected ladder price: Tick {submitBidPreviewTickSummary.tick.toString()} at <CurrencyValue value={submitBidPreviewTickSummary.price} suffix='ETH / REP' />
											</p>
										)}
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
								{viewerTruthAuctionBidsSection}
							</div>
						</fieldset>
					)
				return (
					<fieldset className='fork-stage-panel' disabled={disabled}>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						<SectionBlock title='Auction Status'>{renderWorkflowMetricGrid(auctionStatusMetrics)}</SectionBlock>

						<SectionBlock title='Start Truth Auction'>
							{startTruthAuctionReadyInText === undefined ? undefined : <p className='detail'>{startTruthAuctionReadyInText}</p>}
							<div className='actions'>
								{renderStageActionButton({
									action: 'startTruthAuction',
									availability: createActionAvailability(startTruthAuctionAvailabilityMessage),
									idleLabel: 'Start Truth Auction',
									onClick: onStartTruthAuctionSubmit,
									pendingLabel: 'Starting truth auction...',
									tone: 'primary',
								})}
							</div>
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
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{truthAuctionHero}
							{viewerTruthAuctionBidsSection}
							{truthAuctionStatus?.finalized ? undefined : (
								<SectionBlock title='Finalize Truth Auction' description='Finalize the auction once bidding has closed so finalized settlements can settle against the final clearing result.'>
									<div className='actions'>{renderStageActionButton({ action: 'finalizeTruthAuction', availability: createActionAvailability(finalizeTruthAuctionGuardMessage), idleLabel: 'Finalize Truth Auction', onClick: onFinalizeTruthAuction, pendingLabel: 'Finalizing truth auction...' })}</div>
								</SectionBlock>
							)}
							{truthAuctionRefundSection}
							{truthAuctionFinalizedSettlementSection}
							{truthAuctionMarketViewSection}
							{truthAuctionOperatorToolsSection}
						</fieldset>
					)
				return (
					<fieldset className='fork-stage-panel' disabled={disabled}>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						<SectionBlock title='Settlement Status'>{renderWorkflowMetricGrid(settlementStatusMetrics)}</SectionBlock>

						{truthAuctionStatus?.finalized ? undefined : (
							<SectionBlock title='Finalize Truth Auction'>
								<div className='actions'>{renderStageActionButton({ action: 'finalizeTruthAuction', availability: createActionAvailability(finalizeTruthAuctionGuardMessage), idleLabel: 'Finalize Truth Auction', onClick: onFinalizeTruthAuction, pendingLabel: 'Finalizing truth auction...' })}</div>
							</SectionBlock>
						)}

						{truthAuctionStatus?.finalized ? undefined : (
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
									<div className='actions'>{renderStageActionButton({ action: 'refundLosingBids', availability: createActionAvailability(refundTruthAuctionBidGuardMessage), idleLabel: 'Refund Losing Bid', onClick: onRefundLosingBids, pendingLabel: 'Refunding losing bid...', tone: 'primary' })}</div>
								</div>
							</SectionBlock>
						)}

						{!truthAuctionStatus?.finalized ? undefined : (
							<SectionBlock title='Settle Finalized Bid'>
								<div className='form-grid'>
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
									<div className='actions'>
										{renderStageActionButton({ action: 'claimAuctionProceeds', availability: createActionAvailability(settleFinalizedTruthAuctionBidGuardMessage), idleLabel: 'Settle Finalized Bid', onClick: onClaimAuctionProceeds, pendingLabel: 'Settling finalized bid...', tone: 'primary' })}
									</div>
								</div>
							</SectionBlock>
						)}
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
