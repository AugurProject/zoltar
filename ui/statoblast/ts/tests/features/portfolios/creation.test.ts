import { expect, test } from 'bun:test'
import { defaultPortfolioCreationDraft, parseFixedPortfolioQuestions, parsePortfolioCreationEconomics } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/creation.js'

test('creation parses percentages exactly and validates maintenance funding', () => {
	expect(parsePortfolioCreationEconomics(defaultPortfolioCreationDraft())).toEqual({ targetHealthFactorBps: 12000n, purchaseFeeBps: 100n, minimumPurchaseFeeAttoEth: 10n ** 15n, completionRewardAttoEth: 25n * 10n ** 13n, ownershipChangeFeeAttoEth: 10n ** 15n })
	expect(parsePortfolioCreationEconomics({ ...defaultPortfolioCreationDraft(), targetHealthPercent: '151.23', purchaseFeePercent: '0.07' })).toMatchObject({ targetHealthFactorBps: 15123n, purchaseFeeBps: 7n })
	for (const patch of [{ targetHealthPercent: '99.99' }, { purchaseFeePercent: '100.01' }, { purchaseFeePercent: '0.001' }, { minimumPurchaseFee: '0' }, { completionReward: '0' }]) expect(() => parsePortfolioCreationEconomics({ ...defaultPortfolioCreationDraft(), ...patch })).toThrow()
	expect(parsePortfolioCreationEconomics({ ...defaultPortfolioCreationDraft(), minimumPurchaseFee: '0', completionReward: '0', ownershipChangeFee: '0' })).toMatchObject({ minimumPurchaseFeeAttoEth: 0n, completionRewardAttoEth: 0n, ownershipChangeFeeAttoEth: 0n })
})

test('fixed policy questions are normalized without silently accepting malformed identifiers', () => {
	expect(parseFixedPortfolioQuestions('0x10, 2 16\n0')).toEqual([0n, 2n, 16n])
	for (const value of ['', '-1', '2.5', '0x', String(1n << 256n), '1;2']) expect(() => parseFixedPortfolioQuestions(value)).toThrow()
})
