import { describe, expect, test } from 'bun:test'
import { maximumInsuredExit } from './positions.js'
import { quoteExactOutput } from './math.js'

// Long shares an exit consumes: the complete sets plus the long shares swapped for the opposite side.
const requiredLongShares = (completeSets: bigint, yesReserve: bigint, noReserve: bigint, feeBps: bigint) => completeSets + quoteExactOutput(yesReserve, noReserve, completeSets, feeBps).amountIn

describe('maximum insured exit', () => {
	test('is bounded by both INVALID and long shares', () => {
		const maximum = maximumInsuredExit({ longOutcome: 'YES', longBalance: 800n, invalidBalance: 500n, yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n })
		expect(maximum).toBeGreaterThan(0n)
		expect(maximum).toBeLessThanOrEqual(500n)
		expect(requiredLongShares(maximum, 10_000n, 10_000n, 30n)).toBeLessThanOrEqual(800n)
		expect(requiredLongShares(maximum + 1n, 10_000n, 10_000n, 30n)).toBeGreaterThan(800n)
	})

	test('never requests the entire opposite reserve', () => {
		const maximum = maximumInsuredExit({ longOutcome: 'NO', longBalance: 10n ** 30n, invalidBalance: 10n ** 30n, yesReserve: 100n, noReserve: 200n, feeBps: 0n })
		expect(maximum).toBe(99n)
	})

	test('identifies INVALID, long shares, and reserve liquidity as independent bounds', () => {
		const invalidBound = maximumInsuredExit({ longOutcome: 'YES', longBalance: 10n ** 30n, invalidBalance: 50n, yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n })
		expect(invalidBound).toBe(50n)

		const longBound = maximumInsuredExit({ longOutcome: 'YES', longBalance: 100n, invalidBalance: 10_000n, yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n })
		expect(longBound).toBeLessThan(100n)
		expect(requiredLongShares(longBound + 1n, 10_000n, 10_000n, 30n)).toBeGreaterThan(100n)

		const reserveBound = maximumInsuredExit({ longOutcome: 'NO', longBalance: 10n ** 30n, invalidBalance: 10n ** 30n, yesReserve: 100n, noReserve: 200n, feeBps: 0n })
		expect(reserveBound).toBe(99n)
	})
})
