import type { MarketFormState } from '../types/app.js'

function toDatetimeLocalValue(timestampMs: number) {
	const date = new Date(timestampMs)
	const offset = date.getTimezoneOffset()
	const localDate = new Date(date.getTime() - offset * 60 * 1000)
	return localDate.toISOString().slice(0, 16)
}

export function getDefaultMarketFormState(): MarketFormState {
	return {
		title: '',
		description: '',
		startTime: '',
		endTime: toDatetimeLocalValue(Date.now() + 24 * 60 * 60 * 1000),
		securityMultiplier: '2',
		currentRetentionRate: '999999996848000000',
		startingRepEthPrice: '10',
	}
}

export function parseBigIntInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${ label } is required`)
	try {
		return BigInt(trimmed)
	} catch {
		throw new Error(`${ label } must be a whole number`)
	}
}

export function parseTimestampInput(value: string, label: string) {
	const timestampMs = new Date(value).getTime()
	if (Number.isNaN(timestampMs)) throw new Error(`${ label } is invalid`)
	return BigInt(Math.floor(timestampMs / 1000))
}
