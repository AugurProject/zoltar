import { expect, test } from 'bun:test'
import { rpow } from './retentionRate.js'

const precision = 10n ** 18n

test('rpow raises fixed-point values with floor division like the contract', () => {
	expect(rpow(2n * precision, 0n, precision)).toBe(precision)
	expect(rpow(2n * precision, 10n, precision)).toBe(1_024n * precision)
	expect(rpow(precision / 2n, 3n, precision)).toBe(precision / 8n)
	expect(rpow(3n, 2n, 2n)).toBe(4n)
})
