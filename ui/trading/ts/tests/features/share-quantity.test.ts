import { estimateMintCheckpoint } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'
import { expect, test } from 'bun:test'
import { attoSharesToCollateralAttoEth, formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity, formatOutcomeWithValue, formatCompleteSetWithValue, formatLpWithValue } from '../../lib/shareValue.js'

test('holding fees change backing without changing displayed token quantities', () => {
	const amount = 10n ** 18n
	for (const settlementCollateralAttoEth of [10n ** 18n, 984_200_000_000_000_000n, 0n]) {
		const rate = { shareTokenSupplyAttoShares: amount, settlementCollateralAttoEth }
		expect(attoSharesToCollateralAttoEth(amount, rate)).toBe(settlementCollateralAttoEth)
		expect(formatOutcomeQuantity(amount, 'YES')).toBe('1.00 Yes')
		expect(formatCompleteSetQuantity(amount)).toBe('1.00 complete set')
		expect(formatLpQuantity(amount)).toBe('1.00 LP')
	}
})

test('fee valuation stops at the epoch end', () => {
	const accounting = { linearFee: { rateAttoEthPerSecond: 10n ** 17n, endTime: 100n }, feeEndTimestamp: 2n, lastFeeCheckpointNativeTime: 1n, settlementCollateralAttoEth: 10n ** 18n }
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 100n })?.settlementCollateralAfterFeesAttoEth).toBe(900_000_000_000_000_000n)
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 1n })?.estimatedRetentionFeeAttoEth).toBe(0n)
})

test('LP display matches ERC-20 decimals independently of collateral (#1716)', () => {
	const collateral = { token: '0x1111111111111111111111111111111111111111', symbol: 'USDC', decimals: 6, native: false } as const
	expect(formatLpQuantity(1_250_000_000_000_000_000n, 2, 'nearest', { collateral })).toBe('1.25 LP')
})

test('does not label a nonzero token balance as zero at display precision', () => {
	expect(formatOutcomeQuantity(1n, 'YES')).toBe('0.000000000000000001 Yes')
	expect(formatOutcomeQuantity(0n, 'YES')).toBe('0.00 Yes')
})

test('shows current ETH backing beside share quantities without changing the quantity', () => {
	const market = { shareTokenSupplyAttoShares: 10n ** 18n, settlementCollateralAttoEth: 9n * 10n ** 17n }
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', market)).toBe('1.00 Yes (0.90 ETH if the question resolves Yes)')
	expect(formatOutcomeWithValue(10n ** 12n, 'YES', market)).toBe('0.0000010 Yes (0.00000090 ETH if the question resolves Yes)')
	expect(formatOutcomeWithValue(0n, 'YES', market)).toBe('0.00 Yes (0.00 ETH)')
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', { ...market, questionOutcome: 2 })).toBe('1.00 Yes (0 ETH · lost)')
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', { ...market, questionOutcome: 1 })).toBe('1.00 Yes (0.90 WETH · winning payout; redemption unavailable)')
	expect(formatOutcomeWithValue(10n ** 18n, 'YES', { ...market, loadError: 'offline' })).toBe('1.00 Yes (Payout unavailable)')
	expect(formatCompleteSetWithValue(10n ** 18n, market)).toBe('1.00 complete set (0.90 ETH)')
	expect(formatCompleteSetWithValue(10n ** 18n, { ...market, loadError: 'offline' })).toBe('1.00 complete set (Payout unavailable)')
})

test('values LP tokens from their reserve claims, including resolved and unavailable markets', () => {
	const market = liveMarketFixture({ yesReserve: 2n * 10n ** 18n, noReserve: 3n * 10n ** 18n, lpTotalSupply: 10n ** 18n })
	expect(formatLpWithValue(10n ** 18n, { ...market, noReserve: market.yesReserve })).toBe('1.00 LP (2.00 ETH if the question resolves Yes or No)')
	expect(formatLpWithValue(10n ** 18n, market)).toBe('1.00 LP (2.00 ETH if the question resolves Yes; 3.00 ETH if the question resolves No)')
	expect(formatLpWithValue(10n ** 18n, { ...market, questionOutcome: 2 })).toBe('1.00 LP (3.00 WETH winning payout)')
	expect(formatLpWithValue(10n ** 18n, { ...market, questionOutcome: 0 })).toBe('1.00 LP (0.00 WETH winning payout)')
	expect(formatLpWithValue(10n ** 18n, { ...market, loadError: 'offline' })).toBe('1.00 LP (Value unavailable)')
})
