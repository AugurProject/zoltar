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

export const createLatestRefreshCoordinator = (refresh) => {
	let inFlight
	let pendingCount = 0
	let pendingForce = false
	return (count = 1, force = false) => {
		pendingCount += count
		pendingForce ||= force
		if (inFlight !== undefined) return inFlight
		inFlight = (async () => {
			let result = false
			do {
				const nextCount = pendingCount
				const nextForce = pendingForce
				pendingCount = 0
				pendingForce = false
				result = await refresh(nextCount, nextForce)
			} while (pendingCount > 0)
			return result
		})().finally(() => {
			inFlight = undefined
		})
		return inFlight
	}
}
