import type { ReportingOutcomeKey } from '../types/contracts.js'
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem'
import { parseBigIntInput, tryParseBigIntInput } from './marketForm.js'
import { deriveTokenApprovalRequirement } from './tokenApproval.js'

export function tryParseAddressInput(value: string): Address | undefined {
	const trimmed = value.trim()
	if (trimmed === '' || !isAddress(trimmed)) return undefined
	return getAddress(trimmed)
}

export function parseAddressInput(value: string, label: string): Address {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${label} is required`)
	const parsed = tryParseAddressInput(value)
	if (parsed === undefined) throw new Error(`${label} must be a valid address: ${trimmed}`)
	return parsed
}

export function resolveOptionalAddressInput(value: string | undefined, fallbackAddress: Address, label: string) {
	const trimmed = value?.trim() ?? ''
	if (trimmed === '') return fallbackAddress
	return parseAddressInput(trimmed, label)
}

export function parseBytes32Input(value: string, label: string): Hex {
	const trimmed = value.trim()
	if (!isHex(trimmed, { strict: true }) || trimmed.length !== 66) throw new Error(`${label} must be a 32-byte hex value`)

	return trimmed
}

export function parseReportIdInput(value: string) {
	return parseBigIntInput(value, 'Report ID')
}

export function parseOptionalBigIntInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return undefined
	return tryParseBigIntInput(trimmed)
}

function parseListInput<T>(value: string, label: string, parseItem: (entry: string, index: number) => T): T[] {
	const values = value
		.split(',')
		.map(entry => entry.trim())
		.filter(entry => entry !== '')
	if (values.length === 0) throw new Error(`${label} is required`)
	return values.map(parseItem)
}

function getListEntries(value: string) {
	return value
		.split(',')
		.map(entry => entry.trim())
		.filter(entry => entry !== '')
}

export function parseBigIntListInput(value: string, label: string) {
	return parseListInput(value, label, (entry, index) => {
		const parsed = tryParseBigIntInput(entry)
		if (parsed === undefined) throw new Error(`${label} #${index + 1} must be a whole number`)
		return parsed
	})
}

export function tryParseBigIntListInput(value: string) {
	const entries = getListEntries(value)
	if (entries.length === 0) return undefined
	const parsedEntries: bigint[] = []
	for (const entry of entries) {
		const parsed = tryParseBigIntInput(entry)
		if (parsed === undefined) return undefined
		parsedEntries.push(parsed)
	}
	return parsedEntries
}

export function resolveOptionalBigIntListInput(value: string, fallback: bigint[], label: string) {
	const trimmed = value.trim()
	if (trimmed === '') return fallback
	return parseBigIntListInput(trimmed, label)
}

export function parseReportingOutcomeInput(value: string): ReportingOutcomeKey {
	switch (value) {
		case 'invalid':
		case 'yes':
		case 'no':
			return value
		default:
			throw new Error(`Unknown reporting outcome: ${value}`)
	}
}

export function getReportingOutcomeKey(outcome: ReportingOutcomeKey | bigint): ReportingOutcomeKey {
	if (typeof outcome !== 'bigint') return outcome
	switch (outcome) {
		case 0n:
			return 'invalid'
		case 1n:
			return 'yes'
		case 2n:
			return 'no'
		default:
			throw new Error(`Unsupported child universe outcome index: ${outcome.toString()}`)
	}
}

export function approvalShortage(amount: bigint | undefined, allowance: bigint | undefined): bigint | undefined {
	return deriveTokenApprovalRequirement(amount, allowance).neededAmount
}

export function approvalTargetAmount(amount: bigint | undefined, allowance: bigint | undefined): bigint | undefined {
	return deriveTokenApprovalRequirement(amount, allowance).targetAmount
}

export function balanceShortage(amount: bigint | undefined, balance: bigint | undefined): bigint | undefined {
	if (amount === undefined || balance === undefined) return undefined
	return amount > balance ? amount - balance : 0n
}

export function parseReportingOutcomeListInput(value: string, label: string): ReportingOutcomeKey[] {
	return parseListInput(value, label, entry => parseReportingOutcomeInput(entry.toLowerCase()))
}
