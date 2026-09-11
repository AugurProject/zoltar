import { describe, expect, test } from 'bun:test'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { assertCanonicalAnchorFreshness } from '../../src/core/canonical-freshness.ts'

describe('canonical anchor freshness', () => {
	test('accepts a recent quorum anchor within the bounded head lag', () => {
		const now = 2_000_000n
		expect(() => assertCanonicalAnchorFreshness([10_000n, 9_950n, 9_949n], 9_950n, now - 12n, Number(now * 1_000n))).not.toThrow()
	})

	test('rejects a stale quorum even when enough RPCs agree', () => {
		expect(() => assertCanonicalAnchorFreshness([10_000n, 1n, 1n], 1n, 2_000_000n, 2_000_000_000)).toThrow(ConnectivityDegradedError)
		expect(() => assertCanonicalAnchorFreshness([10_000n, 1n, 1n], 1n, 2_000_000n, 2_000_000_000)).toThrow('64-block safety limit')
	})

	test('rejects old and implausibly future anchor timestamps', () => {
		const now = 2_000_000n
		expect(() => assertCanonicalAnchorFreshness([100n, 100n], 100n, now - 15n * 60n - 1n, Number(now * 1_000n))).toThrow('seconds old')
		expect(() => assertCanonicalAnchorFreshness([100n, 100n], 100n, now + 2n * 60n + 1n, Number(now * 1_000n))).toThrow('ahead of the operator clock')
	})
})
