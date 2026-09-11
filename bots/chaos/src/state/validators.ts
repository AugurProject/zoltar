import type { Hex } from '@zoltar/bot-shared/ethereum'

export function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

export function assertExactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string) {
	const allowed = new Set([...required, ...optional])
	const unknown = Object.keys(record).filter(key => !allowed.has(key))
	const missing = required.filter(key => !(key in record))
	if (unknown.length !== 0) throw new Error(`${label} contains unsupported field ${unknown[0] ?? 'unknown'}`)
	if (missing.length !== 0) throw new Error(`${label} is missing ${missing[0] ?? 'a required field'}`)
}

export function nonemptyString(value: unknown, label: string, maximumLength = 2_048) {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximumLength) throw new Error(`${label} must be a non-empty string of at most ${maximumLength.toString()} characters`)
	return value
}

export function optionalString(value: unknown, label: string, maximumLength = 2_048) {
	return value === undefined ? undefined : nonemptyString(value, label, maximumLength)
}

export function identifier(value: unknown, label: string) {
	const parsed = nonemptyString(value, label, 128)
	if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._:-]*[a-zA-Z0-9])?$/.test(parsed)) throw new Error(`${label} contains unsupported characters`)
	return parsed
}

export function unsignedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	return value
}

const MAXIMUM_UINT256 = (1n << 256n) - 1n

export function uint256String(value: unknown, label: string) {
	const parsed = unsignedIntegerString(value, label)
	if (BigInt(parsed) > MAXIMUM_UINT256) throw new Error(`${label} exceeds uint256`)
	return parsed
}

export function positiveIntegerString(value: unknown, label: string) {
	const parsed = unsignedIntegerString(value, label)
	if (parsed === '0') throw new Error(`${label} must be greater than zero`)
	return parsed
}

export function timestamp(value: unknown, label: string) {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical UTC ISO timestamp`)
	return value
}

export function optionalTimestamp(value: unknown, label: string) {
	return value === undefined ? undefined : timestamp(value, label)
}

export function hash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hash`)
	return value as Hex
}

export function dataHex(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${label} must be even-length 0x-prefixed hex`)
	return value as Hex
}
