import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord, requireArrayOf } from '@zoltar/core-shared/validation/guards'
import type { ForkOutcomeKey, MarketType, QuestionData, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getReportingOutcomeKey } from '@zoltar/ui-core-shared/lib/contractEnums.js'

type IntegerLike = bigint | number

export type UniverseTuple = readonly [bigint, bigint, bigint, Address, bigint]
type StagedOperationTuple = {
	operationValue: bigint
	operator: Address
	operation: IntegerLike
	targetVault: Address
}
export function bigintToAddress(value: bigint): Address {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function isIntegerLike(value: unknown): value is IntegerLike {
	return typeof value === 'bigint' || typeof value === 'number'
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function isBigintTriple(value: unknown): value is [bigint, bigint, bigint] {
	return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'bigint')
}

export function getMinBigintValue(values: bigint[]) {
	const [firstValue, ...restValues] = values
	if (firstValue === undefined) return undefined

	let minValue = firstValue
	for (const value of restValues) {
		if (value < minValue) minValue = value
	}

	return minValue
}

export function getProtocolPageOffset(pageIndex: number, pageSize: number) {
	if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new Error('Page index must be a non-negative integer within the safe range')
	if (!Number.isSafeInteger(pageSize) || pageSize <= 0) throw new Error('Page size must be a positive integer within the safe range')
	return BigInt(pageIndex) * BigInt(pageSize)
}

export function hasTimestamp(value: unknown): value is { timestamp: bigint } {
	return isObjectRecord(value) && typeof value['timestamp'] === 'bigint'
}

export function hasTimestampAndNumber(value: unknown): value is { timestamp: bigint; number: bigint } {
	return isObjectRecord(value) && typeof value['timestamp'] === 'bigint' && typeof value['number'] === 'bigint'
}

function isUniverseTuple(value: unknown): value is UniverseTuple {
	return Array.isArray(value) && value.length === 5 && typeof value[0] === 'bigint' && typeof value[1] === 'bigint' && typeof value[2] === 'bigint' && typeof value[3] === 'string' && typeof value[4] === 'bigint'
}

export const requireUniverseTupleArray = requireArrayOf(isUniverseTuple)

function isStagedOperationTuple(value: unknown): value is StagedOperationTuple {
	return isObjectRecord(value) && typeof value['operationValue'] === 'bigint' && typeof value['operator'] === 'string' && isIntegerLike(value['operation']) && typeof value['targetVault'] === 'string'
}

export const requireStagedOperationTupleArray = requireArrayOf(isStagedOperationTuple)

export function getForkOutcomeKey(outcome: bigint | number, parentSecurityPoolAddress: Address): ForkOutcomeKey {
	if (parentSecurityPoolAddress === zeroAddress) return 'none'
	return getReportingOutcomeKey(outcome)
}

export function getEscalationSideLabel(key: ReportingOutcomeKey) {
	switch (key) {
		case 'invalid':
			return 'Invalid'
		case 'yes':
			return 'Yes'
		case 'no':
			return 'No'
		default:
			throw new Error(`Unhandled escalation side: ${JSON.stringify(key)}`)
	}
}

export function getMarketType(questionData: QuestionData, outcomeLabels: string[]): MarketType {
	if (outcomeLabels.length === 0 && questionData.numTicks > 0n) return 'scalar'
	if (outcomeLabels.length === 2 && outcomeLabels[0] === 'Yes' && outcomeLabels[1] === 'No') return 'binary'
	return 'categorical'
}
