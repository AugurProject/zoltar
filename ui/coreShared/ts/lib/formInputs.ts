import { parseDecimalInput, tryParseDecimalInput } from './decimal.js'

export function parseRepAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function parseEthAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseRepAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function tryParseEthAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseOptionalRepAmountInput(value: string) {
	const trimmed = value.trim()
	if (trimmed === '') return undefined
	return tryParseRepAmountInput(trimmed)
}

export function parseTradingAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseTradingAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseTruthAuctionPriceInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseTruthAuctionPriceInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function parseTruthAuctionAmountInput(value: string, label: string) {
	return parseDecimalInput(value, label, 18)
}

export function tryParseTruthAuctionAmountInput(value: string) {
	return tryParseDecimalInput(value, 18)
}

export function tryParseTimestampInput(value: string) {
	const trimmed = value.trim()
	if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed)
	const timestampMs = new Date(value).getTime()
	if (Number.isNaN(timestampMs)) return undefined
	return BigInt(Math.floor(timestampMs / 1000))
}

export function parseTimestampInput(value: string, label: string) {
	const timestamp = tryParseTimestampInput(value)
	if (timestamp === undefined) throw new Error(`${label} is invalid`)
	if (timestamp < 0n) throw new Error(`${label} must not be before the Unix epoch`)
	return timestamp
}
