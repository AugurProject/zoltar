import { describe, expect, test } from 'bun:test'
import { DEFAULT_RISK_LIMITS, adjustedNetProfitWeth, positionConsumesRisk, positionRiskLimitMismatch, projectedLifecycleGasReserveWethAttoEth, riskLimitMismatch } from '#core/safety-controls'

describe('execution risk controls', () => {
	test('does not reserve capital for a finalized non-included attempt', () => {
		expect(positionConsumesRisk('pending-entry')).toBe(true)
		expect(positionConsumesRisk('expired-not-included')).toBe(false)
		expect(positionConsumesRisk('closed')).toBe(false)
	})

	test('reserves lifecycle and slippage costs before calling an opportunity profitable', () => {
		expect(
			adjustedNetProfitWeth({
				entryGasCostWethAttoEth: 1n,
				hedgeSlippageReserveWethAttoEth: 2n,
				lifecycleGasReserveWethAttoEth: 3n,
				profitBeforeGasWethAttoEth: 10n,
			}),
		).toBe(4n)
		const profitBeforeGasWethAttoEth = 20n
		const simulatedEntryGasCostWeth = 9n
		expect(profitBeforeGasWethAttoEth - simulatedEntryGasCostWeth).toBeGreaterThanOrEqual(10n)
		expect(
			adjustedNetProfitWeth({
				entryGasCostWethAttoEth: simulatedEntryGasCostWeth,
				hedgeSlippageReserveWethAttoEth: 2n,
				lifecycleGasReserveWethAttoEth: 3n,
				profitBeforeGasWethAttoEth,
			}),
		).toBeLessThan(10n)
	})

	test('projects the atomic public and private lifecycle transaction', () => {
		const parameters = {
			callbackGasLimit: 4_000_000n,
			configuredReserveWethAttoEth: 1n,
			gasPrice: 2n,
		}
		const publicReserve = projectedLifecycleGasReserveWethAttoEth({ ...parameters, submissionMode: 'public' })
		const privateReserve = projectedLifecycleGasReserveWethAttoEth({ ...parameters, submissionMode: 'private' })
		expect(publicReserve).toBe(9_800_000n)
		expect(privateReserve).toBe(9_800_000n)
		expect(projectedLifecycleGasReserveWethAttoEth({ ...parameters, configuredReserveWethAttoEth: 9_800_001n, submissionMode: 'private' })).toBe(9_800_001n)
		expect(adjustedNetProfitWeth({ entryGasCostWethAttoEth: 0n, hedgeSlippageReserveWethAttoEth: 0n, lifecycleGasReserveWethAttoEth: privateReserve, profitBeforeGasWethAttoEth: privateReserve })).toBe(0n)
		expect(adjustedNetProfitWeth({ entryGasCostWethAttoEth: 0n, hedgeSlippageReserveWethAttoEth: 0n, lifecycleGasReserveWethAttoEth: privateReserve, profitBeforeGasWethAttoEth: privateReserve - 1n })).toBe(-1n)

		const noPositions: never[] = []
		const dailyLimit = { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 2, maxDailyGasSpendWethAttoEth: privateReserve }
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 0n, positions: noPositions, projectedGasCostWethAttoEth: privateReserve }, dailyLimit)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 0n, positions: noPositions, projectedGasCostWethAttoEth: privateReserve + 1n }, dailyLimit)).toContain('UTC-day gas spend')
	})

	test('fails closed on every portfolio loss limit', () => {
		const safe = {
			capitalAtRiskWethAttoEth: DEFAULT_RISK_LIMITS.maxPositionNotionalWethAttoEth,
			concurrentPositions: 0,
			dailyGasSpentWethAttoEth: 0n,
			projectedLockedWethAttoEth: DEFAULT_RISK_LIMITS.maxTotalLockedWethAttoEth,
		}
		expect(riskLimitMismatch(safe, DEFAULT_RISK_LIMITS)).toBeUndefined()
		expect(riskLimitMismatch({ ...safe, concurrentPositions: 1 }, DEFAULT_RISK_LIMITS)).toContain('concurrent')
		expect(riskLimitMismatch({ ...safe, capitalAtRiskWethAttoEth: safe.capitalAtRiskWethAttoEth + 1n }, DEFAULT_RISK_LIMITS)).toContain('position notional')
		expect(riskLimitMismatch({ ...safe, projectedLockedWethAttoEth: safe.projectedLockedWethAttoEth + 1n }, DEFAULT_RISK_LIMITS)).toContain('locked capital')
		expect(riskLimitMismatch({ ...safe, dailyGasSpentWethAttoEth: DEFAULT_RISK_LIMITS.maxDailyGasSpendWethAttoEth + 1n }, DEFAULT_RISK_LIMITS)).toContain('UTC-day gas spend')
	})

	test('rechecks refreshed capital and relay-simulated gas against every portfolio cap', () => {
		const positions = [
			{
				actualEntryGasCostEth: '0.01',
				capitalAtRiskWeth: '2',
				gasExpenditures: [
					{ costEth: '0.01', minedAt: '2026-07-24T00:00:00.000Z', transactionHash: `0x${'11'.repeat(32)}` },
					{ costEth: '0.005', minedAt: '2026-07-24T01:00:00.000Z', transactionHash: `0x${'22'.repeat(32)}` },
				],
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
			maxDailyGasSpendWethAttoEth: 20n * 10n ** 15n,
			maxPositionNotionalWethAttoEth: 3n * 10n ** 18n,
			maxTotalLockedWethAttoEth: 5n * 10n ** 18n,
		}
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 3n * 10n ** 18n, positions, projectedGasCostWethAttoEth: 5n * 10n ** 15n }, limits, now)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 3n * 10n ** 18n + 1n, positions, projectedGasCostWethAttoEth: 5n * 10n ** 15n }, limits, now)).toContain('position notional')
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 3n * 10n ** 18n + 1n, positions: [], projectedGasCostWethAttoEth: 0n }, { ...limits, maxPositionNotionalWethAttoEth: 10n * 10n ** 18n, maxTotalLockedWethAttoEth: 3n * 10n ** 18n }, now)).toContain('locked capital')
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 1n, positions, projectedGasCostWethAttoEth: 5n * 10n ** 15n + 1n }, limits, now)).toContain('UTC-day gas spend')
	})

	test('charges gas to canonical mined UTC days instead of local staging or recovery time', () => {
		const positions = [
			{
				actualEntryGasCostEth: '0.01',
				capitalAtRiskWeth: '0',
				gasExpenditures: [
					{ costEth: '0.01', minedAt: '2026-07-25T00:00:01.000Z', transactionHash: `0x${'11'.repeat(32)}` },
					{ costEth: '0.005', minedAt: '2026-07-25T23:59:59.000Z', transactionHash: `0x${'22'.repeat(32)}` },
				],
				lifecycleGasCostEth: '0.005',
				lifecycleUpdatedAt: '2026-07-26T12:00:00.000Z',
				openedAt: '2026-07-24T23:59:59.000Z',
				status: 'closed',
			},
		]
		const limits = { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 2, maxDailyGasSpendWethAttoEth: 20n * 10n ** 15n }
		const minedDay = new Date('2026-07-25T12:00:00.000Z')
		const recoveryDay = new Date('2026-07-26T12:00:00.000Z')
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 0n, positions, projectedGasCostWethAttoEth: 5n * 10n ** 15n }, limits, minedDay)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 0n, positions, projectedGasCostWethAttoEth: 5n * 10n ** 15n + 1n }, limits, minedDay)).toContain('UTC-day gas spend')
		expect(positionRiskLimitMismatch({ capitalAtRiskWethAttoEth: 0n, positions, projectedGasCostWethAttoEth: 20n * 10n ** 15n }, limits, recoveryDay)).toBeUndefined()
	})
})
