import { parseUnits } from '@zoltar/core-shared/evm/ethereum'
import * as commonCopy from '../copy/common.js'
import { normalizeNumericInput } from '../lib/numericInput.js'

const DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/

/** The character a user may type between whole and fractional digits. A period is always accepted; a comma only where the locale uses it. */
export type DecimalSeparator = '.' | ','

type DecimalInputProblem = 'empty' | 'invalid' | 'precision' | 'separator'

type DecimalInputResult = { problem: DecimalInputProblem; value?: undefined } | { problem?: undefined; value: bigint }

let cachedLocaleDecimalSeparator: DecimalSeparator | undefined

/**
 * Reads the decimal separator of `locale`, or of the browser locale when omitted. A comma is a decimal separator only
 * where the locale writes `1,5`; elsewhere it groups thousands, so `1,234` must not be read as 1.234.
 */
export function getLocaleDecimalSeparator(locale?: string): DecimalSeparator {
	if (locale === undefined && cachedLocaleDecimalSeparator !== undefined) return cachedLocaleDecimalSeparator
	const decimalPart = new Intl.NumberFormat(locale).formatToParts(1.5).find(part => part.type === 'decimal')
	const separator = decimalPart?.value === ',' ? ',' : '.'
	if (locale === undefined) cachedLocaleDecimalSeparator = separator
	return separator
}

function countCharacter(value: string, character: string) {
	return value.split(character).length - 1
}

/** Converts an accepted comma to a period, or returns undefined when the separators are mixed, repeated, or a comma the locale does not use for decimals. */
function normalizeDecimalSeparator(value: string, decimalSeparator: DecimalSeparator) {
	const commaCount = countCharacter(value, ',')
	const periodCount = countCharacter(value, '.')
	if (periodCount > 1 || commaCount > 1 || (commaCount > 0 && periodCount > 0)) return undefined
	if (commaCount === 0) return value
	return decimalSeparator === ',' ? value.replace(',', '.') : undefined
}

function normalizeDecimalInput(value: string) {
	const trimmed = normalizeNumericInput(value)
	if (trimmed === '') return trimmed
	if (trimmed === '.' || trimmed === '-.') return trimmed
	return (() => {
		if (trimmed.startsWith('.')) return `0${trimmed}`
		if (trimmed.endsWith('.')) return `${trimmed}0`

		return trimmed
	})()
}

function hasValidDecimalPrecision(value: string, units: number) {
	const fractionalPart = value.split('.')[1]
	if (fractionalPart === undefined) return true
	return fractionalPart.replace(/0+$/, '').length <= units
}

/**
 * Parses the input or explains why it cannot be parsed, so callers can choose between silent rejection and a specific message.
 * Whitespace is ignored, a period is the decimal separator, and a single comma is accepted instead only when `decimalSeparator`
 * (by default the browser locale's) is a comma. Mixed or repeated separators are rejected as `separator`, because they are
 * thousands separators whose meaning differs by locale.
 */
export function parseDecimalInputResult(value: string, units: number = 18, decimalSeparator: DecimalSeparator = getLocaleDecimalSeparator()): DecimalInputResult {
	if (!Number.isSafeInteger(units) || units < 0) throw new Error('Units must be a non-negative safe integer')
	const trimmed = normalizeNumericInput(value)
	if (trimmed === '') return { problem: 'empty' }
	const withPeriod = normalizeDecimalSeparator(trimmed, decimalSeparator)
	if (withPeriod === undefined) return { problem: 'separator' }
	const normalized = normalizeDecimalInput(withPeriod)
	if (!DECIMAL_INPUT_PATTERN.test(normalized)) return { problem: 'invalid' }
	if (!hasValidDecimalPrecision(normalized, units)) return { problem: 'precision' }
	return { value: parseUnits(normalized, units) }
}

/** States which separators the parser accepts, for messages about a rejected separator. */
export function getDecimalSeparatorError(decimalSeparator: DecimalSeparator = getLocaleDecimalSeparator()) {
	return decimalSeparator === ',' ? commonCopy.decimalSeparatorPeriodOrCommaError : commonCopy.decimalSeparatorPeriodError
}

export function tryParseDecimalInput(value: string, units: number = 18, decimalSeparator?: DecimalSeparator) {
	return parseDecimalInputResult(value, units, decimalSeparator).value
}

export function parseDecimalInput(value: string, label: string, units: number = 18, decimalSeparator?: DecimalSeparator) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required.`)
	const result = parseDecimalInputResult(trimmed, units, decimalSeparator)
	if (result.problem === 'separator') throw new Error(commonCopy.formatDecimalSeparatorRequiredError(label, getDecimalSeparatorError(decimalSeparator)))
	if (result.value === undefined) throw new Error(commonCopy.formatDecimalNumberRequiredError(label))
	return result.value
}

export function tryParseNonNegativeDecimalInput(value: string, units: number = 18, decimalSeparator?: DecimalSeparator) {
	const parsed = tryParseDecimalInput(value, units, decimalSeparator)
	return parsed === undefined || parsed < 0n ? undefined : parsed
}

/** Throws the user-facing reason for a rejected amount so forms can surface it next to the field. */
export function parseNonNegativeDecimalInput(value: string, units: number = 18, decimalSeparator?: DecimalSeparator) {
	const result = parseDecimalInputResult(value, units, decimalSeparator)
	if (result.problem === 'precision') throw new Error(commonCopy.formatDecimalPrecisionError(units))
	if (result.problem === 'separator') throw new Error(getDecimalSeparatorError(decimalSeparator))
	if (result.value === undefined || result.value < 0n) throw new Error(commonCopy.nonNegativeAmountRequiredError)
	return result.value
}
