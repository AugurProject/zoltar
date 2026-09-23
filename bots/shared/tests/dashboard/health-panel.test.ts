import { expect, test } from 'bun:test'
import { snapshotFreshness } from '../../src/dashboard/polling.ts'

test('slow successful scans show their age without marking a current state poll stale', () => {
	const now = Date.parse('2026-09-23T12:00:00.000Z')
	const scan = '2026-09-23T11:45:00.000Z'
	expect(snapshotFreshness(scan, now - 2_000, false, now)).toEqual({ age: '15m ago', stale: false })
	expect(snapshotFreshness(scan, now - 31_000, false, now)).toEqual({ age: '15m ago', stale: true })
	expect(snapshotFreshness(scan, now - 2_000, true, now)).toEqual({ age: '15m ago', stale: true })
	expect(snapshotFreshness(scan, now - 2_000, false, now, 30_000, 90_000)).toEqual({ age: '15m ago', stale: true })
})
