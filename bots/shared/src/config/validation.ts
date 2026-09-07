export function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

export function boolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
	return value
}

export function integer(value: unknown, label: string, minimum: number, maximum: number) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum.toString()} through ${maximum.toString()}`)
	return value
}

export function nonemptyString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
	return value
}

export function parseDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}
