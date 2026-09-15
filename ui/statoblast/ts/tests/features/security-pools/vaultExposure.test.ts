import { describe, expect, test } from 'bun:test'
import { getVaultExposure } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityVault.js'

describe('vault exposure presentation', () => {
	test('converts capacity to ETH using the pool minimum and REP per ETH price', () => {
		expect(getVaultExposure(12n * 10n ** 18n, 20_000n, 3n * 10n ** 18n)).toEqual({ amount: 2n * 10n ** 18n, priced: true })
	})
	test('labels missing and zero prices as REP equivalent instead of ETH', () => {
		for (const price of [undefined, 0n]) expect(getVaultExposure(12n * 10n ** 18n, 20_000n, price)).toEqual({ amount: 6n * 10n ** 18n, priced: false })
	})
	test('preserves contract rounding order and zero exposure', () => {
		expect(getVaultExposure(7n, 15_000n, 3n * 10n ** 18n)).toEqual({ amount: 1n, priced: true })
		expect(getVaultExposure(0n, 20_000n, undefined)).toEqual({ amount: 0n, priced: false })
	})
	test('does not invent values for missing capacity or invalid pool minimum', () => {
		expect(getVaultExposure(undefined, 20_000n, 1n)).toBeUndefined()
		for (const minimum of [undefined, 0n]) expect(getVaultExposure(1n, minimum, 1n)).toBeUndefined()
	})
})
