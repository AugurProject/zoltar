import { expect, test } from 'bun:test'
import { getLiquidationMigrationSecurityMultiplierBps } from './liquidation.js'

test('diagnostic migration health keeps the 5% reserve and floors half of excess collateral', () => {
	for (const [pool, expected] of [
		[10_000n, 10_500n],
		[10_999n, 10_500n],
		[11_000n, 10_500n],
		[12_001n, 11_000n],
		[15_000n, 12_500n],
	]) {
		if (pool === undefined || expected === undefined) throw new Error('Missing multiplier case')
		expect(getLiquidationMigrationSecurityMultiplierBps(pool)).toBe(expected)
	}
})
