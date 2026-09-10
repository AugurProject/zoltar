import { describe, expect, test } from 'bun:test'
import { inputOutcomeConditionalPriceImpact, maximumInsuredExit, quoteExitPosition } from './positions.js'
import { quoteExactInput } from './math.js'

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

	test('identifies INVALID, long shares, and reserve liquidity as independent bounds', () => {
		const invalidBound = maximumInsuredExit({ longOutcome: 'YES', longBalance: 10n ** 30n, invalidBalance: 50n, yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n })
		expect(invalidBound).toBe(50n)

		const longBound = maximumInsuredExit({ longOutcome: 'YES', longBalance: 100n, invalidBalance: 10_000n, yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n })
		expect(longBound).toBeLessThan(100n)
		expect(quoteExitPosition('YES', longBound + 1n, 10_000n, 10_000n, 30n).totalLongShares).toBeGreaterThan(100n)

		const reserveBound = maximumInsuredExit({ longOutcome: 'NO', longBalance: 10n ** 30n, invalidBalance: 10n ** 30n, yesReserve: 100n, noReserve: 200n, feeBps: 0n })
		expect(reserveBound).toBe(99n)
	})

	test('labels conditional reserve impact by the explicit input outcome', () => {
		const yesInput = quoteExactInput(300n, 700n, 30n, 30n)
		const yesImpact = inputOutcomeConditionalPriceImpact('YES', 300n, 700n, yesInput)
		expect(yesImpact.inputOutcome).toBe('YES')
		expect(yesImpact.before).toEqual({ numerator: 700n, denominator: 1_000n })
		expect(yesImpact.after.numerator * yesImpact.before.denominator).toBeLessThan(yesImpact.before.numerator * yesImpact.after.denominator)

		const noInput = quoteExactInput(700n, 300n, 70n, 30n)
		const noImpact = inputOutcomeConditionalPriceImpact('NO', 700n, 300n, noInput)
		expect(noImpact.inputOutcome).toBe('NO')
		expect(noImpact.before).toEqual({ numerator: 300n, denominator: 1_000n })
		expect(noImpact.after.numerator * noImpact.before.denominator).toBeLessThan(noImpact.before.numerator * noImpact.after.denominator)
	})
})
