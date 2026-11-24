import type { Address } from '@zoltar/core-shared/evm/ethereum'

export type QuestionLedgerDeploymentTuple = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	parent: Address
	openOraclePriceCoordinator: Address
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	questionLedger: Address
	universeId: bigint
}
