import { tickToPrice, TRUTH_AUCTION_MAX_TICK } from '@zoltar/statoblast-shared/statoblast/truthAuctionTickMath'

// UniformPriceDualCapBatchAuction's lowest representable tick; the UI never bids below the supported minimum.
const TRUTH_AUCTION_MIN_TICK = -524288n

// Reference inversion of tickToPrice used to pick contract ticks for test bids.
export function priceToClosestTick(price: bigint): bigint {
	if (price <= 0n) throw new Error('price must be positive')
	let lowerBoundTick = TRUTH_AUCTION_MIN_TICK
	let upperBoundTick = TRUTH_AUCTION_MAX_TICK
	while (lowerBoundTick <= upperBoundTick) {
		const middleTick = (lowerBoundTick + upperBoundTick) / 2n
		const middlePrice = tickToPrice(middleTick)
		if (middlePrice === price) return middleTick
		if (middlePrice < price) {
			lowerBoundTick = middleTick + 1n
			continue
		}
		upperBoundTick = middleTick - 1n
	}
	if (lowerBoundTick > TRUTH_AUCTION_MAX_TICK) return TRUTH_AUCTION_MAX_TICK
	if (upperBoundTick < TRUTH_AUCTION_MIN_TICK) return TRUTH_AUCTION_MIN_TICK
	const priceAtLowerTick = tickToPrice(lowerBoundTick)
	const priceAtUpperTick = tickToPrice(upperBoundTick)
	const distanceToLowerTick = priceAtLowerTick > price ? priceAtLowerTick - price : price - priceAtLowerTick
	const distanceToUpperTick = priceAtUpperTick > price ? priceAtUpperTick - price : price - priceAtUpperTick
	return distanceToLowerTick < distanceToUpperTick ? lowerBoundTick : upperBoundTick
}
