import * as commonCopy from '../copy/common.js'
import { assertNever } from '../lib/assert.js'
import { formatCurrencyBalance, formatCurrencyBalanceWithUnit, formatTrimmedUnits, formatValueWithUnit, withApproximateMarker } from '../lib/formatters.js'
import { type DecimalSeparator, getDecimalSeparatorError, parseDecimalInputResult } from './decimal.js'

/** Accepts digits with one optional period or comma; `parseDecimalInputResult` decides whether the comma is a decimal separator in the user's locale. */
export const AMOUNT_INPUT_PATTERN = '[0-9 ]*[.,]?[0-9]*'

const DISPLAY_FRACTION_DIGITS = 4

export type AmountInputLimits = {
	/** Token decimals; inputs with more fractional digits are rejected. Defaults to 18. */
	decimals?: number | undefined
	/** Allows `0` as a complete amount. Negative amounts are always rejected. */
	allowZero?: boolean | undefined
	/** Inclusive lower bound. */
	minimum?: bigint | undefined
	/** Inclusive upper bound, such as the amount the protocol can accept. */
	maximum?: bigint | undefined
	/** Wallet or position balance the amount is drawn from. */
	balance?: bigint | undefined
	/** Decimal separator a comma may stand for; defaults to the browser locale's. */
	decimalSeparator?: DecimalSeparator | undefined
}

type AmountInputProblem = 'invalid' | 'precision' | 'separator' | 'negative' | 'zero' | 'belowMinimum' | 'exceedsBalance' | 'aboveMaximum'

export type AmountInputValidation = { status: 'empty' } | { status: 'valid'; amount: bigint } | { status: 'invalid'; problem: AmountInputProblem; amount?: bigint }

/** Parses an amount typed by the user and checks it against the known limits, in the order a user would fix them. */
export function validateAmountInput(value: string, { allowZero = false, balance, decimalSeparator, decimals = 18, maximum, minimum }: AmountInputLimits = {}): AmountInputValidation {
	const parsed = parseDecimalInputResult(value, decimals, decimalSeparator)
	if (parsed.problem === 'empty') return { status: 'empty' }
	if (parsed.problem !== undefined) return { status: 'invalid', problem: parsed.problem }
	const amount = parsed.value
	if (amount < 0n) return { status: 'invalid', problem: 'negative', amount }
	if (amount === 0n && !allowZero) return { status: 'invalid', problem: 'zero', amount }
	if (minimum !== undefined && amount < minimum) return { status: 'invalid', problem: 'belowMinimum', amount }
	if (balance !== undefined && amount > balance) return { status: 'invalid', problem: 'exceedsBalance', amount }
	if (maximum !== undefined && amount > maximum) return { status: 'invalid', problem: 'aboveMaximum', amount }
	return { status: 'valid', amount }
}

/**
 * Formats a balance or limit for hints and errors. It truncates toward zero so the figure never reads above the exact
 * amount a user may type back, marks dropped digits with `≈ `, and shows a dust amount exactly instead of as `0`.
 */
export function formatAmountForDisplay(amount: bigint, decimals: number = 18, unit?: string | undefined) {
	const fractionDigits = Math.min(decimals, DISPLAY_FRACTION_DIGITS)
	const droppedDivisor = 10n ** BigInt(decimals - fractionDigits)
	const absoluteAmount = amount < 0n ? -amount : amount
	const formatted = absoluteAmount !== 0n && absoluteAmount < droppedDivisor ? formatCurrencyBalance(amount, decimals) : withApproximateMarker({ approximate: absoluteAmount % droppedDivisor !== 0n, text: formatTrimmedUnits(amount, decimals, fractionDigits) })
	return unit === undefined ? formatted : formatValueWithUnit(formatted, unit)
}

/** Returns the message for every invalid amount, so a field never shows an error state without text; empty input is not an error. */
export function getAmountInputErrorMessage(validation: AmountInputValidation, { allowZero = false, balance, decimalSeparator, decimals = 18, maximum, minimum, unit }: AmountInputLimits & { unit?: string | undefined } = {}) {
	if (validation.status !== 'invalid') return undefined
	switch (validation.problem) {
		case 'invalid':
			return commonCopy.amountInvalidError
		case 'precision':
			return commonCopy.formatDecimalPrecisionError(decimals)
		case 'separator':
			return getDecimalSeparatorError(decimalSeparator)
		case 'negative':
			return allowZero ? commonCopy.nonNegativeAmountRequiredError : commonCopy.amountPositiveRequiredError
		case 'zero':
			return commonCopy.amountPositiveRequiredError
		case 'belowMinimum':
			// A truncated minimum could read lower than the real bound, so show it exactly.
			return minimum === undefined ? commonCopy.amountInvalidError : commonCopy.formatAmountBelowMinimumError(unit === undefined ? formatCurrencyBalance(minimum, decimals) : formatCurrencyBalanceWithUnit(minimum, unit, decimals))
		case 'exceedsBalance':
			return balance === undefined ? commonCopy.amountInvalidError : commonCopy.formatAmountExceedsBalanceError(formatAmountForDisplay(balance, decimals, unit))
		case 'aboveMaximum':
			return maximum === undefined ? commonCopy.amountInvalidError : commonCopy.formatAmountAboveMaximumError(formatAmountForDisplay(maximum, decimals, unit))
		default:
			return assertNever(validation.problem)
	}
}

/** Returns `percent`% of `amount`, rounded down so a preset never exceeds the amount it is taken from. */
export function getAmountPreset(amount: bigint, percent: number) {
	if (!Number.isInteger(percent) || percent < 0 || percent > 100) throw new Error('Preset percent must be an integer from 0 to 100')
	return (amount * BigInt(percent)) / 100n
}
