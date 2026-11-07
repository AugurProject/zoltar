import assert from './assert'

export const strictEqualTypeSafe = <Type>(actual: Type, expected: Type, errorMessage?: string | Error | undefined) => assert.strictEqual(actual, expected, errorMessage)

export function ensureDefined<T>(value: T | undefined, message?: string): T {
	if (value === undefined)
		throw new assert.AssertionError({
			message: message ?? 'Expected value to be defined',
			actual: value,
			expected: 'defined',
		})
	return value
}
