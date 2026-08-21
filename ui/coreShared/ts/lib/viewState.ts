export function resolveEnumValue<T extends string>(value: string | undefined, fallback: T, allowedValues: readonly T[]) {
	if (value !== undefined && allowedValues.includes(value as T)) return value as T
	return fallback
}

export function resolveFirstMatchingValue<T>(entries: Array<[boolean, T]>, fallback: T) {
	for (const [matches, value] of entries) {
		if (matches) return value
	}
	return fallback
}
