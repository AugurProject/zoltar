const FIXED_POINT_SCALING_FACTOR = 10n ** 18n

const powerOf1_0001 = (index: number): bigint => {
	if (index === 0) return 1000100000000000000n
	if (index === 1) return 1000200010000000000n
	if (index === 2) return 1000400060004000100n
	if (index === 3) return 1000800280056007000n
	if (index === 4) return 1001601200560182043n
	if (index === 5) return 1003204964963598014n
	if (index === 6) return 1006420201727613920n
	if (index === 7) return 1012881622445451097n
	if (index === 8) return 1025929181087729343n
	if (index === 9) return 1052530684607338948n
	if (index === 10) return 1107820842039993613n
	if (index === 11) return 1227267018058200482n
	if (index === 12) return 1506184333613467388n
	if (index === 13) return 2268591246822644826n
	if (index === 14) return 5146506245160322222n
	if (index === 15) return 26486526531474198664n
	if (index === 16) return 701536087702486644953n
	if (index === 17) return 492152882348911033633683n
	if (index === 18) return 242214459604341065650571799093n
	if (index === 19) return 58667844441422969901301586347865591163491n
	throw new Error('Index out of bounds') }

export const tickToPrice = (tick: bigint): bigint => {
	if (tick < -524288 || tick > 524288) throw new Error('tick out of bounds')
	const absoluteTick = tick < 0 ? BigInt(-tick) : BigInt(tick)
	let price = FIXED_POINT_SCALING_FACTOR
	for (let bitIndex = 0; bitIndex < 20; bitIndex++) {
		const bitMask = 1n << BigInt(bitIndex)
		if ((absoluteTick & bitMask) !== 0n) price = price * powerOf1_0001(bitIndex) / FIXED_POINT_SCALING_FACTOR
	}
	if (tick < 0) price = FIXED_POINT_SCALING_FACTOR * FIXED_POINT_SCALING_FACTOR / price
	return price
}

export const priceToClosestTick = (price: bigint): bigint => {
	if (price <= 0n) throw new Error('price must be positive')

	const minimumTick = -524288n
	const maximumTick = 524288n

	let lowerBoundTick = minimumTick
	let upperBoundTick = maximumTick

	while (lowerBoundTick <= upperBoundTick) {
		const middleTick = (lowerBoundTick + upperBoundTick) / 2n
		const middlePrice = tickToPrice(middleTick)

		if (middlePrice === price) return middleTick

		if (middlePrice < price) {
			lowerBoundTick = middleTick + 1n
		} else {
			upperBoundTick = middleTick - 1n
		}
	}

	// lowerBoundTick is now the first tick whose price is greater than input price
	if (lowerBoundTick > maximumTick) return maximumTick
	if (upperBoundTick < minimumTick) return minimumTick

	const priceAtLowerTick = tickToPrice(lowerBoundTick)
	const priceAtUpperTick = tickToPrice(upperBoundTick)

	const distanceToLowerTick = priceAtLowerTick > price ? priceAtLowerTick - price : price - priceAtLowerTick
	const distanceToUpperTick = priceAtUpperTick > price ? priceAtUpperTick - price : price - priceAtUpperTick
	return distanceToLowerTick < distanceToUpperTick ? lowerBoundTick : upperBoundTick
}
