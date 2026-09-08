export function dashboardRecord(value: unknown, label: string) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be a JSON object`)
	return Object.fromEntries(Object.entries(value))
}

export function exactDashboardKeys(value: Record<string, unknown>, required: readonly string[], label: string) {
	const allowed = new Set(required)
	const missing = required.find(key => !(key in value))
	const unexpected = Object.keys(value).find(key => !allowed.has(key))
	if (missing !== undefined) throw new Error(`${label} is missing ${missing}`)
	if (unexpected !== undefined) throw new Error(`${label} contains unsupported field ${unexpected}`)
}
