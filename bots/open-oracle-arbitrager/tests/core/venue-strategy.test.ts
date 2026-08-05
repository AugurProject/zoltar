import { describe, expect, test } from 'bun:test'
import { constantProductExactInput, constantProductExactOutput, selectBestVenueQuote } from '#core/venue-strategy'

describe('arbitrage venue strategy', () => {
	test('quotes Uniswap V2 exact input and output with the 0.3% fee', () => {
		expect(constantProductExactInput(1_000n, 100_000n, 50_000n)).toBe(493n)
		expect(constantProductExactOutput(493n, 100_000n, 50_000n)).toBe(999n)
	})

	test('selects the highest conservative post-gas sell quote', () => {
		expect(
			selectBestVenueQuote('sell-rep', [
				{ gasCostWethAttoEth: 20n, quotedWethAttoEth: 1_000n, venue: 'uniswap-v3' },
				{ gasCostWethAttoEth: 5n, quotedWethAttoEth: 990n, venue: 'uniswap-v2' },
			]),
		).toEqual({ gasCostWethAttoEth: 5n, quotedWethAttoEth: 990n, venue: 'uniswap-v2' })
	})

	test('selects the lowest conservative post-gas buy quote', () => {
		expect(
			selectBestVenueQuote('buy-rep', [
				{ gasCostWethAttoEth: 5n, quotedWethAttoEth: 900n, venue: 'uniswap-v3' },
				{ gasCostWethAttoEth: 5n, quotedWethAttoEth: 910n, venue: 'uniswap-v2' },
			]),
		).toEqual({ gasCostWethAttoEth: 5n, quotedWethAttoEth: 900n, venue: 'uniswap-v3' })
	})
})
