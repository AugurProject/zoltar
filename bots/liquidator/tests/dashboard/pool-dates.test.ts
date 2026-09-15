import { expect, test } from 'bun:test'
import { poolDateTimestamp } from '#dashboard/pool-dates'

test('preserves valid timestamps for the shared date component', () => {
	expect(poolDateTimestamp('1789473600')).toBe(1789473600n)
	expect(poolDateTimestamp('0')).toBe(0n)
	expect(poolDateTimestamp('8640000000000')).toBe(8640000000000n)
})

test('does not invent dates for missing, invalid, or unrepresentable timestamps', () => {
	for (const value of [undefined, '', '-1', 'not a date', '8640000000001', '281474976710655']) expect(poolDateTimestamp(value)).toBeUndefined()
})
