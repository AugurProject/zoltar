import { expect, test } from 'bun:test'
import { classifyLiveRecords, mergeUniqueRecords, reconcilePaginatedTotal } from '../public/live-update.js'

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
