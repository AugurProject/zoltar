import { formatEther, formatUnits } from 'viem'

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60n
const SECONDS_PER_HOUR = 60n * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR
const SI_SUFFIXES = ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'] as const

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

function formatTrimmedDecimal(integerPart: bigint, fractionalPart: bigint, decimals: number) {
	if (decimals === 0 || fractionalPart === 0n) return integerPart.toString()

	return `${integerPart}.${fractionalPart.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

function formatRoundedScaledValue(value: bigint, divisor: bigint, decimals: number) {
	const scale = 10n ** BigInt(decimals)
	const rounded = (value * scale + divisor / 2n) / divisor
	const integerPart = rounded / scale
	const fractionalPart = rounded % scale

	return {
		integerPart,
		text: formatTrimmedDecimal(integerPart, fractionalPart, decimals),
	}
}

function formatScientificCurrencyBalance(value: bigint, units: number, decimals: number) {
	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const unitBase = 10n ** BigInt(units)
	const wholeUnits = absoluteValue / unitBase
	let exponent = wholeUnits.toString().length - 1

	while (true) {
		const divisor = 10n ** BigInt(exponent) * unitBase
		const rounded = formatRoundedScaledValue(absoluteValue, divisor, decimals)
		if (rounded.integerPart < 10n) return `${isNegative ? '-' : ''}${rounded.text}E${exponent}`
		exponent += 1
	}
}

function formatTimestampPart(value: number) {
	return value.toString().padStart(2, '0')
}

function formatUtcTimestamp(timestamp: bigint) {
	const date = new Date(Number(timestamp) * MILLISECONDS_PER_SECOND)
	return `${date.getUTCFullYear()}-${formatTimestampPart(date.getUTCMonth() + 1)}-${formatTimestampPart(date.getUTCDate())} ${formatTimestampPart(date.getUTCHours())}:${formatTimestampPart(date.getUTCMinutes())}:${formatTimestampPart(date.getUTCSeconds())} UTC`
}

export function formatCurrencyBalance(value: bigint | undefined, units: number = 18) {
	if (value === undefined) return '—'
	assertInteger(units, 'Units')
	const formattedValue = units === 18 ? formatEther(value) : formatUnits(value, units)
	return formatDecimalString(formattedValue)
}

export function formatCurrencyInputBalance(value: bigint, units: number = 18) {
	assertInteger(units, 'Units')
	return units === 18 ? formatEther(value) : formatUnits(value, units)
}

export function formatRoundedCurrencyBalance(value: bigint | undefined, units: number = 18, decimals: number = 2) {
	if (value === undefined) return '—'
	assertNonNegativeInteger(units, 'Units')
	assertInteger(decimals, 'Decimals')
	if (decimals < 0) return formatCurrencyBalance(value, units)

	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const prefix = isNegative ? '-' : ''

	// For tiny values between 0 and 1, extend decimal places to show 2 significant figures.
	// floatValue is used only for order-of-magnitude detection; bigint arithmetic handles rounding.
	const floatValue = Number(absoluteValue) / 10 ** units
	const effectiveDecimals = floatValue > 0 && floatValue < 1 ? Math.max(decimals, Math.ceil(-Math.log10(floatValue)) + 1) : decimals

	const scale = 10n ** BigInt(effectiveDecimals)
	const base = 10n ** BigInt(units)
	const rounded = (absoluteValue * scale + base / 2n) / base
	const integerPart = rounded / scale

	if (effectiveDecimals === 0) return `${prefix}${formatGroupedInteger(integerPart)}`

	const fractionalPart = rounded % scale
	return `${prefix}${formatGroupedInteger(integerPart)}.${fractionalPart.toString().padStart(effectiveDecimals, '0')}`
}

export function formatCompactCurrencyBalance(value: bigint | undefined, units: number = 18, decimals: number = 1) {
	if (value === undefined) return '—'
	assertNonNegativeInteger(units, 'Units')
	assertInteger(decimals, 'Decimals')
	if (decimals < 0) return formatCurrencyBalance(value, units)

	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const unitBase = 10n ** BigInt(units)

	if (absoluteValue < 1000n * unitBase) return formatRoundedCurrencyBalance(value, units, decimals)

	const wholeUnits = absoluteValue / unitBase
	let suffixIndex = Math.floor((wholeUnits.toString().length - 1) / 3) - 1

	while (suffixIndex < SI_SUFFIXES.length) {
		const divisor = 1000n ** BigInt(suffixIndex + 1) * unitBase
		const rounded = formatRoundedScaledValue(absoluteValue, divisor, decimals)
		if (rounded.integerPart < 1000n) return `${isNegative ? '-' : ''}${rounded.text}${SI_SUFFIXES[suffixIndex]}`
		suffixIndex += 1
	}

	return formatScientificCurrencyBalance(value, units, decimals)
}

export function formatTimestamp(timestamp: bigint) {
	if (timestamp === 0n) return 'Immediate'
	return formatUtcTimestamp(timestamp)
}

function formatRelativeDuration(seconds: bigint) {
	if (seconds < SECONDS_PER_MINUTE) return 'less than a minute'

	const days = seconds / SECONDS_PER_DAY
	const hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR
	const minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE

	if (days > 0n) return `${days}d ${hours}h ${minutes}m`

	if (hours > 0n) return `${hours}h ${minutes}m`

	return `${minutes}m`
}

export function formatRelativeTimestamp(timestamp: bigint, currentTimestamp: bigint) {
	const delta = timestamp - currentTimestamp
	if (delta === 0n) return 'now'
	if (delta > 0n) return `in ${formatRelativeDuration(delta)}`
	return `${formatRelativeDuration(-delta)} ago`
}

export function formatDuration(seconds: bigint) {
	if (seconds <= 0n) return '0m'
	if (seconds < SECONDS_PER_MINUTE) return 'less than a minute'

	const days = seconds / SECONDS_PER_DAY
	const hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR
	const minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE

	if (days > 0n) return `${days}d ${hours}h ${minutes}m`
	if (hours > 0n) return `${hours}h ${minutes}m`
	return `${minutes}m`
}
