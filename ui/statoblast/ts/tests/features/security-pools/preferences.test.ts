import { expect, test } from 'bun:test'
import { parseSecurityPoolAmount, securityPoolAmountOrUndefined, securityPoolUnsignedId } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/draft.js'
test('exact token amounts reject negative, exponential and overprecision values', () => {
	expect(parseSecurityPoolAmount('9007199254740993.000000000000000001')).toBe(9007199254740993000000000000000001n)
	for (const value of ['', '-1', '1e3', '0.0000000000000000001']) {
		expect(() => parseSecurityPoolAmount(value)).toThrow()
		expect(securityPoolAmountOrUndefined(value)).toBeUndefined()
	}
	expect(securityPoolAmountOrUndefined('0')).toBe(0n)
})
test('question and universe inputs enforce their actual unsigned widths', () => {
	expect(securityPoolUnsignedId('0x10')).toBe(16n)
	expect(securityPoolUnsignedId(String((1n << 256n) - 1n))).toBe((1n << 256n) - 1n)
	expect(securityPoolUnsignedId(String(1n << 248n), 248)).toBeUndefined()
	for (const value of ['', '-1', '+1', '1e3', '1.2', '0x', String(1n << 256n)]) expect(securityPoolUnsignedId(value)).toBeUndefined()
})

test('#1493: security pool amounts follow shared decimal and locale rules', () => {
	expect(securityPoolAmountOrUndefined('.5', 6)).toBe(500_000n)
	expect(securityPoolAmountOrUndefined('1,5', 6, ',')).toBe(1_500_000n)
	expect(securityPoolAmountOrUndefined('1,5', 6, '.')).toBeUndefined()
	expect(securityPoolAmountOrUndefined('-1', 6)).toBeUndefined()
})
