/**
 * Shared display formatting spec for every protocol UI. Use these helpers instead of ad-hoc string building.
 *
 * | Kind            | Helper                                   | Output                                                                  |
 * | --------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
 * | Token amount    | `formatAmount` / `formatAmountDisplay`   | `1 234.57`: space-grouped, 2 decimals, tiny values keep 2 significant   |
 * |                 |                                          | digits. `≈ ` is prefixed only when rounding dropped non-zero digits,    |
 * |                 |                                          | so `2.00`, `0.00` and `10k` stay unmarked.                              |
 * | Compact amount  | `formatAmount(..., notation: 'compact')` | Below 1 000 the standard form; from 1 000 an SI suffix with 1 decimal   |
 * |                 |                                          | (`1.2k`, `1T`). Deterministic: never depends on the available width.    |
 * | Exact amount    | `formatCurrencyBalance`                  | Every significant digit; used for titles, copy and inputs.              |
 * | Percentage      | `formatScaledPercentage`                 | Fixed-point value with trailing zeros trimmed and no space: `0.3%`.     |
 * | Multiplier      | `formatMultiplier`                       | Fixed-point value with trailing zeros trimmed and `×`: `2.5×`, `125×`.  |
 * | Date and time   | `formatTimestamp`                        | `2026-01-01 00:00:21 UTC`; `formatTimestampWithRelative` appends        |
 * |                 |                                          | `(in 3d 2h 1m)` / `(5m ago)`; durations use `formatDuration` (`1d 2h 3m`). |
 *
 * Units follow the amount after a space (`formatUnitSuffix`, or a non-breaking space in plain strings via `formatValueWithUnit`); `%` and `×` attach directly.
 */
import { bigintToSafeNumber, formatEther, formatUnits } from '@zoltar/core-shared/evm/ethereum'

const MILLISECONDS_PER_SECOND = 1000
const MAX_DATE_TIMESTAMP_SECONDS = 8_640_000_000_000n
const SECONDS_PER_MINUTE = 60n
const SECONDS_PER_HOUR = 60n * SECONDS_PER_MINUTE
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR
const SI_SUFFIXES = ['k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'] as const
const COMPACT_NOTATION_THRESHOLD_UNITS = 1000n
const COMPACT_NOTATION_DECIMALS = 1
const APPROXIMATE_MARKER = '≈ '
export const MULTIPLIER_SIGN = '×'

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
		approximate: (value * scale) % divisor !== 0n,
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
		if (rounded.integerPart < 10n) return { approximate: rounded.approximate, text: `${isNegative ? '-' : ''}${rounded.text}E${exponent}` }
		exponent += 1
	}
}

function formatTimestampPart(value: number) {
	return value.toString().padStart(2, '0')
}

function formatUtcTimestamp(timestamp: bigint) {
	if (timestamp < -MAX_DATE_TIMESTAMP_SECONDS || timestamp > MAX_DATE_TIMESTAMP_SECONDS) return undefined
	const date = new Date(bigintToSafeNumber(timestamp * BigInt(MILLISECONDS_PER_SECOND), 'Timestamp'))
	if (Number.isNaN(date.getTime())) return undefined
	return `${date.getUTCFullYear()}-${formatTimestampPart(date.getUTCMonth() + 1)}-${formatTimestampPart(date.getUTCDate())} ${formatTimestampPart(date.getUTCHours())}:${formatTimestampPart(date.getUTCMinutes())}:${formatTimestampPart(date.getUTCSeconds())} UTC`
}

export function formatTimestampDateTime(timestamp: bigint) {
	if (timestamp < -MAX_DATE_TIMESTAMP_SECONDS || timestamp > MAX_DATE_TIMESTAMP_SECONDS) return undefined
	const date = new Date(bigintToSafeNumber(timestamp * BigInt(MILLISECONDS_PER_SECOND), 'Timestamp'))
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function getEffectiveRoundedDecimals(absoluteValue: bigint, units: number, decimals: number) {
	if (absoluteValue === 0n) return decimals

	const base = 10n ** BigInt(units)
	if (absoluteValue >= base) return decimals

	const leadingFractionalZeroCount = units - absoluteValue.toString().length
	return Math.max(decimals, leadingFractionalZeroCount + 2)
}

export function formatCurrencyBalance(value: bigint | undefined, units: number = 18) {
	if (value === undefined) return '—'
	assertInteger(units, 'Units')
	const formattedValue = units === 18 ? formatEther(value) : formatUnits(value, units)
	return formatDecimalString(formattedValue)
}

/** Separates a unit from its amount with a space, except the percent and multiplier signs, which attach directly. */
export function formatUnitSuffix(unit: string) {
	if (unit === '') return ''
	return unit === '%' || unit === MULTIPLIER_SIGN ? unit : ` ${unit}`
}

export function formatValueWithUnit(value: string, unit: string) {
	return `${value}\u00a0${unit}`
}

export function formatCurrencyBalanceWithUnit(value: bigint | undefined, unit: string, units: number = 18) {
	return formatValueWithUnit(formatCurrencyBalance(value, units), unit)
}

export function formatAdditionalCurrencyBalance(value: bigint, unit: string, units: number = 18) {
	return `${formatCurrencyBalance(value, units)}\u00a0more\u00a0${unit}`
}

export function formatCurrencyInputBalance(value: bigint, units: number = 18) {
	assertInteger(units, 'Units')
	return units === 18 ? formatEther(value) : formatUnits(value, units)
}

export function formatTrimmedUnits(value: bigint, units: number = 18, maximumFractionDigits: number = 4) {
	assertNonNegativeInteger(units, 'Units')
	assertNonNegativeInteger(maximumFractionDigits, 'Maximum fraction digits')
	const negative = value < 0n
	const absoluteValue = negative ? -value : value
	const base = 10n ** BigInt(units)
	const whole = absoluteValue / base
	const fraction = (absoluteValue % base).toString().padStart(units, '0').slice(0, maximumFractionDigits).replace(/0+$/, '')
	return `${negative ? '-' : ''}${formatGroupedInteger(whole)}${fraction.length > 0 ? `.${fraction}` : ''}`
}

export function formatRoundedCurrencyBalance(value: bigint | undefined, units: number = 18, decimals: number = 2) {
	if (value === undefined) return '—'
	assertNonNegativeInteger(units, 'Units')
	assertInteger(decimals, 'Decimals')
	if (decimals < 0) return formatCurrencyBalance(value, units)

	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const prefix = isNegative ? '-' : ''

	const effectiveDecimals = getEffectiveRoundedDecimals(absoluteValue, units, decimals)

	const scale = 10n ** BigInt(effectiveDecimals)
	const base = 10n ** BigInt(units)
	const rounded = (absoluteValue * scale + base / 2n) / base
	const integerPart = rounded / scale

	if (effectiveDecimals === 0) return `${prefix}${formatGroupedInteger(integerPart)}`

	const fractionalPart = rounded % scale
	return `${prefix}${formatGroupedInteger(integerPart)}.${fractionalPart.toString().padStart(effectiveDecimals, '0')}`
}

function formatCompactScaledValue(value: bigint, units: number, decimals: number) {
	const isNegative = value < 0n
	const absoluteValue = isNegative ? -value : value
	const unitBase = 10n ** BigInt(units)
	const wholeUnits = absoluteValue / unitBase
	let suffixIndex = Math.max(Math.floor((wholeUnits.toString().length - 1) / 3) - 1, 0)

	while (suffixIndex < SI_SUFFIXES.length) {
		const divisor = 1000n ** BigInt(suffixIndex + 1) * unitBase
		const rounded = formatRoundedScaledValue(absoluteValue, divisor, decimals)
		if (rounded.integerPart < 1000n) return { approximate: rounded.approximate, text: `${isNegative ? '-' : ''}${rounded.text}${SI_SUFFIXES[suffixIndex]}` }
		suffixIndex += 1
	}

	return formatScientificCurrencyBalance(value, units, decimals)
}

export type AmountNotation = 'standard' | 'compact'

export type FormattedAmount = {
	/** True when the displayed text dropped non-zero digits of the exact value. */
	approximate: boolean
	/** Every significant digit, space-grouped, for titles, copy, and accessible descriptions. */
	exact: string
	/** The rounded display text without the approximation marker. */
	text: string
}

/** Rounds a fixed-point amount for display and reports whether rounding lost precision. See the spec at the top of this file. */
export function formatAmount(value: bigint, { decimals = 2, notation = 'standard', units = 18 }: { decimals?: number; notation?: AmountNotation; units?: number } = {}): FormattedAmount {
	assertNonNegativeInteger(units, 'Units')
	assertNonNegativeInteger(decimals, 'Decimals')
	const exact = formatCurrencyBalance(value, units)
	const absoluteValue = value < 0n ? -value : value
	const base = 10n ** BigInt(units)

	const effectiveDecimals = getEffectiveRoundedDecimals(absoluteValue, units, decimals)
	const scale = 10n ** BigInt(effectiveDecimals)
	// Decide on the rounded value so 999.996 reads `≈ 1k`, never `≈ 1 000.00`.
	const roundsToCompactThreshold = (absoluteValue * scale + base / 2n) / base >= COMPACT_NOTATION_THRESHOLD_UNITS * scale
	if (notation === 'compact' && roundsToCompactThreshold) {
		const compact = formatCompactScaledValue(value, units, COMPACT_NOTATION_DECIMALS)
		return { approximate: compact.approximate, exact, text: compact.text }
	}

	return { approximate: (absoluteValue * scale) % base !== 0n, exact, text: formatRoundedCurrencyBalance(value, units, decimals) }
}

/** Marks rounded text with `≈ ` only when rounding dropped digits. */
export function withApproximateMarker({ approximate, text }: Pick<FormattedAmount, 'approximate' | 'text'>) {
	return approximate ? `${APPROXIMATE_MARKER}${text}` : text
}

export function formatAmountDisplay(value: bigint, options?: { decimals?: number; notation?: AmountNotation; units?: number }) {
	return withApproximateMarker(formatAmount(value, options))
}

/** Formats a fixed-point multiplier (for example basis points with `units = 4`) as `2.5×`. */
export function formatMultiplier(value: bigint, units: number, maximumFractionDigits: number = units) {
	return `${formatTrimmedUnits(value, units, maximumFractionDigits)}${MULTIPLIER_SIGN}`
}

/** Appends the multiplier sign to an already formatted decimal, such as a form value the user typed. */
export function formatMultiplierText(value: string) {
	return `${value}${MULTIPLIER_SIGN}`
}

/** Formats a fixed-point percentage (for example basis points of a percent with `units = 2`) as `0.3%`. */
export function formatScaledPercentage(value: bigint, units: number, maximumFractionDigits: number = units) {
	return `${formatTrimmedUnits(value, units, maximumFractionDigits)}%`
}

export function formatTimestamp(timestamp: bigint) {
	if (timestamp === 0n) return 'Immediate'
	return formatUtcTimestamp(timestamp) ?? `Invalid timestamp (${timestamp.toString()})`
}

export function formatRelativeTimestamp(timestamp: bigint, currentTimestamp: bigint) {
	const delta = timestamp - currentTimestamp
	if (delta === 0n) return 'now'
	if (delta > 0n) return `in ${formatDuration(delta)}`
	return `${formatDuration(-delta)} ago`
}

export function getWallClockTimestamp() {
	return BigInt(Math.floor(Date.now() / 1_000))
}

export function formatTimestampWithRelative(timestamp: bigint, currentTimestamp = getWallClockTimestamp()) {
	return `${formatTimestamp(timestamp)} (${formatRelativeTimestamp(timestamp, currentTimestamp)})`
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
