import { describe, expect, test } from 'bun:test'
import { formatSlippagePercent, parseSlippagePercent } from '../../lib/tradeSettings.js'
import { MAXIMUM_SLIPPAGE_BPS, MINIMUM_SLIPPAGE_BPS, maximumAfterSlippage, minimumAfterSlippage, requireTransactionSlippageBps } from '../../protocol/tradeQuote.js'

describe('transaction slippage bounds', () => {
	test('rejects zero tolerance, which reverts on any price movement, at the protocol layer', () => {
		expect(MINIMUM_SLIPPAGE_BPS).toBe(1n)
		expect(() => requireTransactionSlippageBps(0n)).toThrow('between 0.01% and 5%')
		expect(() => minimumAfterSlippage(1_000n, 0n)).toThrow('between 0.01% and 5%')
		expect(() => maximumAfterSlippage(1_000n, 0n)).toThrow('between 0.01% and 5%')
		expect(() => requireTransactionSlippageBps(-1n)).toThrow('between 0.01% and 5%')
	})

	test('accepts the smallest and largest settings and rejects anything wider', () => {
		expect(requireTransactionSlippageBps(MINIMUM_SLIPPAGE_BPS)).toBeUndefined()
		expect(minimumAfterSlippage(10_000n, MINIMUM_SLIPPAGE_BPS)).toBe(9_999n)
		expect(maximumAfterSlippage(10_000n, MINIMUM_SLIPPAGE_BPS)).toBe(10_001n)
		expect(requireTransactionSlippageBps(MAXIMUM_SLIPPAGE_BPS)).toBeUndefined()
		expect(() => requireTransactionSlippageBps(MAXIMUM_SLIPPAGE_BPS + 1n)).toThrow('between 0.01% and 5%')
	})

	test('the trade settings accept exactly the tolerances the protocol accepts', () => {
		for (const slippageBps of [0n, MINIMUM_SLIPPAGE_BPS, MINIMUM_SLIPPAGE_BPS + 1n, 50n, MAXIMUM_SLIPPAGE_BPS - 1n, MAXIMUM_SLIPPAGE_BPS, MAXIMUM_SLIPPAGE_BPS + 1n]) {
			const acceptedBySettings = parseSlippagePercent(formatSlippagePercent(slippageBps)) !== undefined
			if (acceptedBySettings) expect(requireTransactionSlippageBps(slippageBps)).toBeUndefined()
			else expect(() => requireTransactionSlippageBps(slippageBps)).toThrow('between 0.01% and 5%')
			expect(acceptedBySettings).toBe(slippageBps >= MINIMUM_SLIPPAGE_BPS && slippageBps <= MAXIMUM_SLIPPAGE_BPS)
		}
	})
})
