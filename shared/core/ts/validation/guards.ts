/** Narrows a value to an indexable non-null object; arrays also qualify. */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Builds a validator that returns an array only when every element satisfies `guard`. */
export function requireArrayOf<T>(guard: (value: unknown) => value is T) {
	return (value: unknown, context: string): T[] => {
		if (Array.isArray(value) && value.every(guard)) return value
		throw new Error(`Unexpected ${context} response`)
	}
}
