import { describe, expect, test } from 'bun:test'
import { expectedWithdrawalToken2, hedgedProfitBeforeGasWeth, realizedNetProfitWeth, recoveredHedgedProfitBeforeGasWeth, replacementCredit } from '#core/position-accounting'

describe('position accounting', () => {
	test('uses actual swap execution rather than the pre-submission quote', () => {
		expect(hedgedProfitBeforeGasWeth('sell-rep', 1_200n, 1_000n, 10n, 20n)).toBe(170n)
		expect(hedgedProfitBeforeGasWeth('buy-rep', 900n, 1_000n, 10n, 20n)).toBe(100n)
	})

	test('includes the exact settler reward and all entry and lifecycle gas in realized P&L', () => {
		expect(realizedNetProfitWeth(170n, 20n, 40n, 30n)).toBe(120n)
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

	test('derives the displaced reporter credit from the authenticated report transition', () => {
		expect(replacementCredit({ feePercentage: 100_000n, newAmount1: 1_500n, newAmount2: 900n, oldAmount1: 1_200n, oldAmount2: 1_000n })).toEqual({
			amount: 2_412n,
			token: 'token1',
		})
		expect(replacementCredit({ feePercentage: 100_000n, newAmount1: 1_300n, newAmount2: 1_200n, oldAmount1: 1_200n, oldAmount2: 1_000n })).toEqual({
			amount: 2_010n,
			token: 'token2',
		})
	})
})
