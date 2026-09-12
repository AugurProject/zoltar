import { describe, expect, test } from 'bun:test'
import { quoteExactOutput } from './math.js'

describe('two-way constant-product math', () => {
	test('exact-output quotes charge the fee on top of the net input', () => {
		for (let index = 1n; index <= 1_000n; index++) {
			const reserveIn = index * 1_000_003n
			const reserveOut = index * 2_000_033n + 10n
			const requested = (reserveOut * ((index % 97n) + 1n)) / 200n
			const feeBps = index % 1_000n
			const quote = quoteExactOutput(reserveIn, reserveOut, requested, feeBps)
			expect(quote.amountOut).toBe(requested)
			expect(quote.amountIn - quote.feeAmount).toBe(quote.netInput)
			expect((quote.netInput * (10_000n - feeBps)) / 10_000n <= quote.netInput).toBe(true)
			expect((reserveIn + quote.netInput) * (reserveOut - requested)).toBeGreaterThanOrEqual(reserveIn * reserveOut)
		}
	})

	test('rejects requests that would drain the output reserve', () => {
		expect(() => quoteExactOutput(1_000n, 1_000n, 1_000n, 30n)).toThrow('amountOut is out of range')
		expect(() => quoteExactOutput(1_000n, 1_000n, 10n, 10_000n)).toThrow('feeBps is out of range')
	})
})
