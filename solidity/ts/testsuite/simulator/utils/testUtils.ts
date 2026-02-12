import assert from 'node:assert'
import { abs, bigintToDecimalString } from './bigint.js'

export const strictEqualTypeSafe = <Type>(actual: Type, expected: Type, errorMessage?: string | Error | undefined) => assert.strictEqual(actual, expected, errorMessage)

export const strictEqual18Decimal = (actual: bigint, expected: bigint, errorMessage?: string | Error | undefined) => assert.strictEqual(bigintToDecimalString(actual, 18n), bigintToDecimalString(expected, 18n), errorMessage)

export const approximatelyEqual = (actual: bigint, expected: bigint, errorDelta: bigint, message?: string | Error | undefined) => {
	if (abs(actual - expected) > errorDelta) strictEqualTypeSafe(actual, expected, message)
}
