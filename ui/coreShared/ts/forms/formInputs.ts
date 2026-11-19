import { parseDecimalInput, tryParseDecimalInput } from './decimal.js'
import { normalizeNumericInput } from '../lib/numericInput.js'

export function parseRepAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseRepAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseOptionalRepAmountInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return undefined
	return tryParseRepAmountInput(trimmed)
}

export function tryParseTimestampInput(value: string) {
	const trimmed = normalizeNumericInput(value)
	if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed)
	const date = new Date(value)
	const timestampMs = date.getTime()
	if (Number.isNaN(timestampMs)) return undefined
	// datetime-local must preserve the entered wall-clock time across DST gaps.
	const local = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value)
	if (local !== null) {
		const expected = [Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] ?? 0), Number((local[7] ?? '').padEnd(3, '0'))]
		const actual = [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
		if (actual.some((part, index) => part !== expected[index])) return undefined
	}
	return BigInt(Math.floor(timestampMs / 1000))
}

export function parseTimestampInput(value: string, label: string) {
	const timestamp = tryParseTimestampInput(value)
	if (timestamp === undefined) throw new Error(`${label} is invalid`)
	if (timestamp < 0n) throw new Error(`${label} must not be before the Unix epoch`)
	return timestamp
}
