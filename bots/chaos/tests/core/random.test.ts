import { describe, expect, test } from 'bun:test'
import { randomDelaySeconds, randomElement, randomIntegerExcept } from '../../src/core/random.ts'

describe('cryptographic random helpers', () => {
	test('maps a uniform draw around an excluded previous value without retry bias', () => {
		expect(randomIntegerExcept(60, 63, 61, () => 60)).toBe(60)
		expect(randomIntegerExcept(60, 63, 61, () => 61)).toBe(62)
		expect(randomIntegerExcept(60, 63, 61, () => 62)).toBe(63)
	})

	test('never repeats the previous delay and remains in the one-to-sixty-minute range', () => {
		expect(randomDelaySeconds(60, 3_600, 60, minimum => minimum)).toBe(61)
		expect(randomDelaySeconds(60, 3_600, 3_600, (_minimum, maximum) => maximum - 1)).toBe(3_599)
	})

	test('validates injected randomness instead of trusting it', () => {
		expect(() => randomElement(['a', 'b'], () => 2)).toThrow('outside')
		expect(() => randomDelaySeconds(60, 60, undefined)).toThrow('at least two')
	})
})
