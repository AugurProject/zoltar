import { describe, expect, test } from 'bun:test'
import { maximumInsuredExit, quoteExitPosition } from '../sdk/positions.ts'

describe('maximum insured exit', () => {
	test('is bounded by both INVALID and long shares', () => {
		const maximum = maximumInsuredExit({ longOutcome: 'YES', longBalance: 800n, invalidBalance: 500n, yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n })
		expect(maximum).toBeGreaterThan(0n)
		expect(maximum).toBeLessThanOrEqual(500n)
		const quote = quoteExitPosition('YES', maximum, 10_000n, 10_000n, 30n)
		expect(quote.totalLongShares).toBeLessThanOrEqual(800n)
		const next = quoteExitPosition('YES', maximum + 1n, 10_000n, 10_000n, 30n)
		expect(next.totalLongShares).toBeGreaterThan(800n)
	})

	test('never requests the entire opposite reserve', () => {
		const maximum = maximumInsuredExit({ longOutcome: 'NO', longBalance: 10n ** 30n, invalidBalance: 10n ** 30n, yesReserve: 100n, noReserve: 200n, feeBps: 0n })
		expect(maximum).toBe(99n)
	})
})
