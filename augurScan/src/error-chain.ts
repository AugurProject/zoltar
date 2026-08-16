export const errorChainIncludes = (error: unknown, names: ReadonlySet<string>): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('name' in current && typeof current.name === 'string' && names.has(current.name)) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}
