import type { PlanningOptions } from './types.ts'

export type OperationInputValues = Record<string, string>

export function inputText(options: PlanningOptions, key: string, fallback: string) {
	return options.operationInputs?.[key] ?? fallback
}

export function inputInteger(options: PlanningOptions, key: string, fallback: bigint, minimum = 0n, maximum = (1n << 256n) - 1n) {
	const raw = options.operationInputs?.[key]
	if (raw === undefined) return fallback
	if (!/^-?(0|[1-9]\d*)$/.test(raw) || raw.length > 79) throw new Error(`${key} must be a whole number`)
	const value = BigInt(raw)
	if (value < minimum || value > maximum) throw new Error(`${key} is outside the available balance, policy, or protocol bounds`)
	return value
}

export function inputSpend(options: PlanningOptions, fallback: bigint, balance: bigint, reserve: bigint, maximum: bigint, minimum = 1n, key = 'amount') {
	const available = balance > reserve ? balance - reserve : 0n
	const limit = available < maximum ? available : maximum
	if (options.operationInputs?.[key] === undefined) return fallback
	const value = inputInteger(options, key, fallback, minimum)
	return value <= limit ? value : 0n
}

export function inputMatches(options: PlanningOptions, key: string, value: string | number | bigint) {
	const requested = options.operationInputs?.[key]
	return requested === undefined || requested.toLowerCase() === value.toString().toLowerCase()
}

export function inputList(options: PlanningOptions, key: string, fallback: string[]) {
	const raw = options.operationInputs?.[key]
	if (raw === undefined) return fallback
	const parsed: unknown = JSON.parse(raw)
	if (!Array.isArray(parsed) || parsed.length > 256 || !parsed.every((value): value is string => typeof value === 'string')) throw new Error(`${key} must be a list of at most 256 strings`)
	return parsed
}

export function storedInputValues(value: unknown): OperationInputValues {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stored operation inputs must be an object')
	const entries = Object.entries(value)
	if (entries.length > 100) throw new Error('Too many stored operation inputs')
	const values: OperationInputValues = {}
	for (const [key, input] of entries) {
		if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || key.length > 64 || typeof input !== 'string' || input.length > 16_384) throw new Error('Invalid stored operation input')
		values[key] = input
	}
	return values
}

export function storedInputSources(value: unknown) {
	const sources: Record<string, 'custom' | 'chaosbot'> = {}
	for (const [key, source] of Object.entries(storedInputValues(value))) {
		if (source !== 'custom' && source !== 'chaosbot') throw new Error('Invalid stored operation input source')
		sources[key] = source
	}
	return sources
}
