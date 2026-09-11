/** Field parsers shared by the durable state modules; each throws a labelled error so operators can locate a corrupt field. */

export function unsignedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	return value
}

export function timestamp(value: unknown, label: string) {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical UTC ISO timestamp`)
	return value
}
