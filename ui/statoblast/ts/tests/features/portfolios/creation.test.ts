import { expect, test } from 'bun:test'
import { defaultPortfolioCreationDraft, parseFixedPortfolioQuestions, parsePortfolioCreationEconomics } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/creation.js'
test('creation configures pool fees and minimums while health remains a personal setting', () => {
	expect(parsePortfolioCreationEconomics(defaultPortfolioCreationDraft())).toEqual({
		annualFeeBps: 1000n,
		purchaseFeeBps: 100n,
		minimumPurchaseFeeAttoEth: 10n ** 15n,
		minimumCommitmentAttoEth: 10n ** 18n,
		minimumOutcomeRate: 10n ** 16n,
		rewardVestingSeconds: 86_400n,
		reportingFeeAttoEth: 5n * 10n ** 16n,
		serviceFeeBps: 2500n,
		maximumOracleRewardAttoEth: 10n ** 17n,
	})
	expect(parsePortfolioCreationEconomics({ ...defaultPortfolioCreationDraft(), purchaseFeePercent: '0.07', minimumPurchaseFee: '0', rewardVestingHours: '1.5' })).toMatchObject({ purchaseFeeBps: 7n, minimumPurchaseFeeAttoEth: 0n, rewardVestingSeconds: 5_400n })
	expect(parsePortfolioCreationEconomics({ ...defaultPortfolioCreationDraft(), annualFeePercent: '51.23' })).toMatchObject({ annualFeeBps: 5_123n })
	for (const patch of [{ annualFeePercent: '100.01' }, { annualFeePercent: '0.001' }, { purchaseFeePercent: '100.01' }, { purchaseFeePercent: '0.001' }, { minimumCommitment: '0' }, { minimumOutcomeRate: '1.01' }, { rewardVestingHours: '0' }])
		expect(() => parsePortfolioCreationEconomics({ ...defaultPortfolioCreationDraft(), ...patch })).toThrow()
})
test('fixed policy questions normalize duplicate IDs and preserve full uint256 precision', () => {
	expect(parseFixedPortfolioQuestions('0x10, 2 16\n0')).toEqual([0n, 2n, 16n])
	for (const value of ['', '-1', '2.5', '0x', String(1n << 256n), '1;2']) expect(() => parseFixedPortfolioQuestions(value)).toThrow()
})
