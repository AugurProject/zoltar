import { describe, expect, test } from 'bun:test'
import { getVaultExposure } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityVault.js'

describe('vault commitment presentation', () => {
	test('preserves the ETH limit independently of the pool multiplier and price', () => {
		for (const price of [undefined, 0n, 3n * 10n ** 18n]) {
			for (const multiplier of [undefined, 0n, 20_000n]) {
				expect(getVaultExposure(12n * 10n ** 18n, multiplier, price)).toEqual({ amount: 12n * 10n ** 18n, priced: true })
			}
		}
	})
	test('retains atomic limits and zero without a conversion or rounding loss', () => {
		for (const limit of [0n, 1n, 7n]) expect(getVaultExposure(limit, 15_000n, undefined)).toEqual({ amount: limit, priced: true })
	})
	test('does not invent a missing commitment', () => {
		expect(getVaultExposure(undefined, 20_000n, 1n)).toBeUndefined()
	})
})
