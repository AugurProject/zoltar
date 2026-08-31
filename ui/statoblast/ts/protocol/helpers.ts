import type { Address } from '@zoltar/shared/ethereum'

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
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

export function requireSecurityPoolDeploymentTupleArray(value: unknown, context: string): SecurityPoolDeploymentTuple[] {
	if (Array.isArray(value) && value.every(isSecurityPoolDeploymentTuple)) return value
	throw new Error(`Unexpected ${context} response`)
}

function isSecurityVaultTuple(value: unknown): value is SecurityVaultTuple {
	return Array.isArray(value) && (value.length === 4 || value.length === 5) && value.every(item => typeof item === 'bigint')
}

export function requireSecurityVaultTupleArray(value: unknown, context: string): SecurityVaultTuple[] {
	if (Array.isArray(value) && value.every(isSecurityVaultTuple)) return value
	throw new Error(`Unexpected ${context} response`)
}
