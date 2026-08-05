import { describe, expect, test } from 'bun:test'
import { decodeOracleQueueOperation, encodeOracleQueueOperation, LIQUIDATION_OPERATION_TYPE, SET_COVERAGE_COMMITMENT_OPERATION_TYPE, WITHDRAW_REP_OPERATION_TYPE } from '../../protocol/oracleQueueOperation.js'

describe('oracleQueueOperation', () => {
	test('round-trips supported operations', () => {
		expect(encodeOracleQueueOperation('liquidation')).toBe(LIQUIDATION_OPERATION_TYPE)
		expect(encodeOracleQueueOperation('withdrawRep')).toBe(WITHDRAW_REP_OPERATION_TYPE)
		expect(encodeOracleQueueOperation('setCoverageCommitment')).toBe(SET_COVERAGE_COMMITMENT_OPERATION_TYPE)

		expect(decodeOracleQueueOperation(LIQUIDATION_OPERATION_TYPE)).toBe('liquidation')
		expect(decodeOracleQueueOperation(1n)).toBe('withdrawRep')
		expect(decodeOracleQueueOperation(SET_COVERAGE_COMMITMENT_OPERATION_TYPE)).toBe('setCoverageCommitment')
	})

	test('rejects unknown operation values', () => {
		expect(() => decodeOracleQueueOperation(99)).toThrow('Unknown oracle operation: 99')
	})
})
