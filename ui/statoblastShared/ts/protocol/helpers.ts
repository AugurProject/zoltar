import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord, requireArrayOf } from '@zoltar/core-shared/validation/guards'

type SecurityVaultTuple = readonly [bigint, bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint, bigint]

export type SecurityPoolDeploymentTuple = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	parent: Address
	priceOracleManagerAndOperatorQueuer: Address
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	securityPool: Address
	truthAuction: Address
	universeId: bigint
}

function isSecurityPoolDeploymentTuple(value: unknown): value is SecurityPoolDeploymentTuple {
	return (
		isObjectRecord(value) &&
		typeof value['initialReportPriorityFeeAttoEthPerGas'] === 'bigint' &&
		typeof value['parent'] === 'string' &&
		typeof value['priceOracleManagerAndOperatorQueuer'] === 'string' &&
		typeof value['questionId'] === 'bigint' &&
		typeof value['statoblastSecurityMultiplierBps'] === 'bigint' &&
		typeof value['securityPool'] === 'string' &&
		typeof value['truthAuction'] === 'string' &&
		typeof value['universeId'] === 'bigint'
	)
}

export const requireSecurityPoolDeploymentTupleArray = requireArrayOf(isSecurityPoolDeploymentTuple)

function isSecurityVaultTuple(value: unknown): value is SecurityVaultTuple {
	return Array.isArray(value) && (value.length === 4 || value.length === 5) && value.every(item => typeof item === 'bigint')
}

export const requireSecurityVaultTupleArray = requireArrayOf(isSecurityVaultTuple)
