import { expect, test } from 'bun:test'
import {
	classifyLiveRecords,
	createLatestRefreshCoordinator,
	createLiveRouteRefreshCoordinator,
	isCurrentLiveRequest,
	isNoncanonicalDetailFailure,
	mergeUniqueRecords,
	reconcilePaginatedTotal,
	reconcileTransactionDialogSnapshot,
	shouldClearPendingDetailState,
	shouldContinueTransactionRestore,
} from '../public/live-update.js'

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
