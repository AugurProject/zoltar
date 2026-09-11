import { describe, expect, test } from 'bun:test'
import { advanceCursorAfterSuccessfulHead, cursorForHeadScan, finalityAnchorRequiresReset, operatorStatusAfterPause, withFinalityAnchor } from '@zoltar/bot-shared/monitoring/block-sync'

// A synchronized cursor is only produced after downstream work succeeds; this mirrors that transition for fixtures.
function advanceCursor(head: bigint, headHash: string) {
	return advanceCursorAfterSuccessfulHead(head, headHash, async () => {})
}

describe('block-driven synchronization', () => {
	test('rescans the overlap when a same-height head is replaced', async () => {
		const synced = await advanceCursor(100n, '0x100a')
		expect(cursorForHeadScan(synced, 100n, '0x100a', 12n)).toBeUndefined()
		expect(cursorForHeadScan(synced, 100n, '0x100b', 12n)?.nextBlock).toBe(89n)
		expect(cursorForHeadScan(synced, 80n, '0x80b', 12n)?.nextBlock).toBe(69n)
	})

	test('does not claim to be running when resuming before initial synchronization', () => {
		expect(operatorStatusAfterPause(true, false, false)).toBe('paused')
		expect(operatorStatusAfterPause(false, false, false)).toBe('syncing')
		expect(operatorStatusAfterPause(false, true, false)).toBe('running')
		expect(operatorStatusAfterPause(false, true, true)).toBe('error')
	})

	test('advances a head only after all downstream work succeeds', async () => {
		await expect(
			advanceCursorAfterSuccessfulHead(100n, '0x100', async () => {
				throw new Error('downstream market failure')
			}),
		).rejects.toThrow('downstream market failure')
		const cursor = await advanceCursorAfterSuccessfulHead(100n, '0x100', async () => {})
		expect(cursor).toEqual({ finalityAnchorHash: undefined, finalityAnchorNumber: undefined, initial: false, lastHeadHash: '0x100', lastHeadNumber: 100n, nextBlock: 101n })
	})

	test('fails closed when a reorganization changes the retained finality anchor', async () => {
		const cursor = withFinalityAnchor(await advanceCursor(100n, '0x100'), 88n, '0x88a')
		expect(finalityAnchorRequiresReset(cursor, 100n, '0x88a')).toBe(false)
		expect(finalityAnchorRequiresReset(cursor, 100n, '0x88b')).toBe(true)
		expect(finalityAnchorRequiresReset(cursor, 80n, undefined)).toBe(true)
	})
})
