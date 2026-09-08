export const parsedJsonColumn = (value: unknown): unknown => {
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value) as unknown
	} catch (error) {
		if (error instanceof SyntaxError) return value
		throw error
	}
}

export const jsonRecord = (value: unknown): Record<string, unknown> => {
	const parsed = parsedJsonColumn(value)
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : {}
}
