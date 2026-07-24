import { describe, expect, test } from 'bun:test'
import { exactAmount, sumSignedDecimals } from './dashboard-format.js'

describe('dashboard exact ETH formatting', () => {
	test('preserves signed sub-micro, 18-decimal, and beyond-safe-integer totals', () => {
		expect(exactAmount('-0.0000004', 'ETH')).toBe('-0.0000004 ETH')
		expect(exactAmount('0.123456789012345678', 'ETH')).toBe('0.123456789012345678 ETH')
		expect(exactAmount('9007199254740993.000000000000000001', 'ETH')).toBe('9007199254740993.000000000000000001 ETH')
	})

	test('sums signed decimal strings without floating-point precision loss', () => {
		expect(sumSignedDecimals(['9007199254740993.000000000000000001', '-9007199254740993', '-0.0000004'])).toBe('-0.000000399999999999')
	})
})
