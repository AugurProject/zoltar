import { describe, expect, test } from 'bun:test'
import { calculateOracleSettlementBountyAttoEth, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from './oracleInitialReport.js'

describe('shared oracle settlement bounty', () => {
	test('includes dispatch, EIP-150 slack, padding, and the explicit fee multiplier', () => {
		expect(calculateOracleSettlementBountyAttoEth({ baseFeePerGas: 3n, initialReportPriorityFeeAttoEthPerGas: 2n, settlementCallbackGasLimit: 63n, maxSettlementBaseFeeMultiplierBps: 30_000n })).toBe(5_881_256n)
	})

	test('rejects snapshots without a settlement fee multiplier', () => {
		// Persisted or external callers can omit a field even when the TypeScript API requires it.
		expect(() => Reflect.apply(calculateOracleSettlementBountyAttoEth, undefined, [{ baseFeePerGas: 3n, initialReportPriorityFeeAttoEthPerGas: 2n, settlementCallbackGasLimit: 63n }])).toThrow('Settlement fee multiplier is required')
	})
})

test('#1644 maximum priority admits an ordinary uint96 bounty at zero base fee', () => {
	const bounty = (priority: bigint) => calculateOracleSettlementBountyAttoEth({ baseFeePerGas: 0n, initialReportPriorityFeeAttoEthPerGas: priority, settlementCallbackGasLimit: 4_000_000n, maxSettlementBaseFeeMultiplierBps: 30_000n })
	expect(bounty(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS)).toBeLessThan(1n << 96n)
	expect(bounty(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n)).toBeGreaterThanOrEqual(1n << 96n)
})
