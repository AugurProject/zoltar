import { estimateMintCheckpoint } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'
import { expect, test } from 'bun:test'
import { attoSharesToCollateralAttoEth, formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity, formatOutcomeWithValue, formatCompleteSetWithValue, formatLpWithValue } from '../../lib/shareValue.js'

test('holding fees change backing without changing displayed token quantities', () => {
	const amount = 10n ** 18n
	for (const settlementCollateralAttoEth of [10n ** 18n, 984_200_000_000_000_000n, 0n]) {
		const rate = { shareTokenSupplyAttoShares: amount, settlementCollateralAttoEth }
		expect(attoSharesToCollateralAttoEth(amount, rate)).toBe(settlementCollateralAttoEth)
		expect(formatOutcomeQuantity(amount, 'YES')).toBe('1 Yes')
		expect(formatCompleteSetQuantity(amount)).toBe('1 complete set')
		expect(formatLpQuantity(amount)).toBe('1 LP')
	}
})

test('fee valuation stops at the epoch end and skips pools without fee-eligible capacity', () => {
	const accounting = { currentRetentionRate: 900_000_000_000_000_000n, feeEligibleUnderwritingLimitAttoEth: 10n ** 18n, totalUnderwritingLimitAttoEth: 10n ** 18n, feeEndTimestamp: 2n, feeIndexRemainder: 0n, lastUpdatedFeeAccumulator: 1n, settlementCollateralAttoEth: 10n ** 18n, totalFeesOwedRemainder: 0n }
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 100n })?.settlementCollateralAfterFeesAttoEth).toBe(900_000_000_000_000_000n)
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 100n, feeEligibleUnderwritingLimitAttoEth: 0n })?.settlementCollateralAfterFeesAttoEth).toBe(10n ** 18n)
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 1n })?.estimatedRetentionFeeAttoEth).toBe(0n)
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 100n, totalUnderwritingLimitAttoEth: 2n * 10n ** 18n })?.estimatedRetentionFeeAttoEth).toBe(50_000_000_000_000_000n)
})

test('does not label a nonzero token balance as zero at display precision', () => {
	expect(formatOutcomeQuantity(1n, 'YES')).toBe('<0.0001 Yes')
	expect(formatOutcomeQuantity(0n, 'YES')).toBe('0 Yes')
})

test('shows current ETH backing beside share quantities without changing the quantity', () => {
	const market = { shareTokenSupplyAttoShares: 10n ** 18n, settlementCollateralAttoEth: 9n * 10n ** 17n }
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', market)).toBe('1 Yes (0.9 ETH if Yes wins)')
	expect(formatOutcomeWithValue(10n ** 12n, 'YES', market)).toBe('<0.0001 Yes (<0.0001 ETH if Yes wins)')
	expect(formatOutcomeWithValue(0n, 'YES', market)).toBe('0 Yes (0 ETH)')
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', { ...market, questionOutcome: 2 })).toBe('1 Yes (0 ETH · lost)')
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', { ...market, questionOutcome: 1 })).toBe('1 Yes (0.9 ETH · winning payout; redemption unavailable)')
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', { ...market, loadError: 'offline' })).toBe('1 Yes (Payout unavailable)')
	expect(formatCompleteSetWithValue(10n ** 18n, market)).toBe('1 complete set (0.9 ETH)')
	expect(formatCompleteSetWithValue(10n ** 18n, { ...market, loadError: 'offline' })).toBe('1 complete set (Payout unavailable)')
})

test('values LP tokens from their reserve claims, including resolved and unavailable markets', () => {
	const market = liveMarketFixture({ yesReserve: 2n * 10n ** 18n, noReserve: 3n * 10n ** 18n, lpTotalSupply: 10n ** 18n })
	expect(formatLpWithValue(10n ** 18n, { ...market, noReserve: market.yesReserve })).toBe('1 LP (2 ETH if resolved valid)')
	expect(formatLpWithValue(10n ** 18n, market)).toBe('1 LP (2 ETH if Yes wins; 3 ETH if No wins)')
	expect(formatLpWithValue(10n ** 18n, { ...market, questionOutcome: 2 })).toBe('1 LP (3 ETH winning payout)')
	expect(formatLpWithValue(10n ** 18n, { ...market, questionOutcome: 0 })).toBe('1 LP (0 ETH winning payout)')
	expect(formatLpWithValue(10n ** 18n, { ...market, loadError: 'offline' })).toBe('1 LP (Value unavailable)')
})
