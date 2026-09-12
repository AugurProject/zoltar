import { decodeEventLog, type TransactionLog } from '@zoltar/bot-shared/ethereum'
import { openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'

export type StagedOperationOutcome = {
	errorMessage: string
	operation: bigint
	operationId: bigint
	success: boolean
}

export function stagedOperationOutcome(log: Pick<TransactionLog, 'data' | 'topics'>, operationId: bigint): StagedOperationOutcome | undefined {
	try {
		const decoded = decodeEventLog({ abi: openOraclePriceCoordinatorAbi, data: log.data, topics: log.topics })
		if (decoded.eventName === 'ExecutedStagedOperation' && decoded.args.operationId === operationId) {
			return {
				errorMessage: decoded.args.errorMessage,
				operation: decoded.args.operation,
				operationId: decoded.args.operationId,
				success: decoded.args.success,
			}
		}
	} catch (error) {
		void error
	}
	return undefined
}
