import { expect, test } from 'bun:test'
import { formatRep } from './contract-reference-rules.mts'

test('formats attoREP amounts with full precision, including negative values', () => {
	expect(formatRep(15n * 10n ** 18n)).toBe('15')
	expect(formatRep(10n ** 18n + 1n)).toBe('1.000000000000000001')
	expect(formatRep(-1n)).toBe('-0.000000000000000001')
	expect(formatRep(-(10n ** 18n) - 5n * 10n ** 17n)).toBe('-1.5')
	expect(formatRep(0n)).toBe('0')
})
