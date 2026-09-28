import { describe, expect, test } from 'bun:test'
import { conditionalYesBps, quoteExactInput } from './math.js'
import { largestExitForLongShares, quoteEnterPosition, quoteExitPosition } from './positions.js'

const reserves = { yesReserve: 10_000n, noReserve: 10_000n, feeBps: 30n }

describe('exact-input quotes', () => {
	test('take the fee from the input and round the output down', () => {
		const quote = quoteExactInput(10_000n, 10_000n, 1_000n, 30n)
		expect(quote.netInput).toBe(997n)
		expect(quote.feeAmount).toBe(3n)
		// 10000 * 997 / 10997 = 906.61…
		expect(quote.amountOut).toBe(906n)
	})

	test('reject empty inputs and invalid fees', () => {
		expect(() => quoteExactInput(10_000n, 10_000n, 0n, 30n)).toThrow('amountIn must be positive')
		expect(() => quoteExactInput(10_000n, 10_000n, 1n, 30n)).toThrow('netInput must be positive')
		expect(() => quoteExactInput(10_000n, 10_000n, 10n, 10_000n)).toThrow('feeBps is out of range')
	})

	test('price YES as the NO share of the reserves', () => {
		expect(conditionalYesBps(10_000n, 10_000n)).toBe(5_000n)
		expect(conditionalYesBps(5_000n, 20_000n)).toBe(8_000n)
		expect(() => conditionalYesBps(0n, 0n)).toThrow('Empty reserves')
	})
})

describe('position estimates', () => {
	test('an entry sells the opposite outcome and moves the price toward the long outcome', () => {
		const yes = quoteEnterPosition('YES', 1_000n, reserves)
		expect(yes.oppositeSharesSwapped).toBe(1_000n)
		expect(yes.additionalLongShares).toBe(906n)
		expect(yes.totalLongShares).toBe(1_906n)
		expect(yes.invalidInsurance).toBe(1_000n)
		expect(yes.feeAmount).toBe(3n)
		expect(yes.conditionalYesBpsBefore).toBe(5_000n)
		// YES reserve 9094, NO reserve 11000.
		expect(yes.conditionalYesBpsAfter).toBe(conditionalYesBps(9_094n, 11_000n))
		const no = quoteEnterPosition('NO', 1_000n, reserves)
		expect(no.totalLongShares).toBe(1_906n)
		expect(no.conditionalYesBpsAfter).toBe(conditionalYesBps(11_000n, 9_094n))
	})

	test('an exit buys the opposite outcome and moves the price away from the long outcome', () => {
		const exit = quoteExitPosition('YES', 1_000n, reserves)
		expect(exit.totalLongShares).toBe(1_000n + exit.longSharesSwapped)
		expect(exit.invalidRequired).toBe(1_000n)
		expect(exit.conditionalYesBpsAfter).toBeLessThan(5_000n)
	})

	test('the largest exit for a share amount spends at most those shares', () => {
		for (const longShares of [1n, 10n, 500n, 1_906n, 9_000n]) {
			const completeSets = largestExitForLongShares({ ...reserves, longOutcome: 'YES', longShares })
			if (completeSets === 0n) continue
			expect(quoteExitPosition('YES', completeSets, reserves).totalLongShares).toBeLessThanOrEqual(longShares)
			if (completeSets + 1n < reserves.noReserve) expect(quoteExitPosition('YES', completeSets + 1n, reserves).totalLongShares).toBeGreaterThan(longShares)
		}
		expect(largestExitForLongShares({ ...reserves, longOutcome: 'NO', longShares: 1_906n, completeSetCap: 10n })).toBe(10n)
		expect(largestExitForLongShares({ ...reserves, longOutcome: 'NO', longShares: 0n })).toBe(0n)
	})
})
