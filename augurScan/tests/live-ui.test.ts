import { expect, test } from 'bun:test'
import { requiredElementRole } from '../browser/dom-elements.ts'
import {
	accountStateDuringStagedRefresh,
	activityRefreshRetention,
	canonicalPageLimit,
	classifyLiveRecords,
	collectCanonicalPages,
	compactIndexerDuration,
	compareCanonicalEventPosition,
	contractDeploymentBlockActionLabel,
	contractDeploymentStatus,
	contractDeploymentTimestampLabel,
	createForegroundRefreshGate,
	createLatestRefreshCoordinator,
	createLiveRouteRefreshCoordinator,
	indexerConnectionStatus,
	indexerHeadFreshness,
	indexerHeadFreshnessTransitionDelay,
	indexerLagLabel,
	indexerProgressEstimate,
	isCurrentCanonicalGeneration,
	isCurrentContextRequest,
	isCurrentLiveRequest,
	isNoncanonicalDetailFailure,
	mergeUniqueRecords,
	operationsCatalogRecordKey,
	paginatedSnapshotWasReplaced,
	paginationRequestAllowed,
	queuedPaginationPresentation,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	refreshPresentation,
	resolveActivityRefreshDepth,
	retainedPaginationAvailable,
	runWithForegroundReservation,
	shouldClearPendingDetailState,
	shouldContinueTransactionRestore,
	transactionRetryMode,
} from '../browser/live-update.ts'

test('retains every distinct catalog record across a delayed 251-record live refresh', async () => {
	const first = Array.from({ length: 100 }, (_, index) => ({ auction_address: `0x${index.toString(16).padStart(40, '0')}` }))
	const second = Array.from({ length: 100 }, (_, index) => ({ auction_address: `0x${(index + 100).toString(16).padStart(40, '0')}` }))
	const third = Array.from({ length: 51 }, (_, index) => ({ auction_address: `0x${(index + 200).toString(16).padStart(40, '0')}` }))
	const key = (item: Readonly<Record<string, unknown>>) => operationsCatalogRecordKey('auctions', item)
	const pages = [first, second, third]
	const requestedLimits: number[] = []
	const snapshot = await collectCanonicalPages<Readonly<Record<string, unknown>>, number>(
		async (cursor = 0, limit = 100) => {
			await Promise.resolve()
			requestedLimits.push(limit)
			const items = pages[cursor]
			if (items === undefined) throw new Error(`Unexpected catalog page ${cursor}`)
			return { items, ...(cursor + 1 < pages.length ? { nextCursor: cursor + 1 } : {}) }
		},
		251,
		key,
	)
	expect(requestedLimits).toEqual([100, 100, 51])
	expect(snapshot.items).toHaveLength(251)
	expect(new Set(snapshot.items.map(key)).size).toBe(251)
	expect(snapshot.nextCursor).toBeUndefined()
})

test('orders lifecycle evidence by canonical block, transaction, and log position', () => {
	const consumed = { event_name: 'LiquidationApprovalConsumed', block_number: '23184712', transaction_index: 0, log_index: 0 }
	const released = { event_name: 'LiquidationApprovalReleased', block_number: '23184711', transaction_index: 2, tx_hash: '0x01', log_index: 2 }
	const reserved = { event_name: 'LiquidationApprovalReserved', block_number: '23184711', transaction_index: 1, tx_hash: '0xff', log_index: 3 }
	expect([consumed, released, reserved].sort(compareCanonicalEventPosition).map((event) => event.event_name)).toEqual([
		'LiquidationApprovalReserved',
		'LiquidationApprovalReleased',
		'LiquidationApprovalConsumed',
	])
})

const unexpectedCall = (): never => {
	throw new Error('Expected asynchronous test callback to be assigned')
}

const take = <T>(items: T[]): T => {
	const item = items.shift()
	if (item === undefined) throw new Error('Expected a queued test callback')
	return item
}

test('does not misclassify status elements whose ids contain button-like words', () => {
	expect(requiredElementRole('#activity-more-status')).toBe('element')
	expect(requiredElementRole('#more')).toBe('button')
	expect(requiredElementRole('#detail-canonical-retry')).toBe('button')
})

test('keeps background refreshes silent while retaining explicit loading feedback', () => {
	expect(refreshPresentation({ live: true, append: false })).toEqual({ busy: false, loadingState: false })
	expect(refreshPresentation({ live: false, append: false })).toEqual({ busy: true, loadingState: true })
	expect(refreshPresentation({ live: false, append: true })).toEqual({ busy: true, loadingState: true })
})

test('retains multi-page activity for forced noncanonical refreshes such as persisted page restoration', () => {
	expect(activityRefreshRetention(false, undefined, 220)).toEqual({ replaceDepth: 220, retainVisibleDepth: true })
	expect(activityRefreshRetention(true, 220, 100)).toEqual({ replaceDepth: 220, retainVisibleDepth: true })
	expect(activityRefreshRetention(false, undefined, 0)).toEqual({ replaceDepth: undefined, retainVisibleDepth: true })
})

test('resolves activity refresh depth after queued pagination settles', async () => {
	const gate = createForegroundRefreshGate()
	let releasePagination: () => void = unexpectedCall
	let visibleDepth = 100
	const pagination = gate.runForeground(
		() =>
			new Promise<void>((resolve) => {
				releasePagination = () => {
					visibleDepth = 200
					resolve()
				}
			}),
	)
	const captured = activityRefreshRetention(true, 100, visibleDepth)
	const refresh = gate.runBackground(async () => resolveActivityRefreshDepth(captured.replaceDepth, 100, visibleDepth))
	releasePagination()
	await pagination
	expect(await refresh).toBe(200)
})

test('keeps known pagination available after ordinary refresh failures but not canonical invalidation', () => {
	expect(retainedPaginationAvailable(true, false)).toBe(true)
	expect(retainedPaginationAvailable(false, false)).toBe(false)
	expect(retainedPaginationAvailable(true, true)).toBe(false)
})

test('rejects activity and rich-list pagination queued during canonical recovery', async () => {
	for (const surface of ['activity', 'rich list']) {
		const gate = createForegroundRefreshGate()
		let releaseRefresh: () => void = unexpectedCall
		let canonicalRefreshRequired = false
		let appendRequests = 0
		const refresh = gate.runBackground(
			() =>
				new Promise<boolean>((resolve) => {
					canonicalRefreshRequired = true
					releaseRefresh = () => resolve(false)
				}),
		)
		const append = gate.runForeground(async () => {
			if (!paginationRequestAllowed(true, canonicalRefreshRequired)) return false
			appendRequests++
			return true
		})
		releaseRefresh()
		expect(await refresh, surface).toBe(false)
		expect(await append, surface).toBe(false)
		expect(appendRequests, surface).toBe(0)
		expect(retainedPaginationAvailable(true, canonicalRefreshRequired), surface).toBe(false)
	}
})

test('shows local pagination feedback before activity and rich-list work enters a busy gate', async () => {
	for (const surface of ['activity', 'rich list']) {
		const gate = createForegroundRefreshGate()
		let releaseRefresh: () => void = unexpectedCall
		const refresh = gate.runBackground(
			() =>
				new Promise<void>((resolve) => {
					releaseRefresh = resolve
				}),
		)
		const presentation = queuedPaginationPresentation(false)
		const append = gate.runForeground(async () => true)
		expect(presentation, surface).toEqual({ hidden: false, disabled: true, busy: true, label: 'Loading more…' })
		releaseRefresh()
		await refresh
		expect(await append, surface).toBe(true)
	}
	expect(queuedPaginationPresentation(true)).toEqual({ hidden: true, disabled: true, busy: false, label: 'Show more' })
})

test('drops in-flight activity, account, and rich-list appends from an older canonical generation', async () => {
	for (const surface of ['activity', 'account', 'rich list']) {
		let canonicalGeneration = 4
		const requestGeneration = canonicalGeneration
		const retained = [`${surface} retained`]
		let resolveRequest: (items: string[]) => void = unexpectedCall
		const response = new Promise<string[]>((resolve) => {
			resolveRequest = resolve
		})
		const append = (async () => {
			const items = await response
			if (!isCurrentCanonicalGeneration(requestGeneration, canonicalGeneration)) return false
			retained.push(...items)
			return true
		})()
		canonicalGeneration++
		resolveRequest([`${surface} stale`])
		expect(await append, surface).toBe(false)
		expect(retained, surface).toEqual([`${surface} retained`])
	}
})

test('drops a multi-page canonical snapshot when a newer invalidation arrives', async () => {
	let canonicalGeneration = 8
	const requestGeneration = canonicalGeneration
	const retained = [{ id: 'retained' }]
	let resolveFirstPage: (page: { items: Array<{ id: string }>; nextCursor?: string }) => void = unexpectedCall
	const firstPage = new Promise<{ items: Array<{ id: string }>; nextCursor?: string }>((resolve) => {
		resolveFirstPage = resolve
	})
	const refresh = (async () => {
		const snapshot = await collectCanonicalPages(
			async (cursor) => (cursor === undefined ? await firstPage : { items: [{ id: 'stale-2' }], nextCursor: undefined }),
			2,
			(item) => item.id,
		)
		if (!isCurrentCanonicalGeneration(requestGeneration, canonicalGeneration)) return false
		retained.splice(0, retained.length, ...snapshot.items)
		return true
	})()
	canonicalGeneration += 2
	resolveFirstPage({ items: [{ id: 'stale-1' }], nextCursor: 'page-2' })
	expect(await refresh).toBe(false)
	expect(retained).toEqual([{ id: 'retained' }])
})

test('retries transaction append failures from the retained cursor', () => {
	expect(transactionRetryMode(true, true)).toEqual({ append: true, liveRefresh: false })
	expect(transactionRetryMode(false, true)).toEqual({ append: false, liveRefresh: true })
	expect(transactionRetryMode(false, false)).toEqual({ append: false, liveRefresh: false })
})

test('keeps committed account depth authoritative while a refresh snapshot is staged', () => {
	const committed = { loaded: Array.from({ length: 83 }, (_, index) => index) }
	const staged = { loaded: [] }
	expect(accountStateDuringStagedRefresh(committed, staged, true)).toBe(committed)
	expect(accountStateDuringStagedRefresh(committed, staged, false)).toBe(staged)
})

test('defers background refreshes until an explicit log load settles', async () => {
	const gate = createForegroundRefreshGate()
	let releaseForeground: () => void = unexpectedCall
	const calls: string[] = []
	const foreground = gate.runForeground(
		() =>
			new Promise<void>((resolve) => {
				calls.push('foreground')
				releaseForeground = resolve
			}),
	)
	const background = gate.runBackground(async () => {
		calls.push('background')
		return true
	})
	expect(calls).toEqual(['foreground'])
	releaseForeground()
	await foreground
	expect(await background).toBe(true)
	expect(calls).toEqual(['foreground', 'background'])
})

test('queues foreground pagination behind an active background refresh', async () => {
	const gate = createForegroundRefreshGate()
	let releaseBackground: () => void = unexpectedCall
	const calls: string[] = []
	const background = gate.runBackground(
		() =>
			new Promise<void>((resolve) => {
				calls.push('background')
				releaseBackground = resolve
			}),
	)
	const foreground = gate.runForeground(async () => {
		calls.push('foreground')
		return 'page appended'
	})
	expect(calls).toEqual(['background'])
	releaseBackground()
	await background
	expect(await foreground).toBe('page appended')
	expect(calls).toEqual(['background', 'foreground'])
})

test('drops queued detail work after its lifecycle context is invalidated', async () => {
	const gate = createForegroundRefreshGate()
	let release: () => void = unexpectedCall
	let context = 2
	const active = gate.runForeground(
		() =>
			new Promise<void>((resolve) => {
				release = resolve
			}),
	)
	const capturedContext = context
	let committed = false
	const queued = gate.runForeground(async () => {
		if (!isCurrentContextRequest(capturedContext, context, 1, 1)) return false
		committed = true
		return true
	})
	context++
	release()
	await active
	expect(await queued).toBe(false)
	expect(committed).toBe(false)
})

test('reserves a pagination gate while refresh state is captured', async () => {
	const gate = createForegroundRefreshGate()
	const calls: string[] = []
	const reservation = gate.reserve()
	await reservation.ready
	const pagination = gate.runForeground(async () => {
		calls.push('pagination')
	})
	await Promise.resolve()
	expect(calls).toEqual([])
	reservation.release()
	await reservation.completed
	await pagination
	expect(calls).toEqual(['pagination'])
})

test('commits a staged system snapshot only while its detail gate is reserved', async () => {
	const gate = createForegroundRefreshGate()
	let releaseOldDetail: () => void = unexpectedCall
	const calls: string[] = []
	const oldDetail = gate.runForeground(
		() =>
			new Promise<void>((resolve) => {
				calls.push('old detail')
				releaseOldDetail = resolve
			}),
	)
	const refresh = runWithForegroundReservation(gate, async () => {
		calls.push('atomic catalog and detail commit')
		return true
	})
	const nextDetail = gate.runForeground(async () => {
		calls.push('next detail')
	})
	await Promise.resolve()
	expect(calls).toEqual(['old detail'])
	releaseOldDetail()
	await oldDetail
	expect(await refresh).toBe(true)
	await nextDetail
	expect(calls).toEqual(['old detail', 'atomic catalog and detail commit', 'next detail'])
})

test('collects a canonical snapshot to the prior visible depth without retaining missing records', async () => {
	const pages = new Map<string | undefined, { items: Array<{ id: string }>; nextCursor?: string }>([
		[undefined, { items: [{ id: 'new' }, { id: 'kept-3' }], nextCursor: 'page-2' }],
		['page-2', { items: [{ id: 'kept-2' }, { id: 'kept-1' }], nextCursor: 'page-3' }],
		['page-3', { items: [{ id: 'older' }], nextCursor: undefined }],
	])
	const requested: Array<string | undefined> = []
	const snapshot = await collectCanonicalPages(
		async (cursor) => {
			requested.push(cursor)
			const page = pages.get(cursor)
			if (page === undefined) throw new Error(`Unexpected page cursor ${cursor}`)
			return page
		},
		4,
		(item) => String(item.id),
	)
	expect(requested).toEqual([undefined, 'page-2'])
	expect(snapshot).toEqual({ items: [{ id: 'new' }, { id: 'kept-3' }, { id: 'kept-2' }, { id: 'kept-1' }], nextCursor: 'page-3' })
	expect(snapshot.items.some((item) => item.id === 'orphaned')).toBe(false)
})

test('requests only the remaining canonical depth on a partial final page', async () => {
	const requestedLimits: number[] = []
	const snapshot = await collectCanonicalPages<{ id: number }, number>(
		async (cursor, limit) => {
			const pageLimit = limit ?? 100
			requestedLimits.push(pageLimit)
			const offset = cursor ?? 0
			const items = Array.from({ length: pageLimit }, (_, index) => ({ id: offset + index }))
			return { items, nextCursor: offset + pageLimit }
		},
		150,
		(item) => String(item.id),
	)
	expect(requestedLimits).toEqual([100, 50])
	expect(snapshot.items).toHaveLength(150)
	expect(snapshot.nextCursor).toBe(150)
	expect(canonicalPageLimit(83, 0, 50)).toBe(50)
	expect(canonicalPageLimit(83, 50, 50)).toBe(33)
})

test('keeps every log reachable when a live burst exceeds the first refreshed page', async () => {
	const current = Array.from({ length: 350 }, (_, index) => ({ id: index }))
	const requestedLimits: number[] = []
	const retention = activityRefreshRetention(false, undefined, 220)
	const refreshed = await collectCanonicalPages<{ id: number }, number>(
		async (cursor = 0, limit = 100) => {
			requestedLimits.push(limit)
			const items = current.slice(cursor, cursor + limit)
			const nextCursor = cursor + items.length < current.length ? cursor + items.length : undefined
			return { items, nextCursor }
		},
		retention.replaceDepth ?? 0,
		(item) => String(item.id),
	)
	const appended = current.slice(refreshed.nextCursor ?? current.length)
	expect(requestedLimits).toEqual([100, 100, 20])
	expect(refreshed.nextCursor).toBe(220)
	expect([...refreshed.items, ...appended].map((item) => item.id)).toEqual(current.map((item) => item.id))
})

test('distinguishes indexer startup and backfill progress from stream connectivity', () => {
	expect(indexerConnectionStatus(undefined, 'connecting', false)).toEqual({ label: 'Connecting', tone: 'pending' })
	expect(indexerConnectionStatus({ indexed_block: null, phase: 'backfilling' }, 'open', false)).toEqual({ label: 'Indexer starting', tone: 'pending' })
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'backfilling' }, 'open', false)).toEqual({ label: 'Backfilling #42', tone: 'pending' })
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'degraded' }, 'open', false)).toEqual({ label: 'Indexer retrying', tone: 'error' })
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'live' }, 'open', false)).toEqual({ label: 'Live connection', tone: 'live' })
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'live' }, 'connecting', false)).toEqual({ label: 'Reconnecting', tone: 'error' })
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'backfilling' }, 'connecting', false, true)).toEqual({
		label: 'Backfill #42 · Reconnecting',
		tone: 'error',
	})
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'degraded' }, 'closed', false, true)).toEqual({
		label: 'Indexer retrying · Reconnecting',
		tone: 'error',
	})
	expect(indexerConnectionStatus({ indexed_block: '42', phase: 'live' }, 'open', true)).toEqual({ label: 'Status unavailable', tone: 'error' })
	expect(indexerConnectionStatus({ start_block: '100', indexed_block: null, observed_block: '99', phase: 'live' }, 'open', false)).toEqual({
		label: 'Waiting for start block #100',
		tone: 'pending',
	})
	expect(indexerLagLabel({ start_block: '100', indexed_block: null, observed_block: '99' })).toBe('head #99 · starts at #100')
	expect(indexerLagLabel({ start_block: '100', indexed_block: null, observed_block: '100' })).toBe('head #100 · awaiting first indexed block')
})

test('calculates bounded indexer completion and estimates remaining time from observed throughput', () => {
	expect(compactIndexerDuration(3_600)).toBe('1h')
	expect(compactIndexerDuration(86_400)).toBe('1d')
	expect(compactIndexerDuration(172_800)).toBe('2d')
	expect(indexerProgressEstimate({ start_block: '0', indexed_block: '99998', observed_block: '99999', phase: 'backfilling' }).percentage).toBe('99.99')
	expect(indexerProgressEstimate({ start_block: '1', indexed_block: '107', observed_block: '4000', phase: 'backfilling' }).percentage).toBe('2.68')
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: null, observed_block: null, phase: 'backfilling' })).toEqual({
		percentage: undefined,
		eta: 'Estimating ETA',
	})
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: null, observed_block: '100', phase: 'backfilling' }, undefined, 1_000)).toEqual({
		percentage: '0.00',
		eta: 'Estimating ETA',
		sample: { indexedBlock: 99, sampledAt: 1_000, blocksPerSecond: undefined },
	})
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: null, observed_block: '99', phase: 'live' })).toEqual({
		percentage: '100.00',
		eta: 'Caught up',
	})
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: '549', observed_block: '999', phase: 'backfilling' }, undefined, 1_000)).toEqual({
		percentage: '50.00',
		eta: 'Estimating ETA',
		sample: { indexedBlock: 549, sampledAt: 1_000, blocksPerSecond: undefined },
	})
	expect(
		indexerProgressEstimate(
			{ start_block: '100', indexed_block: '549', observed_block: '999', phase: 'backfilling' },
			{ indexedBlock: 449, sampledAt: 1_000, blocksPerSecond: undefined },
			11_000,
		),
	).toEqual({ percentage: '50.00', eta: 'ETA 45s', sample: { indexedBlock: 549, sampledAt: 11_000, blocksPerSecond: 10 } })
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: '1000', observed_block: '1000', phase: 'live' })).toEqual({
		percentage: '100.00',
		eta: 'Caught up',
	})
	expect(
		indexerProgressEstimate(
			{ start_block: '100', indexed_block: '1000', observed_block: '1000', indexed_timestamp: '2026-08-17T11:58:59.000Z', phase: 'live' },
			undefined,
			Date.parse('2026-08-17T12:00:00.000Z'),
		),
	).toEqual({ percentage: '100.00', eta: 'RPC head stale' })
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: '999', observed_block: '1000', phase: 'live' }, undefined, 1_000)).toEqual({
		percentage: '99.89',
		eta: 'Estimating ETA',
		sample: { indexedBlock: 999, sampledAt: 1_000, blocksPerSecond: undefined },
	})
})

test('warns when a caught-up chain head is more than one minute old', () => {
	const now = Date.parse('2026-08-17T12:00:00.000Z')
	expect(indexerHeadFreshness({ indexed_block: '42', observed_block: '42', indexed_timestamp: '2026-08-17T11:59:01.000Z', phase: 'live' }, now)).toEqual({
		stale: false,
	})
	expect(indexerHeadFreshness({ indexed_block: '42', observed_block: '42', indexed_timestamp: '2026-08-17T11:59:00.000Z', phase: 'live' }, now)).toEqual({
		stale: false,
	})
	expect(indexerHeadFreshness({ indexed_block: '42', observed_block: '42', indexed_timestamp: '2026-08-17T11:58:59.000Z', phase: 'live' }, now)).toEqual({
		stale: true,
		ageMs: 61_000,
	})
	expect(indexerHeadFreshness({ indexed_block: '41', observed_block: '42', indexed_timestamp: '2026-08-17T11:00:00.000Z', phase: 'live' }, now)).toEqual({
		stale: false,
	})
	expect(indexerHeadFreshness({ indexed_block: '42', observed_block: '42', indexed_timestamp: '2026-08-17T11:00:00.000Z', phase: 'backfilling' }, now)).toEqual(
		{
			stale: false,
		},
	)
	for (const indexedTimestamp of [null, undefined, 'not-a-date']) {
		const network = { indexed_block: '42', observed_block: '42', indexed_timestamp: indexedTimestamp, phase: 'live' }
		expect(indexerHeadFreshness(network, now)).toEqual({ stale: false })
		expect(indexerHeadFreshnessTransitionDelay(network, now)).toBeUndefined()
	}
})

test('schedules the stale-head transition without waiting for another network response', () => {
	const network = { indexed_block: '42', observed_block: '42', indexed_timestamp: '2026-08-17T11:59:01.000Z', phase: 'live' }
	const now = Date.parse('2026-08-17T12:00:00.000Z')
	expect(indexerHeadFreshnessTransitionDelay(network, now)).toBe(1_001)
	expect(indexerHeadFreshness(network, now + 1_000)).toEqual({ stale: false })
	expect(indexerHeadFreshness(network, now + 1_001)).toEqual({ stale: true, ageMs: 60_001 })
	expect(indexerHeadFreshnessTransitionDelay(network, now + 1_001)).toBeUndefined()
	expect(indexerHeadFreshnessTransitionDelay({ ...network, indexed_block: '41' }, now)).toBeUndefined()
	expect(indexerHeadFreshnessTransitionDelay({ ...network, phase: 'backfilling' }, now)).toBeUndefined()
})

test('describes verified, absent, and pending contract deployments', () => {
	expect(contractDeploymentStatus({ deployment_block: '42', deployment_block_exact: true })).toEqual({ label: 'Deployed', tone: 'live' })
	expect(contractDeploymentStatus({ deployment_block: '42', deployment_block_exact: false })).toEqual({ label: 'Deployed at or before #42', tone: 'live' })
	expect(contractDeploymentStatus({ deployment_block: null, deployment_checked_block: '100' })).toEqual({ label: 'No code at #100', tone: 'error' })
	expect(contractDeploymentStatus({ deployment_block: null, deployment_checked_block: null })).toEqual({ label: 'Checking deployment', tone: 'pending' })
	expect(contractDeploymentTimestampLabel({ deployment_block_exact: false })).toBe('Deployed at or before')
	expect(contractDeploymentTimestampLabel({ deployment_block_exact: true })).toBe('Deployed at')
	expect(contractDeploymentBlockActionLabel({ deployment_block_exact: false })).toBe('Open search boundary block ↗')
	expect(contractDeploymentBlockActionLabel({ deployment_block_exact: true })).toBe('Open deployment block ↗')
})

test('classifies appended, changed, and stable live records by canonical key', () => {
	const previous = new Map([
		['stable', 'same'],
		['changed', 'before'],
		['removed', 'orphaned'],
	])
	expect(
		classifyLiveRecords(previous, [
			{ key: 'new', signature: 'first' },
			{ key: 'changed', signature: 'after' },
			{ key: 'stable', signature: 'same' },
		]),
	).toEqual([
		{ key: 'new', signature: 'first', state: 'added' },
		{ key: 'changed', signature: 'after', state: 'changed' },
		{ key: 'stable', signature: 'same', state: 'unchanged' },
	])
})

test('reconciles refreshed and paginated records without duplicating retained history', () => {
	const oldPage = [{ id: 'old-2' }, { id: 'old-1' }]
	const refreshedPage = [{ id: 'new-1' }, { id: 'old-2' }]
	const reconciled = mergeUniqueRecords(refreshedPage, oldPage, (item) => item.id)
	expect(reconciled.map((item) => item.id)).toEqual(['new-1', 'old-2', 'old-1'])
	expect(mergeUniqueRecords(reconciled, [{ id: 'old-1' }, { id: 'older' }], (item) => item.id).map((item) => item.id)).toEqual([
		'new-1',
		'old-2',
		'old-1',
		'older',
	])
})

test('does not lower a live total while consuming a cursor from an older snapshot', () => {
	expect(reconcilePaginatedTotal(85, 84, true)).toBe(85)
	expect(reconcilePaginatedTotal(85, 84, false)).toBe(84)
})

test('detects when pagination points into a replaced snapshot', () => {
	expect(paginatedSnapshotWasReplaced(100, 99)).toBe(true)
	expect(paginatedSnapshotWasReplaced(100, 100)).toBe(false)
})

test('coalesces refresh bursts into one active request and one latest-state follow-up', async () => {
	const releases: Array<(value: boolean) => void> = []
	const calls: Array<{ count: number; force: boolean }> = []
	const requestRefresh = createLatestRefreshCoordinator(
		(count, force) =>
			new Promise<boolean>((resolve) => {
				calls.push({ count, force })
				releases.push(resolve)
			}),
	)
	const first = requestRefresh(1)
	const joined = requestRefresh(2)
	requestRefresh(3, true)
	expect(joined).toBe(first)
	expect(calls).toEqual([{ count: 1, force: false }])
	take(releases)(true)
	await Promise.resolve()
	expect(calls).toEqual([
		{ count: 1, force: false },
		{ count: 5, force: true },
	])
	take(releases)(true)
	expect(await first).toBe(true)
})

test('continues with the newest queued refresh when an in-flight refresh fails', async () => {
	const releases: Array<{ resolve: (value: boolean) => void; reject: (reason?: unknown) => void }> = []
	const calls: Array<{ count: number; force: boolean }> = []
	const requestRefresh = createLatestRefreshCoordinator(
		(count, force) =>
			new Promise<boolean>((resolve, reject) => {
				calls.push({ count, force })
				releases.push({ resolve, reject })
			}),
	)
	const recovery = requestRefresh(1)
	requestRefresh(1, true)
	take(releases).reject(new Error('stale route failed'))
	await Promise.resolve()
	expect(calls).toEqual([
		{ count: 1, force: false },
		{ count: 1, force: true },
	])
	take(releases).resolve(true)
	expect(await recovery).toBe(true)
})

test('serializes a reorg behind an in-flight refresh and uses current recovery state', async () => {
	const releases: Array<(value: boolean) => void> = []
	const calls: Array<{ count: number; force: boolean; recovery?: string }> = []
	let active = 0
	let maximumActive = 0
	let recovery: { id: string } | undefined
	const requestRefresh = createLiveRouteRefreshCoordinator(
		(count, force, currentRecovery) =>
			new Promise<boolean>((resolve) => {
				active++
				maximumActive = Math.max(maximumActive, active)
				calls.push({ count, force, recovery: currentRecovery?.id })
				releases.push((result) => {
					active--
					resolve(result)
				})
			}),
		() => recovery,
	)
	const refresh = requestRefresh(1)
	recovery = { id: 'canonical-reorg' }
	requestRefresh(1, true)
	expect(maximumActive).toBe(1)
	take(releases)(true)
	await Promise.resolve()
	expect(calls).toEqual([
		{ count: 1, force: false, recovery: undefined },
		{ count: 1, force: true, recovery: 'canonical-reorg' },
	])
	expect(maximumActive).toBe(1)
	take(releases)(true)
	expect(await refresh).toBe(true)
})

test('rejects stale live responses by request version and selected network', () => {
	expect(isCurrentLiveRequest(4, 4, '1', '1')).toBe(true)
	expect(isCurrentLiveRequest(3, 4, '1', '1')).toBe(false)
	expect(isCurrentLiveRequest(4, 4, '11155111', '1')).toBe(false)
})

test('rejects queued or active requests after their route context changes', () => {
	expect(isCurrentContextRequest(4, 4, 9, 9)).toBe(true)
	expect(isCurrentContextRequest(3, 4, 9, 9)).toBe(false)
	expect(isCurrentContextRequest(4, 4, 8, 9)).toBe(false)
})

test('only treats a missing log as noncanonical during canonical recovery', () => {
	expect(isNoncanonicalDetailFailure(true, 404)).toBe(true)
	expect(isNoncanonicalDetailFailure(false, 404)).toBe(false)
	expect(isNoncanonicalDetailFailure(true, 503)).toBe(false)
})

test('restores transaction depth and keeps context only for canonical cards', () => {
	const snapshot = {
		loadedCount: 83,
		expandedKeys: ['kept', 'orphaned'],
		anchorKey: 'kept',
		anchorTop: 240,
		focusKey: 'orphaned',
		focusIndex: 2,
		outsideFocus: undefined,
		scrollTop: 700,
	}
	expect(shouldContinueTransactionRestore(true, 50, snapshot.loadedCount, 'next-page')).toBe(true)
	expect(shouldContinueTransactionRestore(true, 83, snapshot.loadedCount, 'next-page')).toBe(false)
	expect(shouldContinueTransactionRestore(false, 50, snapshot.loadedCount, 'next-page')).toBe(false)
	expect(shouldContinueTransactionRestore(true, 50, snapshot.loadedCount, undefined)).toBe(false)
	expect(reconcileTransactionDialogSnapshot(snapshot, new Set(['kept']))).toEqual({
		...snapshot,
		expandedKeys: ['kept'],
		focusKey: undefined,
		focusIndex: -1,
	})
})

test('clears pending detail state for native dismissal unless a programmatic recovery close preserves it', () => {
	expect(shouldClearPendingDetailState(false)).toBe(true)
	expect(shouldClearPendingDetailState(true)).toBe(false)
})
