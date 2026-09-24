import { expect, test } from 'bun:test'
import { exactNumber, exactUnit, percentFromBps, utcDateTime } from '../../browser/format.ts'

test('preserves integers above the JavaScript safe range', () => {
	expect(exactNumber('123456789012345678901234567')).toBe('123,456,789,012,345,678,901,234,567')
	expect(exactNumber('-999999999999999999999')).toBe('-999,999,999,999,999,999,999')
})

test('labels basis points as percentages without losing fractional percent', () => {
	expect(percentFromBps('15000')).toBe('150%')
	expect(percentFromBps('37')).toBe('0.37%')
})

test('shows UTC dates with times', () => {
	expect(utcDateTime('2025-01-02T03:04:05.000Z')).toBe('2025-01-02 03:04:05 UTC')
})

test('keeps exact token units, including zero-decimal values', () => {
	expect(exactUnit('9007199254740993123456789', 18, 'REP')).toBe('9,007,199.254740993123456789 REP')
	expect(exactUnit('1', 18, 'REP')).toBe('0.000000000000000001 REP')
	expect(exactUnit('9007199254740993', 0)).toBe('9,007,199,254,740,993')
})
