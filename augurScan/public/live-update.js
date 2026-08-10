export const classifyLiveRecords = (previous, current) =>
	current.map((record) => ({
		...record,
		state: previous.has(record.key) ? (previous.get(record.key) === record.signature ? 'unchanged' : 'changed') : 'added',
	}))

export const mergeUniqueRecords = (primary, retained, keyFor) => {
	const seen = new Set()
	return [...primary, ...retained].filter((record) => {
		const key = keyFor(record)
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export const reconcilePaginatedTotal = (currentTotal, responseTotal, append) => (append ? Math.max(currentTotal, responseTotal) : responseTotal)
