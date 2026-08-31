type DatabaseJsonValue = boolean | null | number | string | DatabaseJsonValue[] | { readonly [key: string]: DatabaseJsonValue }

const databaseJsonValue = (value: unknown): DatabaseJsonValue | undefined => {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map((item) => databaseJsonValue(item) ?? null)
	if (value instanceof Date) return value.toJSON()
	if (typeof value !== 'object') return undefined
	if ('toJSON' in value && typeof value.toJSON === 'function') return databaseJsonValue(value.toJSON())
	const result: Record<string, DatabaseJsonValue> = {}
	for (const [key, item] of Object.entries(value)) {
		const normalized = databaseJsonValue(item)
		if (normalized !== undefined) result[key] = normalized
	}
	return result
}

export const databaseJsonText = (value: unknown): string => {
	const normalized = databaseJsonValue(value)
	if (normalized === undefined) throw new Error('Database JSON value cannot be serialized')
	return JSON.stringify(normalized)
}
