import { describe, expect, test } from 'bun:test'
import { vaultHealthBps } from '../../src/core/strategy.ts'

describe('vault health', () => {
	test('counts eligible escrow backing without an additional free REP reserve', () => {
		expect(vaultHealthBps(100n, 100n, 10_500n, 10n ** 18n, 5n)).toBe(10_000n)
	})

	test('rounds each required collateral step up', () => {
		expect(vaultHealthBps(3n, 1n, 10_500n, 10n ** 18n + 1n)).toBe(10_000n)
	})

	test('has no health ratio without debt or a price', () => {
		expect(vaultHealthBps(100n, 0n, 10_500n, 10n ** 18n)).toBeUndefined()
		expect(vaultHealthBps(100n, 100n, 10_500n, 0n)).toBeUndefined()
	})
})
