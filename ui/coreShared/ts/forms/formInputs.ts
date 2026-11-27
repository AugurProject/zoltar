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

const LOCAL_DATE_TIME_PATTERN = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/

/**
 * A `datetime-local` value names a wall-clock time in the browser's zone. A time skipped by a daylight saving change
 * (02:30 on a spring-forward day) does not exist, and `Date` would silently move it an hour, so it is rejected.
 */
function isExistingLocalDateTime(value: string, date: Date) {
	const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim())
	if (match === null) return true
	const [, year, month, day, hour, minute, second] = match
	return date.getFullYear() === Number(year) && date.getMonth() + 1 === Number(month) && date.getDate() === Number(day) && date.getHours() === Number(hour) && date.getMinutes() === Number(minute) && date.getSeconds() === Number(second ?? '0')
}

export function tryParseTimestampInput(value: string) {
	const trimmed = normalizeNumericInput(value)
	if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed)
	const date = new Date(value)
	const timestampMs = date.getTime()
	if (Number.isNaN(timestampMs)) return undefined
	if (!isExistingLocalDateTime(value, date)) return undefined
	return BigInt(Math.floor(timestampMs / 1000))
}

function padDateTimePart(value: number, length = 2) {
	return value.toString().padStart(length, '0')
}

/** The `datetime-local` value naming this instant in the browser's zone: the inverse of `tryParseTimestampInput`. */
export function formatLocalDateTimeInput(timestamp: bigint) {
	const date = new Date(Number(timestamp) * 1000)
	if (Number.isNaN(date.getTime()) || date.getFullYear() < 0) return undefined
	const seconds = date.getSeconds()
	const time = `${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}${seconds === 0 ? '' : `:${padDateTimePart(seconds)}`}`
	return `${padDateTimePart(date.getFullYear(), 4)}-${padDateTimePart(date.getMonth() + 1)}-${padDateTimePart(date.getDate())}T${time}`
}

export function parseTimestampInput(value: string, label: string) {
	const timestamp = tryParseTimestampInput(value)
	if (timestamp === undefined) throw new Error(`${label} is invalid`)
	if (timestamp < 0n) throw new Error(`${label} must be on or after January 1, 1970 at 00:00 UTC`)
	return timestamp
}
