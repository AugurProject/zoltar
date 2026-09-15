import { expect, test } from 'bun:test'
import { poolDatePresentation } from '#dashboard/pool-dates'

test('formats exact UTC question dates without depending on the browser timezone', () => {
	expect(poolDatePresentation('1789473600')).toEqual({ dateTime: '2026-09-15T12:00:00.000Z', text: '15 Sept 2026, 12:00:00 UTC' })
	expect(poolDatePresentation('0')?.dateTime).toBe('1970-01-01T00:00:00.000Z')
})

test('does not invent dates for missing, invalid, or unrepresentable timestamps', () => {
	for (const value of [undefined, '', '-1', 'not a date', '8640000000001', '281474976710655']) expect(poolDatePresentation(value)).toBeUndefined()
	expect(poolDatePresentation('8640000000000')?.dateTime).toBe('+275760-09-13T00:00:00.000Z')
})
