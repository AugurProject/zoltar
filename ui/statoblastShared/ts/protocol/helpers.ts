import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord, requireArrayOf } from '@zoltar/core-shared/validation/guards'

export type QuestionLedgerDeploymentTuple = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	parent: Address
	priceFeed: Address
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	questionLedger: Address
	universeId: bigint
}

function isQuestionLedgerDeploymentTuple(value: unknown): value is QuestionLedgerDeploymentTuple {
	return (
		isObjectRecord(value) &&
		typeof value['initialReportPriorityFeeAttoEthPerGas'] === 'bigint' &&
		typeof value['parent'] === 'string' &&
		typeof value['priceFeed'] === 'string' &&
		typeof value['questionId'] === 'bigint' &&
		typeof value['statoblastSecurityMultiplierBps'] === 'bigint' &&
		typeof value['questionLedger'] === 'string' &&
		typeof value['universeId'] === 'bigint'
	)
}

export const requireQuestionLedgerDeploymentTupleArray = requireArrayOf(isQuestionLedgerDeploymentTuple)
