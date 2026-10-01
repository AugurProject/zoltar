import { isObjectRecord } from '@zoltar/core-shared/validation/guards'

/** Copies the own enumerable fields of a non-array object; any other value becomes an empty record. */
export const plainRecord = (value: unknown): Record<string, unknown> => (isObjectRecord(value) && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {})

export const parsedJsonColumn = (value: unknown): unknown => {
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value) as unknown
	} catch (error) {
		if (error instanceof SyntaxError) return value
		throw error
	}
}

export const jsonRecord = (value: unknown): Record<string, unknown> => plainRecord(parsedJsonColumn(value))
