import { describe, expect, test } from 'bun:test'
import { bigintToSafeNumber, unixSecondsToDate } from '../src/time.ts'

describe('bigintToSafeNumber', () => {
	test('preserves safe integer bounds and rejects values outside them', () => {
		expect(bigintToSafeNumber(BigInt(Number.MIN_SAFE_INTEGER), 'Value')).toBe(Number.MIN_SAFE_INTEGER)
		expect(bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER), 'Value')).toBe(Number.MAX_SAFE_INTEGER)
		expect(() => bigintToSafeNumber(BigInt(Number.MIN_SAFE_INTEGER) - 1n, 'Block count')).toThrow('Block count is outside the safe integer range')
		expect(() => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'Block count')).toThrow('Block count is outside the safe integer range')
	})
})

describe('unixSecondsToDate', () => {
	test('preserves exact whole-second timestamps', () => {
		expect(unixSecondsToDate(1_765_497_600n).toISOString()).toBe('2025-12-12T00:00:00.000Z')
	})

	test('supports the full JavaScript Date range without bigint-to-number casts', () => {
		expect(unixSecondsToDate(8_640_000_000_000n).getTime()).toBe(8_640_000_000_000_000)
		expect(unixSecondsToDate(-8_640_000_000_000n).getTime()).toBe(-8_640_000_000_000_000)
	})

	test('rejects timestamps outside the JavaScript Date range', () => {
		expect(() => unixSecondsToDate(8_640_000_000_001n, 'Block timestamp')).toThrow('Block timestamp is outside the supported timestamp range')
	})
})
