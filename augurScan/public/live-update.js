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

export const canonicalPageLimit = (targetCount, loadedCount, pageSize) => (targetCount > loadedCount ? Math.min(pageSize, targetCount - loadedCount) : pageSize)

export const collectCanonicalPages = async (fetchPage, targetCount, keyFor) => {
	let cursor
	let items = []
	do {
		const remaining = targetCount > 0 ? canonicalPageLimit(targetCount, items.length, 100) : undefined
		const page = await fetchPage(cursor, remaining)
		items = mergeUniqueRecords(items, page.items, keyFor)
		cursor = page.nextCursor
	} while (cursor !== undefined && items.length < targetCount)
	return { items: targetCount > 0 ? items.slice(0, targetCount) : items, nextCursor: cursor }
}

export const reconcilePaginatedTotal = (currentTotal, responseTotal, append) => (append ? Math.max(currentTotal, responseTotal) : responseTotal)

export const paginatedSnapshotWasReplaced = (loadedCount, responseTotal) => responseTotal < loadedCount

export const refreshPresentation = ({ live, append = false }) => {
	const visible = !live || append
	return { busy: visible, loadingState: visible }
}

export const resolveActivityRefreshDepth = (...depths) => {
	const targetDepth = Math.max(0, ...depths.filter((depth) => Number.isInteger(depth) && depth > 0))
	return targetDepth > 0 ? targetDepth : undefined
}

export const activityRefreshRetention = (canonicalRefreshRequired, canonicalDepth, visibleDepth) => ({
	replaceDepth: resolveActivityRefreshDepth(canonicalRefreshRequired ? canonicalDepth : undefined, visibleDepth),
	retainVisibleDepth: true,
})

export const retainedPaginationAvailable = (hasContinuation, canonicalRefreshRequired) => hasContinuation && !canonicalRefreshRequired

export const transactionRetryMode = (appendFailure, hasLoadedTransactions) => ({
	append: appendFailure,
	liveRefresh: !appendFailure && hasLoadedTransactions,
})

export const accountStateDuringStagedRefresh = (committedState, stagedState, stagedRefresh) => (stagedRefresh ? committedState : stagedState)

export const createForegroundRefreshGate = () => {
	let active
	const run = (operation) => {
		let request
		if (active === undefined) {
			try {
				request = Promise.resolve(operation())
			} catch (error) {
				request = Promise.reject(error)
			}
		} else {
			request = active.then(
				() => operation(),
				() => operation(),
			)
		}
		active = request
		const clear = () => {
			if (active === request) active = undefined
		}
		void request.then(clear, clear)
		return request
	}
	const reserve = () => {
		let markReady
		let releaseOperation
		const ready = new Promise((resolve) => {
			markReady = resolve
		})
		const completed = run(
			() =>
				new Promise((resolve) => {
					releaseOperation = resolve
					markReady()
				}),
		)
		return { ready, release: () => releaseOperation(), completed }
	}
	return { runBackground: run, runForeground: run, reserve }
}

export const runWithForegroundReservation = async (gate, operation) => {
	const reservation = gate.reserve()
	try {
		await reservation.ready
		return await operation()
	} finally {
		reservation.release()
		await reservation.completed
	}
}

export const isCurrentLiveRequest = (requestVersion, currentVersion, responseChainId, selectedChainId) =>
	requestVersion === currentVersion && String(responseChainId) === String(selectedChainId)

export const isCurrentContextRequest = (requestContext, currentContext, requestVersion, currentVersion) =>
	requestContext === currentContext && requestVersion === currentVersion

export const isNoncanonicalDetailFailure = (canonicalRecovery, status) => canonicalRecovery && status === 404

export const shouldClearPendingDetailState = (preservePendingOnClose) => !preservePendingOnClose

export const shouldContinueTransactionRestore = (loaded, loadedCount, targetLoadedCount, nextPageCursor) =>
	loaded && loadedCount < targetLoadedCount && nextPageCursor !== undefined

export const indexerConnectionStatus = (network, streamState, networkRequestFailed, streamHasOpened = false) => {
	if (networkRequestFailed) return { label: 'Status unavailable', tone: 'error' }
	const waitingForStart = indexerWaitingForStart(network)
	if (streamHasOpened && streamState !== 'open') {
		if (network?.phase === 'degraded') return { label: 'Indexer retrying · Reconnecting', tone: 'error' }
		if (waitingForStart) return { label: `Waiting for #${network.start_block} · Reconnecting`, tone: 'error' }
		if (network?.indexed_block === null) return { label: 'Indexer starting · Reconnecting', tone: 'error' }
		if (network?.phase === 'backfilling') return { label: `Backfill #${network.indexed_block} · Reconnecting`, tone: 'error' }
		return { label: 'Reconnecting', tone: 'error' }
	}
	if (network?.phase === 'degraded') return { label: 'Indexer retrying', tone: 'error' }
	if (waitingForStart) return { label: `Waiting for start block #${network.start_block}`, tone: 'pending' }
	if (network?.indexed_block === null) return { label: 'Indexer starting', tone: 'pending' }
	if (network?.phase === 'backfilling') return { label: `Backfilling #${network.indexed_block}`, tone: 'pending' }
	if (streamState === 'open') return { label: 'Live connection', tone: 'live' }
	if (network !== undefined) return { label: 'Reconnecting', tone: 'error' }
	return { label: 'Connecting', tone: 'pending' }
}

const decimalBlock = (value) => {
	const text = String(value)
	return /^\d+$/.test(text) ? BigInt(text) : undefined
}

export const indexerWaitingForStart = (network) => {
	if (network === undefined || (network.indexed_block !== null && network.indexed_block !== undefined)) return false
	const startBlock = decimalBlock(network.start_block)
	const observedBlock = decimalBlock(network.observed_block)
	return startBlock !== undefined && observedBlock !== undefined && observedBlock < startBlock
}

export const indexerLagLabel = (network) => {
	const observedBlock = decimalBlock(network.observed_block)
	if (observedBlock === undefined) return 'head unknown'
	if (indexerWaitingForStart(network)) return `head #${network.observed_block} · starts at #${network.start_block}`
	const indexedBlock = decimalBlock(network.indexed_block)
	if (indexedBlock === undefined) return `head #${network.observed_block} · awaiting first indexed block`
	const lag = observedBlock > indexedBlock ? observedBlock - indexedBlock : 0n
	return `${lag.toLocaleString('en-US')} ${lag === 1n ? 'block' : 'blocks'} behind`
}

export const compactIndexerDuration = (seconds) => {
	const rounded = Math.max(1, Math.ceil(seconds))
	if (rounded < 60) return `${rounded}s`
	if (rounded < 3_600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`
	const totalHours = Math.ceil(rounded / 3_600)
	if (totalHours < 24) {
		const totalMinutes = Math.ceil(rounded / 60)
		const minutes = totalMinutes % 60
		return `${Math.floor(totalMinutes / 60)}h${minutes === 0 ? '' : ` ${minutes}m`}`
	}
	const hours = totalHours % 24
	return `${Math.floor(totalHours / 24)}d${hours === 0 ? '' : ` ${hours}h`}`
}

export const indexerProgressEstimate = (network, previousSample, sampledAt = Date.now()) => {
	if (network.start_block === null || network.start_block === undefined || network.observed_block === null || network.observed_block === undefined)
		return { percentage: undefined, eta: 'Estimating ETA' }
	const startBlock = Number(network.start_block)
	const observedBlock = Number(network.observed_block)
	const indexedBlock = network.indexed_block === null || network.indexed_block === undefined ? startBlock - 1 : Number(network.indexed_block)
	if (![startBlock, indexedBlock, observedBlock].every(Number.isSafeInteger)) return { percentage: undefined, eta: 'Estimating ETA' }
	const exactStartBlock = decimalBlock(network.start_block)
	const exactObservedBlock = decimalBlock(network.observed_block)
	const exactIndexedBlock =
		network.indexed_block === null || network.indexed_block === undefined
			? exactStartBlock === undefined
				? undefined
				: exactStartBlock - 1n
			: decimalBlock(network.indexed_block)
	if (exactStartBlock === undefined || exactObservedBlock === undefined || exactIndexedBlock === undefined)
		return { percentage: undefined, eta: 'Estimating ETA' }
	if (exactObservedBlock < exactStartBlock) return { percentage: '100.00', eta: 'Caught up' }
	const boundedHead = observedBlock
	const boundedIndexed = Math.min(boundedHead, Math.max(startBlock - 1, indexedBlock))
	const completedBlocks = boundedIndexed - startBlock + 1
	const totalBlocks = boundedHead - startBlock + 1
	const remainingBlocks = totalBlocks - completedBlocks
	const exactBoundedIndexed =
		exactIndexedBlock > exactObservedBlock ? exactObservedBlock : exactIndexedBlock < exactStartBlock ? exactStartBlock - 1n : exactIndexedBlock
	const exactCompletedBlocks = exactBoundedIndexed - exactStartBlock + 1n
	const exactTotalBlocks = exactObservedBlock - exactStartBlock + 1n
	const roundedHundredths = (exactCompletedBlocks * 10_000n + exactTotalBlocks / 2n) / exactTotalBlocks
	const hundredths = remainingBlocks > 0 && roundedHundredths >= 10_000n ? 9_999n : roundedHundredths
	const percentage = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`
	if (remainingBlocks === 0) return { percentage: '100.00', eta: 'Caught up' }
	let blocksPerSecond = previousSample?.blocksPerSecond
	if (previousSample !== undefined && boundedIndexed > previousSample.indexedBlock && sampledAt - previousSample.sampledAt >= 1_000) {
		const observedRate = (boundedIndexed - previousSample.indexedBlock) / ((sampledAt - previousSample.sampledAt) / 1_000)
		blocksPerSecond = blocksPerSecond === undefined ? observedRate : blocksPerSecond * 0.7 + observedRate * 0.3
	}
	const sample =
		previousSample !== undefined && boundedIndexed === previousSample.indexedBlock
			? previousSample
			: {
					indexedBlock: boundedIndexed,
					sampledAt,
					blocksPerSecond: boundedIndexed < (previousSample?.indexedBlock ?? boundedIndexed) ? undefined : blocksPerSecond,
				}
	return {
		percentage,
		eta: blocksPerSecond === undefined ? 'Estimating ETA' : `ETA ${compactIndexerDuration(remainingBlocks / blocksPerSecond)}`,
		sample,
	}
}

export const contractDeploymentStatus = (contract) => {
	if (contract.deployment_block !== null && contract.deployment_block !== undefined)
		return contract.deployment_block_exact === false
			? { label: `Deployed by #${contract.deployment_block}`, tone: 'live' }
			: { label: 'Deployed', tone: 'live' }
	if (contract.deployment_checked_block !== null && contract.deployment_checked_block !== undefined)
		return { label: `Not deployed at #${contract.deployment_checked_block}`, tone: 'error' }
	return { label: 'Checking deployment', tone: 'pending' }
}

export const contractDeploymentTimestampLabel = (contract) => (contract.deployment_block_exact === false ? 'Code present by' : 'Deployed at')

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
