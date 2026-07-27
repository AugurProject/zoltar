import { describe, expect, test } from 'bun:test'
import { DEFAULT_RISK_LIMITS, adjustedNetProfitWeth, positionRiskLimitMismatch, riskLimitMismatch } from './safety-controls.js'

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

	test('rechecks refreshed capital and relay-simulated gas against every portfolio cap', () => {
		const positions = [
			{
				actualEntryGasCostEth: '0.01',
				capitalAtRiskWeth: '2',
				lifecycleGasCostEth: '0.005',
				lifecycleUpdatedAt: '2026-07-24T01:00:00.000Z',
				openedAt: '2026-07-24T00:00:00.000Z',
				status: 'open',
			},
		]
		const now = new Date('2026-07-24T12:00:00.000Z')
		const limits = {
			...DEFAULT_RISK_LIMITS,
			maxConcurrentPositions: 2,
			maxDailyGasSpendWeth: 20n * 10n ** 15n,
			maxPositionNotionalWeth: 3n * 10n ** 18n,
			maxTotalLockedWeth: 5n * 10n ** 18n,
		}
		expect(positionRiskLimitMismatch({ capitalAtRiskWeth: 3n * 10n ** 18n, positions, projectedGasCostWeth: 5n * 10n ** 15n }, limits, now)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskWeth: 3n * 10n ** 18n + 1n, positions, projectedGasCostWeth: 5n * 10n ** 15n }, limits, now)).toContain('position notional')
		expect(positionRiskLimitMismatch({ capitalAtRiskWeth: 3n * 10n ** 18n + 1n, positions: [], projectedGasCostWeth: 0n }, { ...limits, maxPositionNotionalWeth: 10n * 10n ** 18n, maxTotalLockedWeth: 3n * 10n ** 18n }, now)).toContain('locked capital')
		expect(positionRiskLimitMismatch({ capitalAtRiskWeth: 1n, positions, projectedGasCostWeth: 5n * 10n ** 15n + 1n }, limits, now)).toContain('daily gas')
	})
})
