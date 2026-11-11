import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord, requireArrayOf } from '@zoltar/core-shared/validation/guards'

export type SecurityPoolDeploymentTuple = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	parent: Address
	openOraclePriceCoordinator: Address
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	securityPool: Address
	collateralRepairAuction: Address
	universeId: bigint
}

function isSecurityPoolDeploymentTuple(value: unknown): value is SecurityPoolDeploymentTuple {
	return (
		isObjectRecord(value) &&
		typeof value['initialReportPriorityFeeAttoEthPerGas'] === 'bigint' &&
		typeof value['parent'] === 'string' &&
		typeof value['openOraclePriceCoordinator'] === 'string' &&
		typeof value['questionId'] === 'bigint' &&
		typeof value['statoblastSecurityMultiplierBps'] === 'bigint' &&
		typeof value['securityPool'] === 'string' &&
		typeof value['collateralRepairAuction'] === 'string' &&
		typeof value['universeId'] === 'bigint'
	)
}

export const requireSecurityPoolDeploymentTupleArray = requireArrayOf(isSecurityPoolDeploymentTuple)
