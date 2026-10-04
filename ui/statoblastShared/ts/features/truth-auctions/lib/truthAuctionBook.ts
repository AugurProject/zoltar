import { getTruthAuctionBidTimingGuardMessage } from '../../../protocol/truthAuctionTiming.js'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'
import { findTruthAuctionMinSupportedTick, TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { tryParseTruthAuctionAmountInput, tryParseTruthAuctionPriceInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { normalizeNumericInput } from '@zoltar/ui-core-shared/lib/numericInput.js'
import { getSpendableEthBalance } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '../../../types/contracts.js'
import { formatTruthAuctionTickPriceInput, formatTruthAuctionValidationPrice, getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice } from '../../../protocol/truthAuctionMath.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
export { formatTruthAuctionTickPriceInput, getTruthAuctionPriceAtTick, getTruthAuctionTickAtPrice }

type TruthAuctionDisposition = {
	label: string
	tone: 'default' | 'danger' | 'success' | 'warning'
}

type TruthAuctionFinalizedSettlementKind = 'ethRefund' | 'none' | 'repClaim'

type TruthAuctionBidSummaryKind = 'losing' | 'neutral' | 'partial' | 'refundable' | 'refunded' | 'repClaimable' | 'winning'

export type TruthAuctionBidDisposition = TruthAuctionDisposition & {
	canPrefillRefund: boolean
	canPrefillSettle: boolean
	settlementKind: TruthAuctionFinalizedSettlementKind
	summaryKind: TruthAuctionBidSummaryKind
}

export type TruthAuctionDepthPoint = {
	tick: bigint
	price: bigint
	currentTotalBidAttoEth: bigint
	cumulativeBidAttoEth: bigint
	disposition: TruthAuctionDisposition
	isSelected: boolean
	isPreviewTick: boolean
	submissionCount: bigint
}

type TruthAuctionBidSettlementEstimate = {
	purchasedRepAmountAttoRep: bigint
	refundedBidAmountAttoEth: bigint
	usedBidAmountAttoEth: bigint
}

function estimateRepPurchased(bidAmountAttoEth: bigint, price: bigint) {
	if (bidAmountAttoEth <= 0n || price <= 0n) return 0n
	return (bidAmountAttoEth * TRUTH_AUCTION_PRICE_PRECISION) / price
}

// The contract's underfundedThreshold: an auction that misses its cap only fills bids priced at or above this reserve.
export function getTruthAuctionReservePrice(auction: Pick<TruthAuctionMetrics, 'attoEthRaiseCap' | 'maxAttoRepBeingSold' | 'underfundedThreshold'>) {
	if (auction.underfundedThreshold !== undefined) return auction.underfundedThreshold
	if (auction.maxAttoRepBeingSold <= 0n) return undefined
	return ceilDiv(auction.attoEthRaiseCap * TRUTH_AUCTION_PRICE_PRECISION, auction.maxAttoRepBeingSold)
}

function isBelowTruthAuctionReserve(price: bigint, auction: TruthAuctionMetrics) {
	const reserve = getTruthAuctionReservePrice(auction)
	return reserve !== undefined && price < reserve
}

function findUnderfundedWinningAttoEth(tickSummaries: TruthAuctionTickSummary[], auction: TruthAuctionMetrics) {
	const reserve = getTruthAuctionReservePrice(auction)
	if (reserve === undefined) return 0n
	return tickSummaries.reduce((total, tick) => total + (tick.price >= reserve ? tick.currentTotalBidAttoEth : 0n), 0n)
}

function assertValidUnderfundedTruthAuctionMetrics(truthAuction: TruthAuctionMetrics) {
	if (truthAuction.finalized && truthAuction.underfunded && truthAuction.underfundedWinningAttoEth > 0n) {
		if (truthAuction.underfundedThreshold === undefined) {
			throw new Error('Finalized underfunded truth auction metrics are missing the winning threshold.')
		}
		if (truthAuction.clearingTick === undefined) {
			throw new Error('Finalized underfunded truth auction metrics are missing the winning clearing tick.')
		}
	}
}

export function getTruthAuctionWinningThresholdPrice(truthAuction: TruthAuctionMetrics | undefined) {
	if (truthAuction === undefined || !truthAuction.finalized || !truthAuction.underfunded) return undefined
	assertValidUnderfundedTruthAuctionMetrics(truthAuction)
	if (truthAuction.underfundedWinningAttoEth === 0n) return undefined
	return truthAuction.underfundedThreshold
}

function isFinalizedUnderfundedWithoutWinningPrefix(truthAuction: TruthAuctionMetrics) {
	return truthAuction.finalized && truthAuction.underfunded && truthAuction.underfundedWinningAttoEth === 0n
}

function isUnderfundedWinningTick(tick: bigint, truthAuction: TruthAuctionMetrics) {
	return truthAuction.finalized && truthAuction.underfunded && truthAuction.clearingTick !== undefined && truthAuction.underfundedWinningAttoEth > 0n && tick >= truthAuction.clearingTick
}

function getTruthAuctionTickDisposition(tickSummary: TruthAuctionTickSummary, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionDisposition {
	if (tickSummary.currentTotalBidAttoEth === 0n) return { label: 'Historical', tone: 'default' }
	if (truthAuction === undefined) return { label: 'Live', tone: 'default' }
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	if (winningThresholdPrice !== undefined) return isUnderfundedWinningTick(tickSummary.tick, truthAuction) ? { label: 'Winning', tone: 'success' } : { label: 'Out', tone: 'danger' }
	if (isFinalizedUnderfundedWithoutWinningPrefix(truthAuction)) return { label: 'Out', tone: 'danger' }
	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		if (truthAuction.finalized) return { label: 'Winning', tone: 'success' }
		return isBelowTruthAuctionReserve(tickSummary.price, truthAuction) ? { label: 'Below reserve', tone: 'danger' } : { label: 'In book', tone: 'default' }
	}
	if (tickSummary.tick > truthAuction.clearingTick) return { label: 'Winning', tone: 'success' }
	if (tickSummary.tick < truthAuction.clearingTick) return { label: truthAuction.finalized ? 'Out' : 'Losing', tone: 'danger' }
	return { label: 'Clearing price', tone: 'warning' }
}

function refundedBidDisposition(): TruthAuctionBidDisposition {
	return { label: 'Refunded', tone: 'default', canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refunded' }
}

function claimedBidDisposition(settlementKind: TruthAuctionFinalizedSettlementKind): TruthAuctionBidDisposition {
	return { label: 'Claimed', tone: 'success', canPrefillRefund: false, canPrefillSettle: false, settlementKind, summaryKind: 'neutral' }
}

/** A finalized bid that bought REP: claimable until claimed. */
function finalizedRepClaimDisposition(bid: TruthAuctionBidView, label: 'Partly filled' | 'Winning' = 'Winning'): TruthAuctionBidDisposition {
	if (bid.claimed) return claimedBidDisposition('repClaim')
	return label === 'Winning' ? { label, tone: 'success', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'winning' } : { label, tone: 'warning', canPrefillRefund: false, canPrefillSettle: true, settlementKind: 'repClaim', summaryKind: 'partial' }
}

/** A finalized bid that bought nothing: its ETH is refundable until refunded. */
function finalizedRefundDisposition(bid: TruthAuctionBidView): TruthAuctionBidDisposition {
	if (bid.claimed) return refundedBidDisposition()
	return { label: 'Refundable', tone: 'danger', canPrefillRefund: true, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refundable' }
}

/** A bid in a live auction whose outcome is not yet settled. */
function openBidDisposition(label: string, tone: TruthAuctionDisposition['tone']): TruthAuctionBidDisposition {
	return { label, tone, canPrefillRefund: false, canPrefillSettle: false, settlementKind: 'none', summaryKind: 'neutral' }
}

export function getTruthAuctionBidDisposition(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionBidDisposition {
	if (bid.refunded) return refundedBidDisposition()
	if (truthAuction === undefined) {
		if (bid.claimed) return claimedBidDisposition('none')
		return openBidDisposition('Pending', 'default')
	}

	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	if (winningThresholdPrice !== undefined) {
		if (isUnderfundedWinningTick(bid.tick, truthAuction)) return truthAuction.finalized ? finalizedRepClaimDisposition(bid) : openBidDisposition('Provisional', 'warning')
		return truthAuction.finalized ? finalizedRefundDisposition(bid) : openBidDisposition('In book', 'default')
	}

	if (isFinalizedUnderfundedWithoutWinningPrefix(truthAuction)) return finalizedRefundDisposition(bid)

	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		if (truthAuction.finalized) return finalizedRepClaimDisposition(bid)
		return isBelowTruthAuctionReserve(getTruthAuctionPriceAtTick(bid.tick), truthAuction) ? openBidDisposition('Below reserve', 'danger') : openBidDisposition('In book', 'default')
	}

	if (bid.tick > truthAuction.clearingTick) return truthAuction.finalized ? finalizedRepClaimDisposition(bid) : openBidDisposition('Winning', 'success')
	if (bid.tick < truthAuction.clearingTick) {
		if (truthAuction.finalized) return finalizedRefundDisposition(bid)
		return {
			label: 'Losing',
			tone: 'danger',
			canPrefillRefund: !truthAuction.finalized,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'losing',
		}
	}

	const previousCumulativeBidAttoEth = bid.activeCumulativeBidBeforeAttoEth
	const activeCumulativeAttoEth = previousCumulativeBidAttoEth + bid.bidAmountAttoEth
	if (truthAuction.bidAtClearingTickAttoEth <= previousCumulativeBidAttoEth) {
		if (truthAuction.finalized) return finalizedRefundDisposition(bid)
		return {
			label: 'Losing',
			tone: 'danger',
			canPrefillRefund: false,
			canPrefillSettle: false,
			settlementKind: 'none',
			summaryKind: 'losing',
		}
	}
	if (truthAuction.bidAtClearingTickAttoEth >= activeCumulativeAttoEth) return truthAuction.finalized ? finalizedRepClaimDisposition(bid) : openBidDisposition('Winning', 'success')
	return truthAuction.finalized ? finalizedRepClaimDisposition(bid, 'Partly filled') : openBidDisposition('Partly filled', 'warning')
}

export function getTruthAuctionBidSettlementEstimate(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionBidSettlementEstimate {
	if (truthAuction === undefined) {
		return {
			purchasedRepAmountAttoRep: 0n,
			refundedBidAmountAttoEth: 0n,
			usedBidAmountAttoEth: 0n,
		}
	}

	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	const bidPrice = getTruthAuctionPriceAtTick(bid.tick)

	if (winningThresholdPrice !== undefined) {
		if (!isUnderfundedWinningTick(bid.tick, truthAuction)) {
			return {
				purchasedRepAmountAttoRep: 0n,
				refundedBidAmountAttoEth: bid.bidAmountAttoEth,
				usedBidAmountAttoEth: 0n,
			}
		}

		if (truthAuction.underfundedWinningAttoEth === undefined || truthAuction.underfundedWinningAttoEth === 0n || truthAuction.totalAttoRepPurchased === 0n) {
			return {
				purchasedRepAmountAttoRep: 0n,
				refundedBidAmountAttoEth: 0n,
				usedBidAmountAttoEth: bid.bidAmountAttoEth,
			}
		}

		return {
			purchasedRepAmountAttoRep: (bid.bidAmountAttoEth * truthAuction.totalAttoRepPurchased) / truthAuction.underfundedWinningAttoEth,
			refundedBidAmountAttoEth: 0n,
			usedBidAmountAttoEth: bid.bidAmountAttoEth,
		}
	}

	if (isFinalizedUnderfundedWithoutWinningPrefix(truthAuction)) {
		return {
			purchasedRepAmountAttoRep: 0n,
			refundedBidAmountAttoEth: bid.bidAmountAttoEth,
			usedBidAmountAttoEth: 0n,
		}
	}

	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		return {
			purchasedRepAmountAttoRep: estimateRepPurchased(bid.bidAmountAttoEth, bidPrice),
			refundedBidAmountAttoEth: 0n,
			usedBidAmountAttoEth: bid.bidAmountAttoEth,
		}
	}

	if (bid.tick > truthAuction.clearingTick) {
		return {
			purchasedRepAmountAttoRep: estimateRepPurchased(bid.bidAmountAttoEth, truthAuction.clearingPrice),
			refundedBidAmountAttoEth: 0n,
			usedBidAmountAttoEth: bid.bidAmountAttoEth,
		}
	}

	if (bid.tick < truthAuction.clearingTick) {
		return {
			purchasedRepAmountAttoRep: 0n,
			refundedBidAmountAttoEth: bid.bidAmountAttoEth,
			usedBidAmountAttoEth: 0n,
		}
	}

	const previousCumulativeBidAttoEth = bid.activeCumulativeBidBeforeAttoEth
	const activeCumulativeAttoEth = previousCumulativeBidAttoEth + bid.bidAmountAttoEth

	if (truthAuction.bidAtClearingTickAttoEth <= previousCumulativeBidAttoEth) {
		return {
			purchasedRepAmountAttoRep: 0n,
			refundedBidAmountAttoEth: bid.bidAmountAttoEth,
			usedBidAmountAttoEth: 0n,
		}
	}

	if (truthAuction.bidAtClearingTickAttoEth >= activeCumulativeAttoEth) {
		return {
			purchasedRepAmountAttoRep: estimateRepPurchased(bid.bidAmountAttoEth, truthAuction.clearingPrice),
			refundedBidAmountAttoEth: 0n,
			usedBidAmountAttoEth: bid.bidAmountAttoEth,
		}
	}

	const usedBidAmountAttoEth = truthAuction.bidAtClearingTickAttoEth - previousCumulativeBidAttoEth
	return {
		purchasedRepAmountAttoRep: estimateRepPurchased(usedBidAmountAttoEth, truthAuction.clearingPrice),
		refundedBidAmountAttoEth: bid.bidAmountAttoEth - usedBidAmountAttoEth,
		usedBidAmountAttoEth,
	}
}

export function getTruthAuctionDispositionClassName(tone: TruthAuctionDisposition['tone']) {
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

export function sortTruthAuctionTickSummariesDescending(tickSummaries: TruthAuctionTickSummary[]) {
	return [...tickSummaries].sort((left, right) => {
		if (left.tick === right.tick) return 0
		return left.tick > right.tick ? -1 : 1
	})
}

export function buildTruthAuctionDepthPoints({ enteredBidTick, selectedBookTick, tickSummaries, truthAuction }: { enteredBidTick: bigint | undefined; selectedBookTick: bigint | undefined; tickSummaries: TruthAuctionTickSummary[]; truthAuction: TruthAuctionMetrics | undefined }): TruthAuctionDepthPoint[] {
	let cumulativeBidAttoEth = 0n

	return tickSummaries
		.filter(tickSummary => tickSummary.active || tickSummary.currentTotalBidAttoEth > 0n)
		.map(tickSummary => {
			cumulativeBidAttoEth += tickSummary.currentTotalBidAttoEth
			return {
				tick: tickSummary.tick,
				price: tickSummary.price,
				currentTotalBidAttoEth: tickSummary.currentTotalBidAttoEth,
				cumulativeBidAttoEth,
				disposition: getTruthAuctionTickDisposition(tickSummary, truthAuction),
				isSelected: selectedBookTick === tickSummary.tick,
				isPreviewTick: enteredBidTick !== undefined && enteredBidTick === tickSummary.tick,
				submissionCount: tickSummary.submissionCount,
			}
		})
}

export function getTruthAuctionOverviewProgress(truthAuction: TruthAuctionMetrics | undefined, tickSummaries: TruthAuctionTickSummary[]) {
	if (truthAuction === undefined) return undefined
	if (truthAuction.finalized) {
		return {
			attoEthRaised: truthAuction.underfunded ? (truthAuction.underfundedWinningAttoEth ?? 0n) : truthAuction.attoEthRaised,
			attoRepSold: truthAuction.totalAttoRepPurchased,
		}
	}

	const activeTickSummaries = sortTruthAuctionTickSummariesDescending(tickSummaries).filter(tickSummary => tickSummary.currentTotalBidAttoEth > 0n)
	if (activeTickSummaries.length === 0) {
		return {
			attoEthRaised: truthAuction.attoEthRaised,
			attoRepSold: truthAuction.totalAttoRepPurchased,
		}
	}

	let provisionalEthRaisedAttoEth = 0n
	let provisionalRepSoldAttoRep = 0n

	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) {
		const underfundedWinningAttoEth = findUnderfundedWinningAttoEth(activeTickSummaries, truthAuction)
		if (underfundedWinningAttoEth > 0n) {
			provisionalEthRaisedAttoEth = underfundedWinningAttoEth
			provisionalRepSoldAttoRep = truthAuction.maxAttoRepBeingSold
		}
	} else {
		let remainingCap = truthAuction.attoEthRaiseCap
		for (const tickSummary of activeTickSummaries) {
			if (remainingCap <= 0n) break

			let acceptedAttoEth = 0n
			if (tickSummary.tick > truthAuction.clearingTick) acceptedAttoEth = tickSummary.currentTotalBidAttoEth
			else if (tickSummary.tick === truthAuction.clearingTick) acceptedAttoEth = truthAuction.bidAtClearingTickAttoEth < tickSummary.currentTotalBidAttoEth ? truthAuction.bidAtClearingTickAttoEth : tickSummary.currentTotalBidAttoEth

			if (acceptedAttoEth <= 0n) continue
			if (acceptedAttoEth > remainingCap) acceptedAttoEth = remainingCap

			provisionalEthRaisedAttoEth += acceptedAttoEth
			provisionalRepSoldAttoRep += estimateRepPurchased(acceptedAttoEth, truthAuction.clearingPrice)
			remainingCap -= acceptedAttoEth
		}
	}

	const attoEthRaised = provisionalEthRaisedAttoEth > truthAuction.attoEthRaiseCap ? truthAuction.attoEthRaiseCap : provisionalEthRaisedAttoEth
	const attoRepSold = provisionalRepSoldAttoRep > truthAuction.maxAttoRepBeingSold ? truthAuction.maxAttoRepBeingSold : provisionalRepSoldAttoRep

	return {
		attoEthRaised,
		attoRepSold,
	}
}

export function sortTruthAuctionBidsByPriority(bids: TruthAuctionBidView[]) {
	return [...bids].sort((left, right) => {
		if (left.tick !== right.tick) return left.tick > right.tick ? -1 : 1
		if (left.bidIndex !== right.bidIndex) return left.bidIndex < right.bidIndex ? -1 : 1
		return 0
	})
}

function normalizeTruthAuctionPriceInput(value: string) {
	if (value.startsWith('.')) return `0${value}`
	if (value.endsWith('.')) return `${value}0`
	return value
}

const TRUTH_AUCTION_MAX_PRICE = getTruthAuctionPriceAtTick(TRUTH_AUCTION_MAX_TICK)
const TRUTH_AUCTION_MIN_PRICE = getTruthAuctionPriceAtTick(findTruthAuctionMinSupportedTick())

const TRUTH_AUCTION_MAX_PRICE_INPUT = formatTruthAuctionValidationPrice(TRUTH_AUCTION_MAX_PRICE)
const TRUTH_AUCTION_PRICE_RANGE_MESSAGE = `Bid price must be between ${formatTruthAuctionValidationPrice(TRUTH_AUCTION_MIN_PRICE)} and ${TRUTH_AUCTION_MAX_PRICE_INPUT} ETH per REP.`
const truthAuctionMaxPriceParts = TRUTH_AUCTION_MAX_PRICE_INPUT.split('.')
const TRUTH_AUCTION_MAX_PRICE_WHOLE = truthAuctionMaxPriceParts[0] ?? '0'
const rawTruthAuctionMaxPriceFraction = truthAuctionMaxPriceParts[1] ?? ''
const TRUTH_AUCTION_MAX_PRICE_FRACTION = rawTruthAuctionMaxPriceFraction.padEnd(18, '0')

function isTruthAuctionPriceInputDefinitelyOutOfRange(input: string) {
	const normalized = normalizeTruthAuctionPriceInput(normalizeNumericInput(input))
	if (normalized === '' || normalized.startsWith('-')) return false
	const match = normalized.match(/^(\d+)(?:\.(\d+))?$/)
	if (match === null) return false
	const wholePart = match[1]?.replace(/^0+/, '') || '0'
	const fractionalPart = match[2] ?? ''
	if (fractionalPart.length > 18) return false
	if (wholePart.length !== TRUTH_AUCTION_MAX_PRICE_WHOLE.length) return wholePart.length > TRUTH_AUCTION_MAX_PRICE_WHOLE.length
	if (wholePart !== TRUTH_AUCTION_MAX_PRICE_WHOLE) return wholePart > TRUTH_AUCTION_MAX_PRICE_WHOLE
	return fractionalPart.padEnd(18, '0') > TRUTH_AUCTION_MAX_PRICE_FRACTION
}

export function getTruthAuctionBidPreview(submitBidPriceInput: string) {
	if (submitBidPriceInput.trim() === '') return undefined
	if (isTruthAuctionPriceInputDefinitelyOutOfRange(submitBidPriceInput)) return undefined
	const enteredBidPrice = tryParseTruthAuctionPriceInput(submitBidPriceInput)
	if (enteredBidPrice === undefined || enteredBidPrice <= 0n) return undefined
	const enteredBidTick = getTruthAuctionTickAtPrice(enteredBidPrice)
	if (enteredBidTick === undefined) return undefined
	return {
		enteredPrice: enteredBidPrice,
		submittedPrice: getTruthAuctionPriceAtTick(enteredBidTick),
		tick: enteredBidTick,
	}
}

export function getTruthAuctionBidPriceValidationMessage(submitBidPriceInput: string) {
	if (submitBidPriceInput.trim() === '') return 'Enter a bid price greater than zero.'
	if (isTruthAuctionPriceInputDefinitelyOutOfRange(submitBidPriceInput)) return TRUTH_AUCTION_PRICE_RANGE_MESSAGE
	const enteredBidPrice = tryParseTruthAuctionPriceInput(submitBidPriceInput)
	if (enteredBidPrice === undefined) return 'Enter a valid bid price.'
	if (enteredBidPrice <= 0n) return 'Enter a bid price greater than zero.'
	if (getTruthAuctionTickAtPrice(enteredBidPrice) === undefined) return TRUTH_AUCTION_PRICE_RANGE_MESSAGE
	return undefined
}

export function getTruthAuctionBidGuardMessage({
	accountAddress,
	currentTimestamp,
	isOnActiveAppChain,
	submitBidAmountInput,
	truthAuction,
	walletBalanceAttoEth,
}: {
	accountAddress: string | undefined
	currentTimestamp?: bigint | undefined
	isOnActiveAppChain: boolean
	submitBidAmountInput: string
	truthAuction: TruthAuctionMetrics | undefined
	walletBalanceAttoEth: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('submitting a truth auction bid') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (truthAuction === undefined) return forkAuctionCopy.loadingTruthAuction
	if (truthAuction.finalized) return forkAuctionCopy.truthAuctionFinalizedReason
	if (truthAuction.timeRemaining === 0n) return forkAuctionCopy.auctionEndedReason
	const timingGuardMessage = getTruthAuctionBidTimingGuardMessage(currentTimestamp, truthAuction.auctionEndsAt)
	if (timingGuardMessage !== undefined) return timingGuardMessage

	const trimmedAmount = submitBidAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a bid amount greater than zero.'
	const bidAmount = tryParseTruthAuctionAmountInput(trimmedAmount)
	if (bidAmount === undefined) return 'Enter a valid bid amount.'

	if (bidAmount <= 0n) return 'Enter a bid amount greater than zero.'
	if (bidAmount < truthAuction.minBidSizeAttoEth) return `Bid must be at least ${formatCurrencyBalanceWithUnit(truthAuction.minBidSizeAttoEth, 'ETH')}.`
	if (walletBalanceAttoEth === undefined) return forkAuctionCopy.loadingWalletEthBalance
	if (bidAmount > walletBalanceAttoEth) return `Need ${formatAdditionalCurrencyBalance(bidAmount - walletBalanceAttoEth, 'ETH')} in this wallet to bid the selected amount.`
	return undefined
}

export type TruthAuctionBidPricePosition = 'above' | 'at' | 'below'

/** Places a bid tick against the live clearing tick; `undefined` until the ETH target is met, because every bid fills before that. */
function getTruthAuctionBidPricePosition(truthAuction: TruthAuctionMetrics | undefined, bidTick: bigint | undefined): TruthAuctionBidPricePosition | undefined {
	if (truthAuction === undefined || truthAuction.finalized || !truthAuction.hitCap || truthAuction.clearingTick === undefined || bidTick === undefined) return undefined
	if (bidTick > truthAuction.clearingTick) return 'above'
	if (bidTick < truthAuction.clearingTick) return 'below'
	return 'at'
}

/** Converts a REP price quoted in ETH per REP into REP per ETH at the same 18-decimal precision. */
export function getRepPerEthPrice(repPrice: bigint) {
	if (repPrice <= 0n) return undefined
	return (TRUTH_AUCTION_PRICE_PRECISION * TRUTH_AUCTION_PRICE_PRECISION) / repPrice
}

/** Bidding stops once the auction is finalized or its end time has passed on-chain. */
export function isTruthAuctionBiddingClosed(truthAuction: TruthAuctionMetrics, currentTimestamp: bigint | undefined) {
	if (truthAuction.finalized || truthAuction.timeRemaining === 0n) return true
	return currentTimestamp !== undefined && truthAuction.auctionEndsAt !== undefined && currentTimestamp >= truthAuction.auctionEndsAt
}

/** The live clearing price, the lowest price that wins in full, and where the entered bid sits; `undefined` before the ETH target is met. */
export function getTruthAuctionLiveBidGuidance(truthAuction: TruthAuctionMetrics | undefined, bidTick: bigint | undefined) {
	if (truthAuction === undefined || truthAuction.finalized || !truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) return undefined
	return {
		bidPricePosition: getTruthAuctionBidPricePosition(truthAuction, bidTick),
		clearingPrice: truthAuction.clearingPrice,
		minimumWinningPriceInput: truthAuction.clearingTick < TRUTH_AUCTION_MAX_TICK ? formatTruthAuctionTickPriceInput(truthAuction.clearingTick + 1n) : undefined,
	}
}

/** Bids snap down to the nearest valid tick. Describes that rounding, with the next tick up as the round-up input, unless the input already names its tick. */
export function getTruthAuctionBidPriceRounding(submitBidPriceInput: string) {
	const preview = getTruthAuctionBidPreview(submitBidPriceInput)
	if (preview === undefined || preview.enteredPrice === preview.submittedPrice) return undefined
	const tickPriceInput = formatTruthAuctionTickPriceInput(preview.tick)
	const tickInputPrice = tryParseTruthAuctionPriceInput(tickPriceInput)
	if (tickInputPrice === preview.enteredPrice) return undefined
	return {
		roundUpPriceInput: preview.tick < TRUTH_AUCTION_MAX_TICK ? formatTruthAuctionTickPriceInput(preview.tick + 1n) : undefined,
		submittedPriceInput: tickInputPrice !== undefined && tickInputPrice <= preview.enteredPrice ? tickPriceInput : formatTruthAuctionValidationPrice(preview.submittedPrice),
	}
}

/** Gas for a bid stays in the wallet, so Max offers only the balance above the shared gas reserve. */
export function getTruthAuctionMaxBidAmount(walletBalanceAttoEth: bigint | undefined) {
	if (walletBalanceAttoEth === undefined) return undefined
	return getSpendableEthBalance(walletBalanceAttoEth)
}

/** The bid amount and the price it is submitted at, once both inputs are valid. */
export function getTruthAuctionSubmitBidLabelParts(submitBidAmountInput: string, submitBidPriceInput: string) {
	const amountAttoEth = tryParseTruthAuctionAmountInput(submitBidAmountInput.trim())
	const preview = getTruthAuctionBidPreview(submitBidPriceInput)
	if (amountAttoEth === undefined || amountAttoEth <= 0n || preview === undefined) return undefined
	return { amountAttoEth, priceInput: getTruthAuctionBidPriceRounding(submitBidPriceInput)?.submittedPriceInput ?? formatTruthAuctionValidationPrice(preview.enteredPrice) }
}
