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

function getTruthAuctionTickPricePower(index: number) {
	const power = TRUTH_AUCTION_TICK_PRICE_POWERS[index]
	if (power === undefined) throw new Error('Auction tick price power index is out of bounds')
	return power
}

export function assertTruthAuctionTickInContractDomain(tick: bigint) {
	if (tick < TRUTH_AUCTION_MIN_TICK || tick > TRUTH_AUCTION_MAX_TICK) throw new Error('Truth auction tick is outside the supported range.')
}

export function tickToPrice(tick: bigint) {
	assertTruthAuctionTickInContractDomain(tick)
	const absoluteTick = tick < 0n ? -tick : tick
	let price = TRUTH_AUCTION_PRICE_PRECISION
	for (let bitIndex = 0; bitIndex < TRUTH_AUCTION_TICK_PRICE_POWERS.length; bitIndex += 1) {
		const bitMask = 1n << BigInt(bitIndex)
		if ((absoluteTick & bitMask) !== 0n) price = (price * getTruthAuctionTickPricePower(bitIndex)) / TRUTH_AUCTION_PRICE_PRECISION
	}
	return tick < 0n ? (TRUTH_AUCTION_PRICE_PRECISION * TRUTH_AUCTION_PRICE_PRECISION) / price : price
}

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

export function findTruthAuctionMinSupportedTick() {
	let lowerTick = TRUTH_AUCTION_MIN_TICK
	let upperTick = 0n
	while (upperTick - lowerTick > 1n) {
		const midTick = (lowerTick + upperTick) / 2n
		if (tickToPrice(midTick) > 0n) {
			upperTick = midTick
			continue
		}
		lowerTick = midTick
	}
	return tickToPrice(lowerTick) > 0n ? lowerTick : upperTick
}
