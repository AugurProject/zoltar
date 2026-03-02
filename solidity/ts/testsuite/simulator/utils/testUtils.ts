import assert from 'node:assert'
import { abs, bigintToDecimalString } from './bigint.js'

export const strictEqualTypeSafe = <Type>(actual: Type, expected: Type, errorMessage?: string | Error | undefined) => assert.strictEqual(actual, expected, errorMessage)

export const strictEqual18Decimal = (actual: bigint, expected: bigint, errorMessage?: string | Error | undefined) => assert.strictEqual(bigintToDecimalString(actual, 18n), bigintToDecimalString(expected, 18n), errorMessage)

export const approximatelyEqual = (actual: bigint, expected: bigint, errorDelta: bigint, errorMessage?: string | undefined) => {
	if (errorDelta < 0n) throw new RangeError('errorDelta must be non-negative')
	const diff = abs(actual - expected)
	if (diff > errorDelta) {
		throw new assert.AssertionError({
			message: errorMessage || `Expected values to be within ${ errorDelta }, but difference was ${ diff }`,
			actual,
			expected
		})
	}
}

export const aproximatelyEqual18Decimal = (actual: bigint, expected: bigint, errorDelta: bigint, errorMessage?: string | undefined) => {
	if (errorDelta < 0n) throw new RangeError('errorDelta must be non-negative')
	const diff = abs(actual - expected)
	if (diff > errorDelta) {
		throw new assert.AssertionError({
			message: errorMessage || `Expected values to be within ${ bigintToDecimalString(errorDelta, 18n) }, but difference was ${ bigintToDecimalString(diff, 18n) }`,
			actual: bigintToDecimalString(actual, 18n),
			expected: bigintToDecimalString(expected, 18n)
		})
	}
}
