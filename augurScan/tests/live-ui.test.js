import { expect, test } from 'bun:test'
import {
	classifyLiveRecords,
	compactIndexerDuration,
	contractDeploymentStatus,
	contractDeploymentTimestampLabel,
	createLatestRefreshCoordinator,
	createLiveRouteRefreshCoordinator,
	indexerConnectionStatus,
	indexerLagLabel,
	indexerProgressEstimate,
	isCurrentLiveRequest,
	isNoncanonicalDetailFailure,
	mergeUniqueRecords,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	shouldClearPendingDetailState,
	shouldContinueTransactionRestore,
} from '../public/live-update.js'

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
	expect(indexerProgressEstimate({ start_block: '100', indexed_block: '999', observed_block: '1000', phase: 'live' }, undefined, 1_000)).toEqual({
		percentage: '99.89',
		eta: 'Estimating ETA',
		sample: { indexedBlock: 999, sampledAt: 1_000, blocksPerSecond: undefined },
	})
})

test('describes verified, absent, and pending contract deployments', () => {
	expect(contractDeploymentStatus({ deployment_block: '42', deployment_block_exact: true })).toEqual({ label: 'Deployed', tone: 'live' })
	expect(contractDeploymentStatus({ deployment_block: '42', deployment_block_exact: false })).toEqual({ label: 'Deployed by #42', tone: 'live' })
	expect(contractDeploymentStatus({ deployment_block: null, deployment_checked_block: '100' })).toEqual({ label: 'Not deployed at #100', tone: 'error' })
	expect(contractDeploymentStatus({ deployment_block: null, deployment_checked_block: null })).toEqual({ label: 'Checking deployment', tone: 'pending' })
	expect(contractDeploymentTimestampLabel({ deployment_block_exact: false })).toBe('Code present by')
	expect(contractDeploymentTimestampLabel({ deployment_block_exact: true })).toBe('Deployed at')
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

test('coalesces refresh bursts into one active request and one latest-state follow-up', async () => {
	const releases = []
	const calls = []
	const requestRefresh = createLatestRefreshCoordinator(
		(count, force) =>
			new Promise((resolve) => {
				calls.push({ count, force })
				releases.push(resolve)
			}),
	)
	const first = requestRefresh(1)
	const joined = requestRefresh(2)
	requestRefresh(3, true)
	expect(joined).toBe(first)
	expect(calls).toEqual([{ count: 1, force: false }])
	releases.shift()(true)
	await Promise.resolve()
	expect(calls).toEqual([
		{ count: 1, force: false },
		{ count: 5, force: true },
	])
	releases.shift()(true)
	expect(await first).toBe(true)
})

test('continues with the newest queued refresh when an in-flight refresh fails', async () => {
	const releases = []
	const calls = []
	const requestRefresh = createLatestRefreshCoordinator(
		(count, force) =>
			new Promise((resolve, reject) => {
				calls.push({ count, force })
				releases.push({ resolve, reject })
			}),
	)
	const recovery = requestRefresh(1)
	requestRefresh(1, true)
	releases.shift().reject(new Error('stale route failed'))
	await Promise.resolve()
	expect(calls).toEqual([
		{ count: 1, force: false },
		{ count: 1, force: true },
	])
	releases.shift().resolve(true)
	expect(await recovery).toBe(true)
})

test('serializes a reorg behind an in-flight refresh and uses current recovery state', async () => {
	const releases = []
	const calls = []
	let active = 0
	let maximumActive = 0
	let recovery
	const requestRefresh = createLiveRouteRefreshCoordinator(
		(count, force, currentRecovery) =>
			new Promise((resolve) => {
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
	releases.shift()(true)
	await Promise.resolve()
	expect(calls).toEqual([
		{ count: 1, force: false, recovery: undefined },
		{ count: 1, force: true, recovery: 'canonical-reorg' },
	])
	expect(maximumActive).toBe(1)
	releases.shift()(true)
	expect(await refresh).toBe(true)
})

test('rejects stale live responses by request version and selected network', () => {
	expect(isCurrentLiveRequest(4, 4, '1', '1')).toBe(true)
	expect(isCurrentLiveRequest(3, 4, '1', '1')).toBe(false)
	expect(isCurrentLiveRequest(4, 4, '11155111', '1')).toBe(false)
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
