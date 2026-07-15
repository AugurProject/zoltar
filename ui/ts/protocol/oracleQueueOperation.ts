import { assertNever } from '../lib/assert.js'
import type { OracleQueueOperation } from '../types/contracts.js'

export const LIQUIDATION_OPERATION_TYPE = 0
export const WITHDRAW_REP_OPERATION_TYPE = 1
export const SET_SECURITY_BONDS_ALLOWANCE_OPERATION_TYPE = 2

export function decodeOracleQueueOperation(operation: bigint | number): OracleQueueOperation {
	const operationValue = typeof operation === 'bigint' ? operation : BigInt(operation)
	switch (operationValue) {
		case 0n:
			return 'liquidation'
		case 1n:
			return 'withdrawRep'
		case 2n:
			return 'setSecurityBondsAllowance'
		default:
			throw new Error(`Unknown oracle operation: ${operation}`)
	}
}

export function encodeOracleQueueOperation(operation: OracleQueueOperation): number {
	switch (operation) {
		case 'liquidation':
			return LIQUIDATION_OPERATION_TYPE
		case 'withdrawRep':
			return WITHDRAW_REP_OPERATION_TYPE
		case 'setSecurityBondsAllowance':
			return SET_SECURITY_BONDS_ALLOWANCE_OPERATION_TYPE
		default:
			return assertNever(operation)
	}
}
