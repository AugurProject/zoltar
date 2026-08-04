import { describe, expect, test } from 'bun:test'
import { formatUnits, parseUnits } from '../app/format.ts'
import { demoMarket, lifecycleLabel, tradingClosedReason } from '../demo/markets.ts'

describe('standalone trading UI model', () => {
	test('derives exact lifecycle reasons', () => {
		expect(tradingClosedReason(demoMarket('ended').lifecycle)).toBe('Question ended')
		expect(tradingClosedReason(demoMarket('forked').lifecycle)).toBe('Parent universe forked')
		expect(lifecycleLabel(demoMarket('resolved-invalid').lifecycle)).toBe('Resolved INVALID')
	})

	test('parses and formats chain quantities without numbers', () => {
		expect(parseUnits('1.2345')).toBe(1_234_500_000_000_000_000n)
		expect(formatUnits(1_234_500_000_000_000_000n)).toBe('1.2345')
		expect(() => parseUnits('1.0000000000000000001')).toThrow('18 decimal places')
	})
})
