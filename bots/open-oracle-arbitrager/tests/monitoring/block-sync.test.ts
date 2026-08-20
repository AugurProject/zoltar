import { describe, expect, test } from 'bun:test'
import { advanceCursor, advanceCursorAfterSuccessfulHead, assertFinalityAnchor, cursorForHeadScan, finalityAnchorMatches, finalityAnchorRequiresReset, initialCursor, operatorStatusAfterPause, scanRanges, withFinalityAnchor } from '#monitoring/block-sync'

describe('block-driven synchronization', () => {
	test('chunks the startup lookback and catches every block', () => {
		const cursor = initialCursor(25_000n, 25_000n)
		expect(scanRanges(cursor, 25_000n, 10_000n)).toEqual([
			{ fromBlock: 0n, toBlock: 9_999n },
			{ fromBlock: 10_000n, toBlock: 19_999n },
			{ fromBlock: 20_000n, toBlock: 25_000n },
		])
	})

	test('does no work until a new head and then scans every missed block', () => {
		const synced = advanceCursor(100n, '0x100a')
		expect(scanRanges(synced, 100n)).toEqual([])
		expect(scanRanges(synced, 103n)).toEqual([{ fromBlock: 101n, toBlock: 103n }])
	})

	test('rescans the overlap when a same-height head is replaced', () => {
		const synced = advanceCursor(100n, '0x100a')
		expect(cursorForHeadScan(synced, 100n, '0x100a', 12n)).toBeUndefined()
		const replacementCursor = cursorForHeadScan(synced, 100n, '0x100b', 12n)
		expect(replacementCursor).toBeDefined()
		expect(scanRanges(replacementCursor ?? synced, 100n)).toEqual([{ fromBlock: 89n, toBlock: 100n }])
		const recedingCursor = cursorForHeadScan(synced, 80n, '0x80b', 12n)
		expect(recedingCursor).toBeDefined()
		expect(scanRanges(recedingCursor ?? synced, 80n)).toEqual([{ fromBlock: 69n, toBlock: 80n }])
	})

	test('does not claim to be running when resuming before initial synchronization', () => {
		expect(operatorStatusAfterPause(true, false, false)).toBe('paused')
		expect(operatorStatusAfterPause(false, false, false)).toBe('syncing')
		expect(operatorStatusAfterPause(false, true, false)).toBe('running')
		expect(operatorStatusAfterPause(false, true, true)).toBe('error')
	})

	test('advances a head only after all downstream work succeeds', async () => {
		let cursor = advanceCursor(99n, '0x99')
		await expect(
			advanceCursorAfterSuccessfulHead(100n, '0x100', async () => {
				throw new Error('downstream market failure')
			}),
		).rejects.toThrow('downstream market failure')
		expect(cursor).toEqual(advanceCursor(99n, '0x99'))
		cursor = await advanceCursorAfterSuccessfulHead(100n, '0x100', async () => {})
		expect(cursor).toEqual(advanceCursor(100n, '0x100'))
	})

	test('fails closed when a reorganization changes the retained finality anchor', () => {
		const cursor = withFinalityAnchor(advanceCursor(100n, '0x100'), 88n, '0x88a')
		expect(finalityAnchorMatches(cursor, 88n, '0x88a')).toBe(true)
		expect(finalityAnchorMatches(cursor, 88n, '0x88b')).toBe(false)
		expect(() => assertFinalityAnchor(cursor, 88n, '0x88a')).not.toThrow()
		expect(() => assertFinalityAnchor(cursor, 88n, '0x88b')).toThrow('deeper than the configured overlap')
		expect(finalityAnchorRequiresReset(cursor, 100n, '0x88a')).toBe(false)
		expect(finalityAnchorRequiresReset(cursor, 100n, '0x88b')).toBe(true)
		expect(finalityAnchorRequiresReset(cursor, 80n, undefined)).toBe(true)
	})
})
