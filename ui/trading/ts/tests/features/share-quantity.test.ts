import { estimateMintCheckpoint } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import { expect, test } from 'bun:test'
import { attoSharesToCollateralAttoEth, formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity } from '../../lib/shareValue.js'

test('holding fees change backing without changing displayed token quantities', () => {
	const amount = 10n ** 36n
	for (const settlementCollateralAttoEth of [10n ** 18n, 984_200_000_000_000_000n, 0n]) {
		const rate = { shareTokenSupplyAttoShares: amount, settlementCollateralAttoEth }
		expect(attoSharesToCollateralAttoEth(amount, rate)).toBe(settlementCollateralAttoEth)
		expect(formatOutcomeQuantity(amount, 'YES')).toBe('1 YES')
		expect(formatCompleteSetQuantity(amount)).toBe('1 complete set')
		expect(formatLpQuantity(amount)).toBe('1 LP')
	}
})

test('fee valuation stops at the epoch end and skips pools without fee-eligible capacity', () => {
	const accounting = { currentRetentionRate: 900_000_000_000_000_000n, feeEligibleCapacityOwnershipAttoRep: 10n ** 18n, feeEndTimestamp: 2n, feeIndexRemainder: 0n, lastUpdatedFeeAccumulator: 1n, settlementCollateralAttoEth: 10n ** 18n, totalFeesOwedRemainder: 0n }
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 100n })?.settlementCollateralAfterFeesAttoEth).toBe(900_000_000_000_000_000n)
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 100n, feeEligibleCapacityOwnershipAttoRep: 0n })?.settlementCollateralAfterFeesAttoEth).toBe(10n ** 18n)
	expect(estimateMintCheckpoint({ ...accounting, currentTimestamp: 1n })?.estimatedRetentionFeeAttoEth).toBe(0n)
})

test('does not label a nonzero token balance as zero at display precision', () => {
	expect(formatOutcomeQuantity(1n, 'YES')).toBe('<0.0001 YES')
	expect(formatOutcomeQuantity(0n, 'YES')).toBe('0 YES')
})
