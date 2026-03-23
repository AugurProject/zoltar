import assert from 'node:assert'
import { abs, bigintToDecimalString } from './bigint'

export const strictEqualTypeSafe = <Type>(actual: Type, expected: Type, errorMessage?: string | Error | undefined) => assert.strictEqual(actual, expected, errorMessage)

export const strictEqual18Decimal = (actual: bigint, expected: bigint, errorMessage?: string | Error | undefined) => assert.strictEqual(bigintToDecimalString(actual, 18n), bigintToDecimalString(expected, 18n), errorMessage)

export const approximatelyEqual = (actual: bigint, expected: bigint, errorDelta: bigint, errorMessage?: string | undefined) => {
	if (errorDelta < 0n) throw new RangeError('errorDelta must be non-negative')
	const diff = abs(actual - expected)
	if (diff > errorDelta) {
		throw new assert.AssertionError({
			message: errorMessage || `Expected values to be within ${ errorDelta }, but difference was ${ diff }`,
			actual,
			expected,
		})
	}
}

export function ensureDefined<T>(value: T | undefined, message?: string): T {
	if (value === undefined) {
		throw new assert.AssertionError({
			message: message ?? 'Expected value to be defined',
			actual: value,
			expected: 'defined',
		})
	}
	return value
}
