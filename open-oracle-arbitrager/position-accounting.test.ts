import { describe, expect, test } from 'bun:test'
import { expectedWithdrawalToken2, hedgedProfitBeforeGasWeth, realizedNetProfitWeth, recoveredHedgedProfitBeforeGasWeth } from './position-accounting.js'

describe('position accounting', () => {
	test('uses actual swap execution rather than the pre-submission quote', () => {
		expect(hedgedProfitBeforeGasWeth('sell-rep', 1_200n, 1_000n, 10n, 20n)).toBe(170n)
		expect(hedgedProfitBeforeGasWeth('buy-rep', 900n, 1_000n, 10n, 20n)).toBe(100n)
	})

	test('does not classify P&L as realized until all entry and lifecycle gas is included', () => {
		expect(realizedNetProfitWeth(170n, 40n, 30n)).toBe(100n)
	})

	test('recovers actual post-crash hedge economics instead of retaining the staged quote', () => {
		expect(recoveredHedgedProfitBeforeGasWeth('sell-rep', 300n, 4_000n, 4_200n)).toBe(500n)
		expect(recoveredHedgedProfitBeforeGasWeth('buy-rep', 300n, 4_000n, 4_200n)).toBe(100n)
	})

	test('requires hedge-neutral inventory before realizing a lifecycle', () => {
		expect(expectedWithdrawalToken2('sell-rep', 1_000n, 900n)).toBe(1_000n)
		expect(expectedWithdrawalToken2('sell-rep', 1_000n, 1_300n)).toBe(1_300n)
		expect(expectedWithdrawalToken2('buy-rep', 1_000n, 1_300n)).toBe(1_300n)
	})
})
