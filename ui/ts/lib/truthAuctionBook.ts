import type { TruthAuctionBidView, TruthAuctionMetrics, TruthAuctionTickSummary } from '../types/contracts.js'
import { formatCurrencyBalance } from './formatters.js'
import { tryParseTruthAuctionAmountInput, tryParseTruthAuctionPriceInput } from './marketForm.js'

export const TRUTH_AUCTION_PRICE_PRECISION = 10n ** 18n
export const TRUTH_AUCTION_MIN_TICK = -524288n
export const TRUTH_AUCTION_MAX_TICK = 524288n

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

export type TruthAuctionDisposition = {
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
	currentTotalEth: bigint
	cumulativeEth: bigint
	disposition: TruthAuctionDisposition
	isSelected: boolean
	isPreviewTick: boolean
	submissionCount: bigint
}

export function estimateRepPurchased(ethAmount: bigint, price: bigint) {
	if (ethAmount <= 0n || price <= 0n) return 0n
	return (ethAmount * TRUTH_AUCTION_PRICE_PRECISION) / price
}

export function getTruthAuctionWinningThresholdPrice(truthAuction: TruthAuctionMetrics | undefined) {
	if (truthAuction === undefined || !truthAuction.finalized || !truthAuction.underfunded || truthAuction.maxRepBeingSold === 0n) return undefined
	return (truthAuction.ethRaised * TRUTH_AUCTION_PRICE_PRECISION) / truthAuction.maxRepBeingSold
}

function getTruthAuctionTickDisposition(tickSummary: TruthAuctionTickSummary, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionDisposition {
	if (tickSummary.currentTotalEth === 0n) return { label: 'Historical', tone: 'default' }
	if (truthAuction === undefined) return { label: 'Live', tone: 'default' }
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuction)
	if (winningThresholdPrice !== undefined) return tickSummary.price >= winningThresholdPrice ? { label: 'Winning', tone: 'success' } : { label: 'Out', tone: 'danger' }
	if (!truthAuction.hitCap || truthAuction.clearingTick === undefined || truthAuction.clearingPrice === undefined) return truthAuction.finalized ? { label: 'Winning', tone: 'success' } : { label: 'In Book', tone: 'default' }
	if (tickSummary.tick > truthAuction.clearingTick) return { label: truthAuction.finalized ? 'Winning' : 'Above Clearing', tone: 'success' }
	if (tickSummary.tick < truthAuction.clearingTick) return { label: truthAuction.finalized ? 'Out' : 'Below Clearing', tone: 'danger' }
	return { label: truthAuction.finalized ? 'Clearing' : 'At Clearing', tone: 'warning' }
}

export function getTruthAuctionBidDisposition(bid: TruthAuctionBidView, truthAuction: TruthAuctionMetrics | undefined): TruthAuctionBidDisposition {
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
			return { label: 'Refundable', tone: 'danger', canPrefillRefund: true, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refundable' }
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
			return { label: 'Refundable', tone: 'danger', canPrefillRefund: true, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refundable' }
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
			return { label: 'Refundable', tone: 'danger', canPrefillRefund: true, canPrefillSettle: false, settlementKind: 'ethRefund', summaryKind: 'refundable' }
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

export function sortTruthAuctionBidsByPriority(bids: TruthAuctionBidView[]) {
	return [...bids].sort((left, right) => {
		if (left.tick !== right.tick) return left.tick > right.tick ? -1 : 1
		if (left.bidIndex !== right.bidIndex) return left.bidIndex < right.bidIndex ? -1 : 1
		return 0
	})
}

function assertTruthAuctionTickInContractDomain(tick: bigint) {
	if (tick < TRUTH_AUCTION_MIN_TICK || tick > TRUTH_AUCTION_MAX_TICK) throw new Error('Truth auction tick is outside the supported range.')
}

function normalizeTruthAuctionPriceInput(value: string) {
	if (value.startsWith('.')) return `0${value}`
	if (value.endsWith('.')) return `${value}0`
	return value
}

function computeTruthAuctionPriceAtTick(tick: bigint) {
	assertTruthAuctionTickInContractDomain(tick)
	const absoluteTick = tick < 0n ? -tick : tick
	let price = TRUTH_AUCTION_PRICE_PRECISION
	for (let bitIndex = 0; bitIndex < TRUTH_AUCTION_TICK_PRICE_POWERS.length; bitIndex += 1) {
		const bitMask = 1n << BigInt(bitIndex)
		const pricePower = TRUTH_AUCTION_TICK_PRICE_POWERS[bitIndex]
		if (pricePower === undefined) throw new Error(`Missing truth auction tick price power for bit ${bitIndex}`)
		if ((absoluteTick & bitMask) !== 0n) price = (price * pricePower) / TRUTH_AUCTION_PRICE_PRECISION
	}
	return tick < 0n ? (TRUTH_AUCTION_PRICE_PRECISION * TRUTH_AUCTION_PRICE_PRECISION) / price : price
}

function findTruthAuctionMinSupportedTick() {
	let lowerTick = TRUTH_AUCTION_MIN_TICK
	let upperTick = 0n
	while (upperTick - lowerTick > 1n) {
		const midTick = (lowerTick + upperTick) / 2n
		if (computeTruthAuctionPriceAtTick(midTick) > 0n) {
			upperTick = midTick
			continue
		}
		lowerTick = midTick
	}
	return computeTruthAuctionPriceAtTick(lowerTick) > 0n ? lowerTick : upperTick
}

export const TRUTH_AUCTION_MIN_SUPPORTED_TICK = findTruthAuctionMinSupportedTick()

function assertTruthAuctionTickInRange(tick: bigint) {
	if (tick < TRUTH_AUCTION_MIN_SUPPORTED_TICK || tick > TRUTH_AUCTION_MAX_TICK) throw new Error('Truth auction tick is outside the supported range.')
}

export function getTruthAuctionPriceAtTick(tick: bigint) {
	assertTruthAuctionTickInRange(tick)
	return computeTruthAuctionPriceAtTick(tick)
}

const TRUTH_AUCTION_MAX_PRICE = getTruthAuctionPriceAtTick(TRUTH_AUCTION_MAX_TICK)
const TRUTH_AUCTION_MIN_PRICE = getTruthAuctionPriceAtTick(TRUTH_AUCTION_MIN_SUPPORTED_TICK)

function formatTruthAuctionValidationPrice(price: bigint) {
	const wholePart = (price / TRUTH_AUCTION_PRICE_PRECISION).toString()
	const fractionalDigits = (price % TRUTH_AUCTION_PRICE_PRECISION).toString().padStart(18, '0').replace(/0+$/, '')
	return fractionalDigits === '' ? wholePart : `${wholePart}.${fractionalDigits}`
}

const TRUTH_AUCTION_MAX_PRICE_INPUT = formatTruthAuctionValidationPrice(TRUTH_AUCTION_MAX_PRICE)
const truthAuctionMaxPriceParts = TRUTH_AUCTION_MAX_PRICE_INPUT.split('.')
const TRUTH_AUCTION_MAX_PRICE_WHOLE = truthAuctionMaxPriceParts[0] ?? '0'
const rawTruthAuctionMaxPriceFraction = truthAuctionMaxPriceParts[1] ?? ''
const TRUTH_AUCTION_MAX_PRICE_FRACTION = rawTruthAuctionMaxPriceFraction.padEnd(18, '0')

function isTruthAuctionPriceInputDefinitelyOutOfRange(input: string) {
	const normalized = normalizeTruthAuctionPriceInput(input.trim())
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

export function getTruthAuctionTickAtPrice(price: bigint): bigint | undefined {
	if (price <= 0n) return undefined
	if (price < TRUTH_AUCTION_MIN_PRICE) return undefined
	if (price === TRUTH_AUCTION_PRICE_PRECISION) return 0n
	if (price > TRUTH_AUCTION_MAX_PRICE) return undefined
	if (price === TRUTH_AUCTION_MAX_PRICE) return TRUTH_AUCTION_MAX_TICK

	if (price >= TRUTH_AUCTION_PRICE_PRECISION) {
		let lowerTick = 0n
		let upperTick = TRUTH_AUCTION_MAX_TICK
		while (upperTick - lowerTick > 1n) {
			const midTick = (lowerTick + upperTick) / 2n
			const midPrice = getTruthAuctionPriceAtTick(midTick)
			if (midPrice <= price) {
				lowerTick = midTick
				continue
			}
			upperTick = midTick
		}
		return lowerTick
	}

	let lowerTick = TRUTH_AUCTION_MIN_SUPPORTED_TICK
	let upperTick = 0n
	while (upperTick - lowerTick > 1n) {
		const midTick = (lowerTick + upperTick) / 2n
		const midPrice = getTruthAuctionPriceAtTick(midTick)
		if (midPrice <= price) {
			lowerTick = midTick
			continue
		}
		upperTick = midTick
	}
	return lowerTick
}

export function getTruthAuctionBidPreview(submitBidPriceInput: string) {
	if (submitBidPriceInput.trim() === '') return undefined
	if (isTruthAuctionPriceInputDefinitelyOutOfRange(submitBidPriceInput)) return undefined
	const enteredBidPrice = tryParseTruthAuctionPriceInput(submitBidPriceInput)
	if (enteredBidPrice === undefined || enteredBidPrice <= 0n) return undefined
	const enteredBidTick = getTruthAuctionTickAtPrice(enteredBidPrice)
	if (enteredBidTick === undefined) return undefined
	return {
		price: enteredBidPrice,
		tick: enteredBidTick,
	}
}

export function getTruthAuctionBidPriceValidationMessage(submitBidPriceInput: string) {
	if (submitBidPriceInput.trim() === '') return 'Enter a bid price greater than zero.'
	if (isTruthAuctionPriceInputDefinitelyOutOfRange(submitBidPriceInput)) return 'Bid price is outside the supported auction range.'
	const enteredBidPrice = tryParseTruthAuctionPriceInput(submitBidPriceInput)
	if (enteredBidPrice === undefined) return 'Enter a valid bid price.'
	if (enteredBidPrice <= 0n) return 'Enter a bid price greater than zero.'
	if (getTruthAuctionTickAtPrice(enteredBidPrice) === undefined) return 'Bid price is outside the supported auction range.'
	return undefined
}

export function getTruthAuctionBidGuardMessage({
	accountAddress,
	currentTimestamp,
	isMainnet,
	submitBidAmountInput,
	truthAuction,
	walletEthBalance,
}: {
	accountAddress: string | undefined
	currentTimestamp?: bigint | undefined
	isMainnet: boolean
	submitBidAmountInput: string
	truthAuction: TruthAuctionMetrics | undefined
	walletEthBalance: bigint | undefined
}) {
	if (accountAddress === undefined) return 'Connect a wallet before submitting a truth auction bid.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before submitting a truth auction bid.'
	if (truthAuction === undefined) return 'Load the truth auction before bidding.'
	if (truthAuction.finalized) return 'Truth auction is already finalized.'
	const auctionHasEndedByTimestamp = currentTimestamp !== undefined && truthAuction.auctionEndsAt !== undefined && currentTimestamp >= truthAuction.auctionEndsAt
	if (auctionHasEndedByTimestamp || truthAuction.timeRemaining === 0n) return 'Truth auction has ended.'

	const trimmedAmount = submitBidAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a bid amount greater than zero.'
	const bidAmount = tryParseTruthAuctionAmountInput(trimmedAmount)
	if (bidAmount === undefined) return 'Enter a valid bid amount.'

	if (bidAmount <= 0n) return 'Enter a bid amount greater than zero.'
	if (bidAmount < truthAuction.minBidSize) return `Bid must be at least ${formatCurrencyBalance(truthAuction.minBidSize)} ETH.`
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (bidAmount > walletEthBalance) return `Need ${formatCurrencyBalance(bidAmount - walletEthBalance)} more ETH in this wallet to bid the selected amount.`
	return undefined
}
