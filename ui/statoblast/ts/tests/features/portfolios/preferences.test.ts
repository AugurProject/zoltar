import { expect, test } from 'bun:test'
import { parsePortfolioAmount, portfolioAmountOrUndefined, portfolioUnsignedId } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/draft.js'
test('exact token amounts reject negative, exponential and overprecision values', () => {
	expect(parsePortfolioAmount('9007199254740993.000000000000000001')).toBe(9007199254740993000000000000000001n)
	for (const value of ['', '-1', '1e3', '0.0000000000000000001']) {
		expect(() => parsePortfolioAmount(value)).toThrow()
		expect(portfolioAmountOrUndefined(value)).toBeUndefined()
	}
	expect(portfolioAmountOrUndefined('0')).toBe(0n)
})
test('question and universe inputs enforce their actual unsigned widths', () => {
	expect(portfolioUnsignedId('0x10')).toBe(16n)
	expect(portfolioUnsignedId(String((1n << 256n) - 1n))).toBe((1n << 256n) - 1n)
	expect(portfolioUnsignedId(String(1n << 248n), 248)).toBeUndefined()
	for (const value of ['', '-1', '+1', '1e3', '1.2', '0x', String(1n << 256n)]) expect(portfolioUnsignedId(value)).toBeUndefined()
})
