import { describe, expect, test } from 'bun:test'
import { DEFAULT_RISK_LIMITS, adjustedNetProfitWeth, riskLimitMismatch } from './safety-controls.js'

describe('execution risk controls', () => {
	test('reserves lifecycle and slippage costs before calling an opportunity profitable', () => {
		expect(
			adjustedNetProfitWeth({
				entryGasCostWeth: 1n,
				hedgeSlippageReserveWeth: 2n,
				lifecycleGasReserveWeth: 3n,
				profitBeforeGasWeth: 10n,
			}),
		).toBe(4n)
		const profitBeforeGasWeth = 20n
		const simulatedEntryGasCostWeth = 9n
		expect(profitBeforeGasWeth - simulatedEntryGasCostWeth).toBeGreaterThanOrEqual(10n)
		expect(
			adjustedNetProfitWeth({
				entryGasCostWeth: simulatedEntryGasCostWeth,
				hedgeSlippageReserveWeth: 2n,
				lifecycleGasReserveWeth: 3n,
				profitBeforeGasWeth,
			}),
		).toBeLessThan(10n)
	})

	test('fails closed on every portfolio loss limit', () => {
		const safe = {
			capitalAtRiskWeth: DEFAULT_RISK_LIMITS.maxPositionNotionalWeth,
			concurrentPositions: 0,
			dailyGasSpentWeth: 0n,
			projectedLockedWeth: DEFAULT_RISK_LIMITS.maxTotalLockedWeth,
		}
		expect(riskLimitMismatch(safe, DEFAULT_RISK_LIMITS)).toBeUndefined()
		expect(riskLimitMismatch({ ...safe, concurrentPositions: 1 }, DEFAULT_RISK_LIMITS)).toContain('concurrent')
		expect(riskLimitMismatch({ ...safe, capitalAtRiskWeth: safe.capitalAtRiskWeth + 1n }, DEFAULT_RISK_LIMITS)).toContain('position notional')
		expect(riskLimitMismatch({ ...safe, projectedLockedWeth: safe.projectedLockedWeth + 1n }, DEFAULT_RISK_LIMITS)).toContain('locked capital')
		expect(riskLimitMismatch({ ...safe, dailyGasSpentWeth: DEFAULT_RISK_LIMITS.maxDailyGasSpendWeth + 1n }, DEFAULT_RISK_LIMITS)).toContain('daily gas')
	})
})
