import { describe, expect, test } from 'bun:test'
import { constantProductExactInput, constantProductExactOutput, selectBestVenueQuote } from './venue-strategy.js'

describe('arbitrage venue strategy', () => {
	test('quotes Uniswap V2 exact input and output with the 0.3% fee', () => {
		expect(constantProductExactInput(1_000n, 100_000n, 50_000n)).toBe(493n)
		expect(constantProductExactOutput(493n, 100_000n, 50_000n)).toBe(999n)
	})

	test('selects the highest conservative post-gas sell quote', () => {
		expect(
			selectBestVenueQuote('sell-rep', [
				{ gasCostWeth: 20n, quotedWeth: 1_000n, venue: 'uniswap-v3' },
				{ gasCostWeth: 5n, quotedWeth: 990n, venue: 'uniswap-v2' },
			]),
		).toEqual({ gasCostWeth: 5n, quotedWeth: 990n, venue: 'uniswap-v2' })
	})

	test('selects the lowest conservative post-gas buy quote', () => {
		expect(
			selectBestVenueQuote('buy-rep', [
				{ gasCostWeth: 5n, quotedWeth: 900n, venue: 'uniswap-v3' },
				{ gasCostWeth: 5n, quotedWeth: 910n, venue: 'uniswap-v2' },
			]),
		).toEqual({ gasCostWeth: 5n, quotedWeth: 900n, venue: 'uniswap-v3' })
	})
})
