import { decodeEventLog, type Address, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isIgnorableLogDecodeError } from '@zoltar/ui-core-shared/lib/errors.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../contractArtifact.js'
import { decodeOracleQueueOperation } from './oracleQueueOperation.js'
import type { OracleQueueOperation, StagedOracleExecutionResult, StagedOracleQueuedResult } from '../types/contracts.js'

export function getStagedOracleExecutionResult(receipt: { logs: readonly Pick<TransactionReceipt['logs'][number], 'address' | 'data' | 'topics'>[] }, managerAddress: Address, expectedOperation: OracleQueueOperation, expectedOperationId?: bigint): StagedOracleExecutionResult | undefined {
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, managerAddress)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'ExecutedStagedOperation' || (expectedOperationId !== undefined && decodedLog.args.operationId !== expectedOperationId)) continue
			const operation = decodeOracleQueueOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			const errorMessage = decodedLog.args.errorMessage.trim() === '' ? undefined : decodedLog.args.errorMessage
			return {
				errorMessage,
				operation,
				operationId: decodedLog.args.operationId,
				success: decodedLog.args.success,
			} satisfies StagedOracleExecutionResult
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return undefined
}

export function getStagedOracleQueuedResult(receipt: TransactionReceipt, managerAddress: Address, expectedOperation: OracleQueueOperation): StagedOracleQueuedResult | undefined {
	for (const log of receipt.logs) {
		if (!sameAddress(log.address, managerAddress)) continue
		try {
			const decodedLog = decodeEventLog({
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'StagedOperationQueued') continue
			const operation = decodeOracleQueueOperation(BigInt(decodedLog.args.operation))
			if (operation !== expectedOperation) continue
			return {
				isPendingSlot: decodedLog.args.isPendingSlot,
				operation,
				operationId: decodedLog.args.operationId,
			} satisfies StagedOracleQueuedResult
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}
	return undefined
}
