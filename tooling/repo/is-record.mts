/** Narrows a parsed JSON value or loaded module to a string-keyed object; arrays and null are not records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
