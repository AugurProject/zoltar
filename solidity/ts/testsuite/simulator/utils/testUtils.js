import assert from 'node:assert'
import { abs, bigintToDecimalString } from './bigint'
export const strictEqualTypeSafe = (actual, expected, errorMessage) => assert.strictEqual(actual, expected, errorMessage)
export const strictEqual18Decimal = (actual, expected, errorMessage) => assert.strictEqual(bigintToDecimalString(actual, 18n), bigintToDecimalString(expected, 18n), errorMessage)
export const approximatelyEqual = (actual, expected, errorDelta, errorMessage) => {
	if (errorDelta < 0n) throw new RangeError('errorDelta must be non-negative')
	const diff = abs(actual - expected)
	if (diff > errorDelta) {
		throw new assert.AssertionError({
			message: errorMessage || `Expected values to be within ${errorDelta}, but difference was ${diff}`,
			actual,
			expected,
		})
	}
}
export function ensureDefined(value, message) {
	if (value === undefined) {
		throw new assert.AssertionError({
			message: message ?? 'Expected value to be defined',
			actual: value,
			expected: 'defined',
		})
	}
	return value
}
//# sourceMappingURL=testUtils.js.map
