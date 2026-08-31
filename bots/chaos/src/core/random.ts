import { randomInt } from 'node:crypto'

export type RandomIntegerSource = (minimumInclusive: number, maximumExclusive: number) => number

export const cryptoRandomInteger: RandomIntegerSource = (minimumInclusive, maximumExclusive) => randomInt(minimumInclusive, maximumExclusive)

function requireIntegerRange(minimumInclusive: number, maximumExclusive: number) {
	if (!Number.isSafeInteger(minimumInclusive) || !Number.isSafeInteger(maximumExclusive)) throw new Error('Random range bounds must be safe integers')
	if (minimumInclusive < 0 || maximumExclusive <= minimumInclusive) throw new Error('Random range must be non-negative and non-empty')
	if (maximumExclusive > 2 ** 48) throw new Error('Random range exceeds the cryptographic source limit')
}

export function randomInteger(minimumInclusive: number, maximumExclusive: number, source: RandomIntegerSource = cryptoRandomInteger) {
	requireIntegerRange(minimumInclusive, maximumExclusive)
	const selected = source(minimumInclusive, maximumExclusive)
	if (!Number.isSafeInteger(selected) || selected < minimumInclusive || selected >= maximumExclusive) {
		throw new Error(`Random source returned ${String(selected)} outside [${minimumInclusive.toString()}, ${maximumExclusive.toString()})`)
	}
	return selected
}

export function randomElement<T>(values: readonly T[], source: RandomIntegerSource = cryptoRandomInteger) {
	if (values.length === 0) throw new Error('Cannot select a random element from an empty collection')
	const selected = values[randomInteger(0, values.length, source)]
	if (selected === undefined) throw new Error('Random element selection returned no value')
	return selected
}

export function randomIntegerExcept(minimumInclusive: number, maximumInclusive: number, excluded: number | undefined, source: RandomIntegerSource = cryptoRandomInteger) {
	if (!Number.isSafeInteger(maximumInclusive) || maximumInclusive < minimumInclusive) throw new Error('Random inclusive range is invalid')
	const rangeSize = maximumInclusive - minimumInclusive + 1
	if (excluded === undefined || excluded < minimumInclusive || excluded > maximumInclusive) {
		return randomInteger(minimumInclusive, maximumInclusive + 1, source)
	}
	if (rangeSize < 2) throw new Error('Random range needs at least two values to exclude the previous value')
	const selected = randomInteger(minimumInclusive, maximumInclusive, source)
	return selected >= excluded ? selected + 1 : selected
}

export function randomDelaySeconds(minimumDelaySeconds: number, maximumDelaySeconds: number, previousDelaySeconds: number | undefined, source: RandomIntegerSource = cryptoRandomInteger) {
	if (!Number.isSafeInteger(minimumDelaySeconds) || !Number.isSafeInteger(maximumDelaySeconds) || minimumDelaySeconds < 60 || maximumDelaySeconds > 3_600 || maximumDelaySeconds <= minimumDelaySeconds) {
		throw new Error('Chaos delay range must contain at least two whole seconds between 60 and 3600')
	}
	return randomIntegerExcept(minimumDelaySeconds, maximumDelaySeconds, previousDelaySeconds, source)
}
