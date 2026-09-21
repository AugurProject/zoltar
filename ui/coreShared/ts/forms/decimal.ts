import { parseUnits } from '@zoltar/core-shared/evm/ethereum'
import * as commonCopy from '../copy/common.js'
import { normalizeNumericInput } from '../lib/numericInput.js'

const DECIMAL_INPUT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/

type DecimalInputProblem = 'empty' | 'invalid' | 'precision'

type DecimalInputResult = { problem: DecimalInputProblem; value?: undefined } | { problem?: undefined; value: bigint }

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

/** Parses the input or explains why it cannot be parsed, so callers can choose between silent rejection and a specific message. */
export function parseDecimalInputResult(value: string, units: number = 18): DecimalInputResult {
	if (!Number.isSafeInteger(units) || units < 0) throw new Error('Units must be a nonnegative safe integer')
	const trimmed = normalizeNumericInput(value)
	if (trimmed === '') return { problem: 'empty' }
	const normalized = normalizeDecimalInput(trimmed)
	if (!DECIMAL_INPUT_PATTERN.test(normalized)) return { problem: 'invalid' }
	if (!hasValidDecimalPrecision(normalized, units)) return { problem: 'precision' }
	return { value: parseUnits(normalized, units) }
}

export function tryParseDecimalInput(value: string, units: number = 18) {
	return parseDecimalInputResult(value, units).value
}

export function parseDecimalInput(value: string, label: string, units: number = 18) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	const parsed = tryParseDecimalInput(trimmed, units)
	if (parsed === undefined) throw new Error(commonCopy.formatDecimalNumberRequiredError(label))
	return parsed
}

export function tryParseNonNegativeDecimalInput(value: string, units: number = 18) {
	const parsed = tryParseDecimalInput(value, units)
	return parsed === undefined || parsed < 0n ? undefined : parsed
}

/** Throws the user-facing reason for a rejected amount so forms can surface it next to the field. */
export function parseNonNegativeDecimalInput(value: string, units: number = 18) {
	const result = parseDecimalInputResult(value, units)
	if (result.problem === 'precision') throw new Error(commonCopy.formatDecimalPrecisionError(units))
	if (result.value === undefined || result.value < 0n) throw new Error(commonCopy.nonNegativeAmountRequiredError)
	return result.value
}
