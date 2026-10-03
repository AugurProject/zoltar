import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { OracleQueueOperation } from '../types/contracts.js'

const LIQUIDATION_OPERATION_TYPE = 0
const WITHDRAW_REP_OPERATION_TYPE = 1

export function decodeOracleQueueOperation(operation: bigint | number): OracleQueueOperation {
	const operationValue = typeof operation === 'bigint' ? operation : BigInt(operation)
	switch (operationValue) {
		case 0n:
			return 'liquidation'
		case 1n:
			return 'withdrawRep'
		case 3n:
			return 'vaultOperations'
		case 2n:
			return 'setVaultUnderwritingLimit'
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
		case 'vaultOperations':
			return 3
		case 'setVaultUnderwritingLimit':
			return 2
		default:
			return assertNever(operation)
	}
}
