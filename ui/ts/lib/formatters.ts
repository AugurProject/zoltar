import { formatEther, formatUnits } from 'viem'

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60n
const SECONDS_PER_HOUR = 60n * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR

function formatGroupedInteger(value: bigint) {
	return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function formatDecimalString(value: string) {
	const isNegative = value.startsWith('-')
	const unsignedValue = isNegative ? value.slice(1) : value
	const [integerPart = '0', fractionalPart] = unsignedValue.split('.')
	const formattedIntegerPart = formatGroupedInteger(BigInt(integerPart))

	return `${isNegative ? '-' : ''}${formattedIntegerPart}${fractionalPart === undefined ? '' : `.${fractionalPart}`}`
}

function assertInteger(value: number, label: string) {
	if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer`)
}

function assertNonNegativeInteger(value: number, label: string) {
	assertInteger(value, label)
	if (value < 0) throw new RangeError(`${label} must be non-negative`)
}

export function formatCurrencyBalance(value: bigint | undefined, units: number = 18) {
	if (value === undefined) return 'Unavailable'
	assertInteger(units, 'Units')
	const formattedValue = units === 18 ? formatEther(value) : formatUnits(value, units)
	return formatDecimalString(formattedValue)
}

export function formatRoundedCurrencyBalance(value: bigint | undefined, units: number = 18, decimals: number = 2) {
	if (value === undefined) return 'Unavailable'
	assertNonNegativeInteger(units, 'Units')
	assertInteger(decimals, 'Decimals')
	if (decimals < 0) return formatCurrencyBalance(value, units)

	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const scale = 10n ** BigInt(decimals)
	const base = 10n ** BigInt(units)
	const rounded = (absoluteValue * scale + base / 2n) / base
	const integerPart = rounded / scale
	const prefix = isNegative ? '-' : ''

	if (decimals === 0) {
		return `${prefix}${formatGroupedInteger(integerPart)}`
	}

	const fractionalPart = rounded % scale
	return `${prefix}${formatGroupedInteger(integerPart)}.${fractionalPart.toString().padStart(decimals, '0')}`
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

	if (days > 0n) return `${days}d ${hours}h ${minutes}m`
	if (hours > 0n) return `${hours}h ${minutes}m`
	return `${minutes}m`
}
