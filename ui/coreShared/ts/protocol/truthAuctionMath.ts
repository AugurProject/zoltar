import { findTruthAuctionMinSupportedTick, tickToPrice, TRUTH_AUCTION_MAX_TICK, TRUTH_AUCTION_PRICE_PRECISION } from '@zoltar/shared/truthAuctionTickMath'

export const TRUTH_AUCTION_MIN_SUPPORTED_TICK = findTruthAuctionMinSupportedTick()

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
