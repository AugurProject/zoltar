import { encodeAbiParameters, getAddress, keccak256, zeroAddress, type Address, type Hex } from 'viem'
import type { ForkOutcomeKey, MarketType, QuestionData, ReportingOutcomeKey, SecurityPoolSystemState } from '../types/contracts.js'

type IntegerLike = bigint | number

type SecurityVaultTuple = readonly [bigint, bigint, bigint, bigint, bigint]
export type UniverseTuple = readonly [bigint, bigint, bigint, Address, bigint]
type EscalationGameTuple = readonly [bigint, bigint, bigint, bigint, bigint, [bigint, bigint, bigint], IntegerLike, bigint, IntegerLike, bigint, boolean]
type OpenOracleReportMetaTuple = readonly [bigint, bigint, bigint, bigint, Address, IntegerLike, Address, boolean, IntegerLike, IntegerLike, IntegerLike, IntegerLike]
type OpenOracleReportStatusTuple = readonly [bigint, bigint, bigint, Address, IntegerLike, IntegerLike, Address, IntegerLike, boolean, boolean]
type OpenOracleExtraDataTuple = readonly [Hex, Address, IntegerLike, IntegerLike, Hex, Address, boolean, boolean, boolean]

export function bigintToAddress(value: bigint): Address {
	return getAddress(`0x${value.toString(16).padStart(40, '0')}`)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
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

export function hasTimestamp(value: unknown): value is { timestamp: bigint } {
	return isObjectRecord(value) && typeof value['timestamp'] === 'bigint'
}

export function hasTimestampAndNumber(value: unknown): value is { timestamp: bigint; number: bigint } {
	return isObjectRecord(value) && typeof value['timestamp'] === 'bigint' && typeof value['number'] === 'bigint'
}

function isUniverseTuple(value: unknown): value is UniverseTuple {
	return Array.isArray(value) && value.length === 5 && typeof value[0] === 'bigint' && typeof value[1] === 'bigint' && typeof value[2] === 'bigint' && typeof value[3] === 'string' && typeof value[4] === 'bigint'
}

export function requireUniverseTupleArray(value: unknown, context: string): UniverseTuple[] {
	if (Array.isArray(value) && value.every(isUniverseTuple)) return value
	throw new Error(`Unexpected ${context} response`)
}

function isEscalationGameTuple(value: unknown): value is EscalationGameTuple {
	return (
		Array.isArray(value) &&
		value.length === 11 &&
		typeof value[0] === 'bigint' &&
		typeof value[1] === 'bigint' &&
		typeof value[2] === 'bigint' &&
		typeof value[3] === 'bigint' &&
		typeof value[4] === 'bigint' &&
		isBigintTriple(value[5]) &&
		isIntegerLike(value[6]) &&
		typeof value[7] === 'bigint' &&
		isIntegerLike(value[8]) &&
		typeof value[9] === 'bigint' &&
		typeof value[10] === 'boolean'
	)
}

export function requireEscalationGameTuple(value: unknown, context: string): EscalationGameTuple {
	if (isEscalationGameTuple(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

function isSecurityVaultTuple(value: unknown): value is SecurityVaultTuple {
	return Array.isArray(value) && value.length === 5 && value.every(item => typeof item === 'bigint')
}

export function requireSecurityVaultTupleArray(value: unknown, context: string): SecurityVaultTuple[] {
	if (Array.isArray(value) && value.every(isSecurityVaultTuple)) return value
	throw new Error(`Unexpected ${context} response`)
}

function isOpenOracleReportMetaTuple(value: unknown): value is OpenOracleReportMetaTuple {
	return (
		Array.isArray(value) &&
		value.length === 12 &&
		typeof value[0] === 'bigint' &&
		typeof value[1] === 'bigint' &&
		typeof value[2] === 'bigint' &&
		typeof value[3] === 'bigint' &&
		typeof value[4] === 'string' &&
		isIntegerLike(value[5]) &&
		typeof value[6] === 'string' &&
		typeof value[7] === 'boolean' &&
		isIntegerLike(value[8]) &&
		isIntegerLike(value[9]) &&
		isIntegerLike(value[10]) &&
		isIntegerLike(value[11])
	)
}

export function requireOpenOracleReportMetaTuple(value: unknown, context: string): OpenOracleReportMetaTuple {
	if (isOpenOracleReportMetaTuple(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

export function requireOpenOracleReportMetaTupleArray(value: unknown, context: string): OpenOracleReportMetaTuple[] {
	if (Array.isArray(value) && value.every(isOpenOracleReportMetaTuple)) return value
	throw new Error(`Unexpected ${context} response`)
}

function isOpenOracleReportStatusTuple(value: unknown): value is OpenOracleReportStatusTuple {
	return (
		Array.isArray(value) &&
		value.length === 10 &&
		typeof value[0] === 'bigint' &&
		typeof value[1] === 'bigint' &&
		typeof value[2] === 'bigint' &&
		typeof value[3] === 'string' &&
		isIntegerLike(value[4]) &&
		isIntegerLike(value[5]) &&
		typeof value[6] === 'string' &&
		isIntegerLike(value[7]) &&
		typeof value[8] === 'boolean' &&
		typeof value[9] === 'boolean'
	)
}

export function requireOpenOracleReportStatusTuple(value: unknown, context: string): OpenOracleReportStatusTuple {
	if (isOpenOracleReportStatusTuple(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

export function requireOpenOracleReportStatusTupleArray(value: unknown, context: string): OpenOracleReportStatusTuple[] {
	if (Array.isArray(value) && value.every(isOpenOracleReportStatusTuple)) return value
	throw new Error(`Unexpected ${context} response`)
}

function isOpenOracleExtraDataTuple(value: unknown): value is OpenOracleExtraDataTuple {
	return (
		Array.isArray(value) &&
		value.length === 9 &&
		typeof value[0] === 'string' &&
		typeof value[1] === 'string' &&
		isIntegerLike(value[2]) &&
		isIntegerLike(value[3]) &&
		typeof value[4] === 'string' &&
		typeof value[5] === 'string' &&
		typeof value[6] === 'boolean' &&
		typeof value[7] === 'boolean' &&
		typeof value[8] === 'boolean'
	)
}

export function requireOpenOracleExtraDataTuple(value: unknown, context: string): OpenOracleExtraDataTuple {
	if (isOpenOracleExtraDataTuple(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

export function getQuestionId(questionData: QuestionData, outcomeOptions: readonly string[]) {
	return BigInt(
		keccak256(
			encodeAbiParameters(
				[
					{
						type: 'tuple',
						components: [
							{ name: 'title', type: 'string' },
							{ name: 'description', type: 'string' },
							{ name: 'startTime', type: 'uint256' },
							{ name: 'endTime', type: 'uint256' },
							{ name: 'numTicks', type: 'uint120' },
							{ name: 'displayValueMin', type: 'int256' },
							{ name: 'displayValueMax', type: 'int256' },
							{ name: 'answerUnit', type: 'string' },
						],
					},
					{ type: 'string[]' },
				],
				[questionData, outcomeOptions],
			),
		),
	)
}

export function getQuestionIdHex(questionId: bigint) {
	return `0x${questionId.toString(16)}`
}

export function getReportingOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0
		case 'yes':
			return 1
		case 'no':
			return 2
		default:
			throw new Error(`Unhandled reporting outcome: ${JSON.stringify(outcome)}`)
	}
}

export function getReportingOutcomeKey(outcome: bigint | number): ReportingOutcomeKey | 'none' {
	switch (outcome) {
		case 0:
		case 0n:
			return 'invalid'
		case 1:
		case 1n:
			return 'yes'
		case 2:
		case 2n:
			return 'no'
		default:
			return 'none'
	}
}

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

export function getSecurityPoolSystemState(value: bigint | number): SecurityPoolSystemState {
	switch (value) {
		case 0:
		case 0n:
			return 'operational'
		case 1:
		case 1n:
			return 'poolForked'
		case 2:
		case 2n:
			return 'forkMigration'
		case 3:
		case 3n:
			return 'forkTruthAuction'
		default:
			throw new Error(`Unhandled security pool system state: ${JSON.stringify(value)}`)
	}
}

export function getMarketType(questionData: QuestionData, outcomeLabels: string[]): MarketType {
	if (outcomeLabels.length === 0 && questionData.numTicks > 0n) return 'scalar'
	if (outcomeLabels.length === 2 && outcomeLabels[0] === 'Yes' && outcomeLabels[1] === 'No') return 'binary'
	return 'categorical'
}

function toUint8(value: bigint) {
	if (value < 0n || value > 255n) throw new Error(`Deposit index out of range: ${value.toString()}`)

	const numberValue = Number(value)
	if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 255) throw new Error(`Deposit index out of range: ${value.toString()}`)

	return numberValue
}

export function toUint8Array(values: bigint[]) {
	return values.map(value => toUint8(value))
}
