/** Longest string any sanitized public field publishes. Producers must truncate to this visibly. */
export const MAXIMUM_PUBLIC_FIELD_LENGTH = 1_000

export function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

export function safeString(value: unknown) {
	if (typeof value !== 'string') return undefined
	const sensitive =
		/(?:authorization|bearer|password|private[_-]?key|secret|token|api[_-]?key|rpc[_-]?(?:url|endpoint)|calldata|raw[_-]?(?:transaction|tx)|signed[_-]?(?:transaction|tx))\s*[=:]/i.test(value) ||
		/https?:\/\//i.test(value) ||
		/(?:[a-z]:\\|\/(?:etc|home|root|tmp|var|workspace)\/)/i.test(value) ||
		/0x[0-9a-f]{130,}/i.test(value)
	return sensitive ? undefined : value.slice(0, MAXIMUM_PUBLIC_FIELD_LENGTH)
}

export function stringField(source: Record<string, unknown>, key: string) {
	return safeString(source[key])
}

export function booleanField(source: Record<string, unknown>, key: string) {
	return typeof source[key] === 'boolean' ? source[key] : undefined
}

function numberField(source: Record<string, unknown>, key: string) {
	return typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] : undefined
}

export function scalar(source: Record<string, unknown>, key: string) {
	const value = source[key]
	return stringField(source, key) ?? numberField(source, key) ?? booleanField(source, key) ?? (typeof value === 'bigint' ? value.toString() : undefined)
}

export function safeIntegerField(source: Record<string, unknown>, key: string) {
	const value = source[key]
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function isoTimestampField(source: Record<string, unknown>, key: string) {
	const value = source[key]
	if (typeof value !== 'string') return undefined
	const milliseconds = Date.parse(value)
	return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined
}

export function compact<T extends Record<string, unknown>>(value: T) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}
