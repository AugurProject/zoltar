import { max, min } from './bigint.js'

const FIXED_POINT_SCALING_FACTOR = 10n ** 18n

const powerOf1_0001 = (index: number): bigint => {
	if (index === 0) return 1000000000000000100n
	if (index === 1) return 1000000000000000200n
	if (index === 2) return 1000000000000000400n
	if (index === 3) return 1000000000000000800n
	if (index === 4) return 1000000000000001600n
	if (index === 5) return 1000000000000003200n
	if (index === 6) return 1000000000000006400n
	if (index === 7) return 1000000000000012800n
	if (index === 8) return 1000000000000025600n
	if (index === 9) return 1000000000000051200n
	if (index === 10) return 1000000000000102400n
	if (index === 11) return 1000000000000204800n
	if (index === 12) return 1000000000000409600n
	if (index === 13) return 1000000000000819200n
	if (index === 14) return 1000000000001638400n
	if (index === 15) return 1000000000003276800n
	if (index === 16) return 1000000000006553600n
	if (index === 17) return 1000000000013107200n
	if (index === 18) return 1000000000026214400n
	if (index === 19) return 1000000000052428800n
	throw new Error('Index out of bounds')
}

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

export const priceToClosestTick = (targetPrice: bigint): bigint => {
	if (targetPrice <= 0n) throw new Error('price must be positive')
	let lowerBoundTick = -524288n
	let upperBoundTick = 524288n
	while (lowerBoundTick <= upperBoundTick) {
		const middleTick = (lowerBoundTick + upperBoundTick) / 2n
		const middlePrice = tickToPrice(middleTick)
		if (middlePrice === targetPrice) return middleTick
		if (middlePrice < targetPrice) {
			lowerBoundTick = middleTick + 1n
		} else {
			upperBoundTick = middleTick - 1n
		}
	}
	const candidateBelowTick = max(-524288n, upperBoundTick)
	const candidateAboveTick = min(524288n, lowerBoundTick)
	const priceBelow = tickToPrice(candidateBelowTick)
	const priceAbove = tickToPrice(candidateAboveTick)
	const distanceToBelow = priceBelow > targetPrice ? priceBelow - targetPrice : targetPrice - priceBelow
	const distanceToAbove = priceAbove > targetPrice ? priceAbove - targetPrice : targetPrice - priceAbove
	return distanceToBelow <= distanceToAbove ? candidateBelowTick : candidateAboveTick
}
