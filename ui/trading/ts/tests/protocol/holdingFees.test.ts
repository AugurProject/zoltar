import { expect, test } from 'bun:test'
import { liquidityHoldingFeeBlocker, sellHoldingFeeBlocker } from '../../protocol/holdingFees.js'
import { liveMarketFixture } from '../support/liveMarketFixture.js'

const unit = 10n ** 18n
const accounting = { settlementCollateralAttoEth: unit, totalUnderwritingLimitAttoEth: unit, feeEligibleUnderwritingLimitAttoEth: unit, currentRetentionRate: 900_000_000_000_000_000n, lastUpdatedFeeAccumulator: 1n, feeIndexRemainder: 0n, totalFeesOwedRemainder: 0n }
const market = liveMarketFixture({ currentRetentionRate: accounting.currentRetentionRate, valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: (unit * 9n) / 10n, feeAccounting: accounting } })

test('caps projection at fee end and leaves zero-slippage transactions available without fee decay', () => {
	expect(sellHoldingFeeBlocker(market, unit, (unit * 9n) / 10n, 100n)).toBeUndefined()
	expect(sellHoldingFeeBlocker(market, unit, unit, 2n)).toContain('Holding fees')
	const noFees = liveMarketFixture()
	expect(sellHoldingFeeBlocker(noFees, unit, unit, 1_000n)).toBeUndefined()
	expect(liquidityHoldingFeeBlocker(noFees, unit, unit, unit, 1_000n, { completeSetShares: unit, yesUsed: unit, noUsed: unit })).toBeUndefined()
})

test('uses the simulated deposit mix instead of cached reserves and covers its discarded fraction', () => {
	const staleReserves = { ...market, yesReserve: 100n * unit, noReserve: unit }
	const deposits = { completeSetShares: unit, yesUsed: unit, noUsed: unit }
	expect(liquidityHoldingFeeBlocker(staleReserves, unit, unit, unit, 2n, deposits)).toContain('Holding fees')
	expect(liquidityHoldingFeeBlocker(staleReserves, unit, 2n * unit, 2n * unit, 2n, deposits)).toBeUndefined()
	// A minority output of 1 from 3 input shares hides a fractional reserve ratio below 2/3.
	// Minting 4 shares later can require 2 of the minority share, not floor(1 * 4 / 3).
	const small = {
		...market,
		shareTokenSupplyAttoShares: 3n,
		settlementCollateralAttoEth: 3n,
		valuation: { timestamp: 1n, feeEndTime: 2n, projectedCollateralAttoEth: 2n, feeAccounting: { ...accounting, settlementCollateralAttoEth: 3n, totalUnderwritingLimitAttoEth: 3n, feeEligibleUnderwritingLimitAttoEth: 3n, totalFeesOwedRemainder: 1n } },
	}
	expect(liquidityHoldingFeeBlocker(small, 3n, 1n, 20n, 2n, { completeSetShares: 3n, yesUsed: 1n, noUsed: 3n })).toContain('Holding fees')
})

test('requires a fee checkpoint when fees accrue and blocks zero projected payouts even if minimum rounds to zero', () => {
	expect(sellHoldingFeeBlocker(liveMarketFixture({ currentRetentionRate: accounting.currentRetentionRate }), unit, unit, 2n)).toContain('projection unavailable')
	const depleted = { ...market, valuation: { ...market.valuation, timestamp: 1n, feeEndTime: 100n, projectedCollateralAttoEth: 0n, feeAccounting: { ...accounting, currentRetentionRate: 0n } } }
	expect(sellHoldingFeeBlocker(depleted, unit, 0n, 2n)).toContain('Holding fees')
})
