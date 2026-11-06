import { expect, test } from 'bun:test'
import { portfolioMintFee, portfolioMintWithinBudget, type PortfolioMintFees } from './portfolioMint'

const state: PortfolioMintFees = { securityMultiplierBps: 20_000n, purchaseFeeBps: 100n, minimumPurchaseFeeAttoEth: 10n, annualFeeBps: 1_000n, feePrincipalAttoEth: 100n, cashAttoEth: 90n, outcomeSupplyAttoShares: 100n }

test('a budget includes fixed, backing, and resolution fees without overspending', () => {
	for (const minimumPurchaseFeeAttoEth of [0n, 10n, 100n]) {
		for (const purchaseFeeBps of [0n, 100n, 10_000n]) {
			const fees = { ...state, minimumPurchaseFeeAttoEth, purchaseFeeBps }
			for (const budget of [0n, 1n, 10n, 99n, 1_000n, 10n ** 18n]) {
				const cash = portfolioMintWithinBudget(budget, fees)
				if (cash > 0n) expect(cash + portfolioMintFee(cash, fees)).toBeLessThanOrEqual(budget)
				expect(cash + 1n + portfolioMintFee(cash + 1n, fees)).toBeGreaterThan(budget)
			}
		}
	}
})

test('zero supply starts at one share per collateral unit; existing fees use historical principal', () => {
	expect(portfolioMintFee(365_000n, { ...state, minimumPurchaseFeeAttoEth: 0n, purchaseFeeBps: 0n, outcomeSupplyAttoShares: 0n })).toBe(5_200n)
	expect(portfolioMintFee(900n, { ...state, minimumPurchaseFeeAttoEth: 0n, purchaseFeeBps: 0n })).toBe(15n)
	expect(() => portfolioMintWithinBudget(10n, { ...state, cashAttoEth: 0n })).toThrow('backing exhausted')
})
