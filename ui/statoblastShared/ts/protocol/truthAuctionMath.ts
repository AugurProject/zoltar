import { findTruthAuctionMinSupportedTick, tickToPrice, TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'
import { ceilDiv } from '@zoltar/core-shared/math/bigint'

const TRUTH_AUCTION_MIN_SUPPORTED_TICK = findTruthAuctionMinSupportedTick()

function assertTruthAuctionTickInRange(tick: bigint) {
	if (tick < TRUTH_AUCTION_MIN_SUPPORTED_TICK || tick > TRUTH_AUCTION_MAX_TICK) throw new Error('Truth auction tick is outside the supported range.')
}

export function getTruthAuctionPriceAtTick(tick: bigint) {
	assertTruthAuctionTickInRange(tick)
	return tickToPrice(tick)
}

const TRUTH_AUCTION_MAX_PRICE = getTruthAuctionPriceAtTick(TRUTH_AUCTION_MAX_TICK)
const TRUTH_AUCTION_MIN_PRICE = getTruthAuctionPriceAtTick(TRUTH_AUCTION_MIN_SUPPORTED_TICK)

export function getTruthAuctionTickAtPrice(price: bigint): bigint | undefined {
	if (price <= 0n || price < TRUTH_AUCTION_MIN_PRICE || price > TRUTH_AUCTION_MAX_PRICE) return undefined
	if (price === TRUTH_AUCTION_PRICE_PRECISION) return 0n
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

export function formatTruthAuctionValidationPrice(price: bigint) {
	const wholePart = (price / TRUTH_AUCTION_PRICE_PRECISION).toString()
	const fractionalDigits = (price % TRUTH_AUCTION_PRICE_PRECISION).toString().padStart(18, '0').replace(/0+$/, '')
	return fractionalDigits === '' ? wholePart : `${wholePart}.${fractionalDigits}`
}

const MIN_TICK_PRICE_INPUT_DECIMALS = 6

/** The shortest bid-price input, with at least six decimals, that maps back to `tick`; it rounds up so it never falls to the tick below. */
export function formatTruthAuctionTickPriceInput(tick: bigint) {
	const price = getTruthAuctionPriceAtTick(tick)
	for (let decimals = MIN_TICK_PRICE_INPUT_DECIMALS; decimals < 18; decimals += 1) {
		const step = 10n ** BigInt(18 - decimals)
		const roundedUpPrice = ceilDiv(price, step) * step
		if (getTruthAuctionTickAtPrice(roundedUpPrice) === tick) return formatTruthAuctionValidationPrice(roundedUpPrice)
	}
	return formatTruthAuctionValidationPrice(price)
}
