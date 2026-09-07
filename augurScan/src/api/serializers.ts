export const normalize = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) return value.map(normalize)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
	return value
}

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

export const decodedJsonColumns = (row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> => ({
	...row,
	...Object.fromEntries(columns.flatMap((column) => (row[column] === undefined ? [] : [[column, parsedJsonColumn(row[column])]]))),
})

export const actionJsonColumns = [
	'arguments',
	'display_arguments',
	'argument_schema',
	'action_arguments',
	'action_display_arguments',
	'action_argument_schema',
	'receipt',
] as const

export const json = (value: unknown, status = 200): Response =>
	Response.json(normalize(value), {
		status,
		headers: { 'cache-control': 'no-store' },
	})
