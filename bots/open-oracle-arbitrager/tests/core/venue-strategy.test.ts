import { describe, expect, test } from 'bun:test'
import { constantProductExactInput, constantProductExactOutput } from '#core/venue-strategy'

describe('arbitrage venue strategy', () => {
	test('quotes Uniswap V2 exact input and output with the 0.3% fee', () => {
		expect(constantProductExactInput(1_000n, 100_000n, 50_000n)).toBe(493n)
		expect(constantProductExactOutput(493n, 100_000n, 50_000n)).toBe(999n)
	})
})
