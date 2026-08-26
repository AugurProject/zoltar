import { describe, expect, test } from 'bun:test'
import { DEFAULT_RISK_LIMITS, adjustedNetProfitWeth, positionConsumesRisk, positionRiskLimitMismatch, projectedLifecycleGasReserveAttoWeth, riskLimitMismatch } from '#core/safety-controls'

describe('execution risk controls', () => {
	test('does not reserve capital for a finalized non-included attempt', () => {
		expect(positionConsumesRisk('pending-entry')).toBe(true)
		expect(positionConsumesRisk('expired-not-included')).toBe(false)
		expect(positionConsumesRisk('closed')).toBe(false)
	})

	test('reserves lifecycle and slippage costs before calling an opportunity profitable', () => {
		expect(
			adjustedNetProfitWeth({
				entryGasCostAttoWeth: 1n,
				hedgeSlippageReserveAttoWeth: 2n,
				lifecycleGasReserveAttoWeth: 3n,
				profitBeforeGasAttoWeth: 10n,
			}),
		).toBe(4n)
		const profitBeforeGasAttoWeth = 20n
		const simulatedEntryGasCostWeth = 9n
		expect(profitBeforeGasAttoWeth - simulatedEntryGasCostWeth).toBeGreaterThanOrEqual(10n)
		expect(
			adjustedNetProfitWeth({
				entryGasCostAttoWeth: simulatedEntryGasCostWeth,
				hedgeSlippageReserveAttoWeth: 2n,
				lifecycleGasReserveAttoWeth: 3n,
				profitBeforeGasAttoWeth,
			}),
		).toBeLessThan(10n)
	})

	test('projects the atomic public and private lifecycle transaction', () => {
		const parameters = {
			callbackGasLimit: 4_000_000n,
			configuredReserveAttoWeth: 1n,
			gasPrice: 2n,
		}
		const publicReserve = projectedLifecycleGasReserveAttoWeth({ ...parameters, submissionMode: 'public' })
		const privateReserve = projectedLifecycleGasReserveAttoWeth({ ...parameters, submissionMode: 'private' })
		expect(publicReserve).toBe(9_800_000n)
		expect(privateReserve).toBe(9_800_000n)
		expect(projectedLifecycleGasReserveAttoWeth({ ...parameters, configuredReserveAttoWeth: 9_800_001n, submissionMode: 'private' })).toBe(9_800_001n)
		expect(adjustedNetProfitWeth({ entryGasCostAttoWeth: 0n, hedgeSlippageReserveAttoWeth: 0n, lifecycleGasReserveAttoWeth: privateReserve, profitBeforeGasAttoWeth: privateReserve })).toBe(0n)
		expect(adjustedNetProfitWeth({ entryGasCostAttoWeth: 0n, hedgeSlippageReserveAttoWeth: 0n, lifecycleGasReserveAttoWeth: privateReserve, profitBeforeGasAttoWeth: privateReserve - 1n })).toBe(-1n)

		const noPositions: never[] = []
		const dailyLimit = { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 2, maxDailyGasSpendAttoWeth: privateReserve }
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 0n, positions: noPositions, projectedGasCostAttoWeth: privateReserve }, dailyLimit)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 0n, positions: noPositions, projectedGasCostAttoWeth: privateReserve + 1n }, dailyLimit)).toContain('UTC-day gas spend')
	})

	test('fails closed on every portfolio loss limit', () => {
		const safe = {
			capitalAtRiskAttoWeth: DEFAULT_RISK_LIMITS.maxPositionNotionalAttoWeth,
			concurrentPositions: 0,
			dailyGasSpentAttoWeth: 0n,
			projectedLockedAttoWeth: DEFAULT_RISK_LIMITS.maxTotalLockedAttoWeth,
		}
		expect(riskLimitMismatch(safe, DEFAULT_RISK_LIMITS)).toBeUndefined()
		expect(riskLimitMismatch({ ...safe, concurrentPositions: 1 }, DEFAULT_RISK_LIMITS)).toContain('concurrent')
		expect(riskLimitMismatch({ ...safe, capitalAtRiskAttoWeth: safe.capitalAtRiskAttoWeth + 1n }, DEFAULT_RISK_LIMITS)).toContain('position notional')
		expect(riskLimitMismatch({ ...safe, projectedLockedAttoWeth: safe.projectedLockedAttoWeth + 1n }, DEFAULT_RISK_LIMITS)).toContain('locked capital')
		expect(riskLimitMismatch({ ...safe, dailyGasSpentAttoWeth: DEFAULT_RISK_LIMITS.maxDailyGasSpendAttoWeth + 1n }, DEFAULT_RISK_LIMITS)).toContain('UTC-day gas spend')
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
			maxDailyGasSpendAttoWeth: 20n * 10n ** 15n,
			maxPositionNotionalAttoWeth: 3n * 10n ** 18n,
			maxTotalLockedAttoWeth: 5n * 10n ** 18n,
		}
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 3n * 10n ** 18n, positions, projectedGasCostAttoWeth: 5n * 10n ** 15n }, limits, now)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 3n * 10n ** 18n + 1n, positions, projectedGasCostAttoWeth: 5n * 10n ** 15n }, limits, now)).toContain('position notional')
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 3n * 10n ** 18n + 1n, positions: [], projectedGasCostAttoWeth: 0n }, { ...limits, maxPositionNotionalAttoWeth: 10n * 10n ** 18n, maxTotalLockedAttoWeth: 3n * 10n ** 18n }, now)).toContain('locked capital')
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 1n, positions, projectedGasCostAttoWeth: 5n * 10n ** 15n + 1n }, limits, now)).toContain('UTC-day gas spend')
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
		const limits = { ...DEFAULT_RISK_LIMITS, maxConcurrentPositions: 2, maxDailyGasSpendAttoWeth: 20n * 10n ** 15n }
		const minedDay = new Date('2026-07-25T12:00:00.000Z')
		const recoveryDay = new Date('2026-07-26T12:00:00.000Z')
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 0n, positions, projectedGasCostAttoWeth: 5n * 10n ** 15n }, limits, minedDay)).toBeUndefined()
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 0n, positions, projectedGasCostAttoWeth: 5n * 10n ** 15n + 1n }, limits, minedDay)).toContain('UTC-day gas spend')
		expect(positionRiskLimitMismatch({ capitalAtRiskAttoWeth: 0n, positions, projectedGasCostAttoWeth: 20n * 10n ** 15n }, limits, recoveryDay)).toBeUndefined()
		expect(positionRiskLimitMismatch({ archivedDailyGasSpentAttoWeth: 1n, capitalAtRiskAttoWeth: 0n, positions: [], projectedGasCostAttoWeth: 20n * 10n ** 15n }, limits, recoveryDay)).toContain('UTC-day gas spend')
	})
})
