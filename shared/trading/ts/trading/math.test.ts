import { describe, expect, test } from 'bun:test'
import { quoteExactInput, quoteExactOutput, quoteInitialLiquidity } from './math.js'

describe('two-way constant-product math', () => {
	test('exact-output quotes are sufficient when replayed as exact input', () => {
		for (let index = 1n; index <= 1_000n; index++) {
			const reserveIn = index * 1_000_003n
			const reserveOut = index * 2_000_033n + 10n
			const requested = (reserveOut * ((index % 97n) + 1n)) / 200n
			const exactOutput = quoteExactOutput(reserveIn, reserveOut, requested, index % 1_000n)
			const replay = quoteExactInput(reserveIn, reserveOut, exactOutput.amountIn, index % 1_000n)
			expect(replay.amountOut).toBeGreaterThanOrEqual(requested)
		}
	})

	test('fee-paying swaps do not decrease the reserve product', () => {
		for (let index = 1n; index <= 1_000n; index++) {
			const reserveIn = index * 10n ** 30n
			const reserveOut = (1_001n - index / 2n) * 10n ** 28n
			const quote = quoteExactInput(reserveIn, reserveOut, index * 10n ** 20n, 30n)
			expect((reserveIn + quote.amountIn) * (reserveOut - quote.amountOut)).toBeGreaterThanOrEqual(reserveIn * reserveOut)
		}
	})

	test('70% conditional YES initialization uses the opposite reserve ratio', () => {
		const quote = quoteInitialLiquidity(1_000_000n, 7_000n)
		expect(quote.noUsed).toBe(1_000_000n)
		expect(quote.yesUsed).toBe(428_571n)
	})
})
