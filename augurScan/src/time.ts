const minimumDateMilliseconds = -8_640_000_000_000_000n
const maximumDateMilliseconds = 8_640_000_000_000_000n

export const bigintToSafeNumber = (value: bigint, name: string): number => {
	const result = Number.parseInt(value.toString(), 10)
	if (!Number.isSafeInteger(result)) throw new Error(`${name} is outside the safe integer range`)
	return result
}

export const unixSecondsToDate = (seconds: bigint, name = 'Timestamp'): Date => {
	const milliseconds = seconds * 1000n
	if (milliseconds < minimumDateMilliseconds || milliseconds > maximumDateMilliseconds) {
		throw new Error(`${name} is outside the supported timestamp range`)
	}
	return new Date(bigintToSafeNumber(milliseconds, name))
}
