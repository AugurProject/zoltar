import { describe, expect, test } from 'bun:test'
import { calculateOracleSettlementBountyAttoEth } from './oracleInitialReport.js'

describe('shared oracle settlement bounty', () => {
	test('includes dispatch, EIP-150 slack, padding, and the explicit fee multiplier', () => {
		expect(calculateOracleSettlementBountyAttoEth({ baseFeePerGas: 3n, initialReportPriorityFeeAttoEthPerGas: 2n, settlementCallbackGasLimit: 63n, maxSettlementBaseFeeMultiplierBps: 30_000n })).toBe(5_881_256n)
	})

	test('rejects snapshots without a settlement fee multiplier', () => {
		// Persisted or external callers can omit a field even when the TypeScript API requires it.
		expect(() => Reflect.apply(calculateOracleSettlementBountyAttoEth, undefined, [{ baseFeePerGas: 3n, initialReportPriorityFeeAttoEthPerGas: 2n, settlementCallbackGasLimit: 63n }])).toThrow('Settlement fee multiplier is required')
	})
})
