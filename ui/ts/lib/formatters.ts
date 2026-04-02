import { formatEther, formatUnits } from 'viem'

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60n
const SECONDS_PER_HOUR = 60n * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR

function formatDecimalString(value: string) {
	const isNegative = value.startsWith('-')
	const unsignedValue = isNegative ? value.slice(1) : value
	const [integerPart = '0', fractionalPart] = unsignedValue.split('.')
	const formattedIntegerPart = BigInt(integerPart).toLocaleString()

	return `${ isNegative ? '-' : '' }${ formattedIntegerPart }${ fractionalPart === undefined ? '' : `.${ fractionalPart }` }`
}

export function formatCurrencyBalance(value: bigint | undefined, units: number = 18) {
	if (value === undefined) return 'Unavailable'
	const formattedValue = units === 18 ? formatEther(value) : formatUnits(value, units)
	return formatDecimalString(formattedValue)
}

export function formatTimestamp(timestamp: bigint) {
	if (timestamp === 0n) return 'Immediate'
	return new Date(Number(timestamp) * MILLISECONDS_PER_SECOND).toLocaleString()
}

export function formatDuration(seconds: bigint) {
	if (seconds <= 0n) return '0m'

	const days = seconds / SECONDS_PER_DAY
	const hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR
	const minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE

	if (days > 0n) return `${ days }d ${ hours }h ${ minutes }m`
	if (hours > 0n) return `${ hours }h ${ minutes }m`
	return `${ minutes }m`
}
