export function resolveEnumValue<T extends string>(value: string | undefined, fallback: T, allowedValues: readonly T[]) {
	return allowedValues.find(allowed => allowed === value) ?? fallback
}

export function resolveFirstMatchingValue<T>(entries: Array<[boolean, T]>, fallback: T) {
	for (const [matches, value] of entries) {
		if (matches) return value
	}
	return fallback
}
