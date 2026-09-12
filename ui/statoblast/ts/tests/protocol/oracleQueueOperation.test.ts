import { describe, expect, test } from 'bun:test'
import { decodeOracleQueueOperation, encodeOracleQueueOperation } from '@zoltar/ui-statoblast-shared/protocol/oracleQueueOperation.js'

// OpenOraclePriceCoordinator operation type ids.
const LIQUIDATION_OPERATION_TYPE = 0
const WITHDRAW_REP_OPERATION_TYPE = 1

describe('oracleQueueOperation', () => {
	test('round-trips supported operations', () => {
		expect(encodeOracleQueueOperation('liquidation')).toBe(LIQUIDATION_OPERATION_TYPE)
		expect(encodeOracleQueueOperation('withdrawRep')).toBe(WITHDRAW_REP_OPERATION_TYPE)

		expect(decodeOracleQueueOperation(LIQUIDATION_OPERATION_TYPE)).toBe('liquidation')
		expect(decodeOracleQueueOperation(1n)).toBe('withdrawRep')
	})

	test('rejects unknown operation values', () => {
		expect(() => decodeOracleQueueOperation(99)).toThrow('Unknown oracle operation: 99')
	})
})
