import { expect, test } from 'bun:test'
import { candlePrices } from '../../browser/operations-candles.ts'

test('projects tiny prices while retaining exact direction and fractions', () => {
	const fraction = (numerator: string, denominator = '10000000000') => ({ numerator, denominator })
	const candle = (open: ReturnType<typeof fraction>, close: ReturnType<typeof fraction>) => ({ open, high: open, low: close, close })
	expect(candlePrices(candle(fraction('2'), fraction('1')))).toMatchObject({ open: 2e-10, close: 1e-10, direction: 'down', exactOpen: '2/10000000000' })
	expect(candlePrices(candle(fraction('9007199254740993', '1'), fraction('9007199254740992', '1')))?.direction).toBe('down')
	expect(candlePrices(candle(fraction('1', '2'), fraction('2', '4')))?.direction).toBe('flat')
})
