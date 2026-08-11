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

export const isCurrentLiveRequest = (requestVersion, currentVersion, responseChainId, selectedChainId) =>
	requestVersion === currentVersion && String(responseChainId) === String(selectedChainId)

export const isNoncanonicalDetailFailure = (canonicalRecovery, status) => canonicalRecovery && status === 404

export const shouldClearPendingDetailState = (preservePendingOnClose) => !preservePendingOnClose

export const shouldContinueTransactionRestore = (loaded, loadedCount, targetLoadedCount, nextPageCursor) =>
	loaded && loadedCount < targetLoadedCount && nextPageCursor !== undefined

export const indexerConnectionStatus = (network, streamState, networkRequestFailed, streamHasOpened = false) => {
	if (networkRequestFailed) return { label: 'Status unavailable', tone: 'error' }
	if (streamHasOpened && streamState !== 'open') {
		if (network?.phase === 'degraded') return { label: 'Indexer retrying · Reconnecting', tone: 'error' }
		if (network?.indexed_block === null) return { label: 'Indexer starting · Reconnecting', tone: 'error' }
		if (network?.phase === 'backfilling') return { label: `Backfill #${network.indexed_block} · Reconnecting`, tone: 'error' }
		return { label: 'Reconnecting', tone: 'error' }
	}
	if (network?.phase === 'degraded') return { label: 'Indexer retrying', tone: 'error' }
	if (network?.indexed_block === null) return { label: 'Indexer starting', tone: 'pending' }
	if (network?.phase === 'backfilling') return { label: `Backfilling #${network.indexed_block}`, tone: 'pending' }
	if (streamState === 'open') return { label: 'Live connection', tone: 'live' }
	if (network !== undefined) return { label: 'Reconnecting', tone: 'error' }
	return { label: 'Connecting', tone: 'pending' }
}

export const reconcileTransactionDialogSnapshot = (snapshot, availableKeys) => ({
	...snapshot,
	expandedKeys: snapshot.expandedKeys.filter((key) => key !== undefined && availableKeys.has(key)),
	anchorKey: snapshot.anchorKey !== undefined && availableKeys.has(snapshot.anchorKey) ? snapshot.anchorKey : undefined,
	focusKey: snapshot.focusKey !== undefined && availableKeys.has(snapshot.focusKey) ? snapshot.focusKey : undefined,
	focusIndex: snapshot.focusKey !== undefined && availableKeys.has(snapshot.focusKey) ? snapshot.focusIndex : -1,
})

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
			let failure
			let failed = false
			do {
				const nextCount = pendingCount
				const nextForce = pendingForce
				pendingCount = 0
				pendingForce = false
				try {
					result = await refresh(nextCount, nextForce)
					failure = undefined
					failed = false
				} catch (error) {
					failure = error
					failed = true
				}
			} while (pendingCount > 0)
			if (failed) throw failure
			return result
		})().finally(() => {
			inFlight = undefined
		})
		return inFlight
	}
}

export const createLiveRouteRefreshCoordinator = (refresh, currentRecovery) =>
	createLatestRefreshCoordinator((count, force) => refresh(count, force, currentRecovery()))
