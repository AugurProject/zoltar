import { isAddress, type Address } from 'viem'

export function requireArrayValue(value: unknown, context: string): unknown[] {
	if (Array.isArray(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

export function requireTupleValue(value: unknown, length: number, context: string): unknown[] {
	const tuple = requireArrayValue(value, context)
	if (tuple.length === length) return tuple
	throw new Error(`Unexpected ${context} response`)
}

export function requireBigintValue(value: unknown, context: string) {
	if (typeof value === 'bigint') return value
	throw new Error(`Unexpected ${context} response`)
}

export function requireIntegerLikeValue(value: unknown, context: string) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isInteger(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

export function requireAddressValue(value: unknown, context: string): Address {
	if (typeof value === 'string' && isAddress(value)) return value
	throw new Error(`Unexpected ${context} response`)
}

export function requireObjectValue(value: unknown, context: string): object {
	if (typeof value === 'object' && value !== null) return value
	throw new Error(`Unexpected ${context} response`)
}
