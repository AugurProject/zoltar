import { decodeEventLog, type TransactionLog } from '@zoltar/bot-shared/ethereum'
import { coordinatorAbi } from '#contracts/abi'

export type StagedOperationOutcome = {
	errorMessage: string
	operation: bigint
	operationId: bigint
	success: boolean
}

export function stagedOperationOutcome(log: Pick<TransactionLog, 'data' | 'topics'>, operationId: bigint): StagedOperationOutcome | undefined {
	try {
		const decoded = decodeEventLog({ abi: coordinatorAbi, data: log.data, topics: log.topics })
		if (decoded.eventName === 'ExecutedStagedOperation' && decoded.args.operationId === operationId) {
			return {
				errorMessage: decoded.args.errorMessage,
				operation: decoded.args.operation,
				operationId: decoded.args.operationId,
				success: decoded.args.success,
			}
		}
		if (decoded.eventName === 'PendingOperationRecoveryConsumed' && decoded.args.operationId === operationId) {
			return {
				errorMessage: 'Pending operation was consumed during oracle recovery',
				operation: decoded.args.operation,
				operationId: decoded.args.operationId,
				success: false,
			}
		}
	} catch (error) {
		void error
	}
	return undefined
}
