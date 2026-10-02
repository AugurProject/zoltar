import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import { formatUnits, parseUnits } from '@zoltar/core-shared/evm/ethereum'
import type { Hex } from '../ethereum.ts'

const HASH32_PATTERN = /^0x[0-9a-fA-F]{64}$/
const DECIMAL_PLACES = 18

export function isHash32(value: unknown): value is Hex {
	return typeof value === 'string' && HASH32_PATTERN.test(value)
}

export function hash32(value: unknown, label: string) {
	if (!isHash32(value)) throw new Error(`${label} must be a 32-byte hash`)
	return value
}

export function normalizedHash32(value: unknown, label: string) {
	return hash32(typeof value === 'string' ? value.toLowerCase() : value, label)
}

const UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
const SIGNED_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/

/** Strictly parses a canonical non-negative decimal with at most 18 fractional digits into its 18-decimal integer amount. */
export function parseDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !UNSIGNED_DECIMAL_PATTERN.test(value)) throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	return parseUnits(value, DECIMAL_PLACES)
}

/** Strictly parses a canonical, optionally negative decimal with at most 18 fractional digits into its 18-decimal integer amount. */
export function parseSignedDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !SIGNED_DECIMAL_PATTERN.test(value)) throw new Error(`${label} must be a decimal with at most 18 places`)
	return parseUnits(value, DECIMAL_PLACES)
}

/** Formats an 18-decimal integer amount, including negative amounts, without trailing fractional zeros. */
export function formatDecimalAmount(value: bigint) {
	return formatUnits(value, DECIMAL_PLACES)
}

export function record(value: unknown, label: string, message = `${label} must be an object`): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(message)
	return value
}

export function boolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
	return value
}

export function integer(value: unknown, label: string, minimum: number, maximum: number, message = `${label} must be an integer from ${minimum.toString()} through ${maximum.toString()}`) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(message)
	return value
}

export function nonemptyString(value: unknown, label: string, maximumLength?: number) {
	if (typeof value !== 'string' || value.trim() === '' || (maximumLength !== undefined && value.length > maximumLength)) throw new Error(`${label} must be a non-empty string${maximumLength === undefined ? '' : ` of at most ${maximumLength.toString()} characters`}`)
	return value
}

/** A JSON object: the core `isObjectRecord` guard, narrowed further to exclude arrays. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return isObjectRecord(value) && !Array.isArray(value)
}

export function optionalRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? Object.fromEntries(Object.entries(value)) : undefined
}
