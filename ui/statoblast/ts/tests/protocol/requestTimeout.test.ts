import { expect, test } from 'bun:test'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { withStatoblastRequestTimeout } from '@zoltar/ui-statoblast-shared/protocol/requestTimeout.js'

test('an abort releases a single-flight lane without letting the stale request release its replacement', async () => {
	const lane = { pending: false }
	const abort = new AbortController()
	const stale = createDeferred<bigint>()
	const fresh = createDeferred<bigint>()
	const staleRead = withStatoblastRequestTimeout({ getBlockNumber: () => stale.promise }, 'Timed out.', abort.signal, lane)
	const freshRead = withStatoblastRequestTimeout({ getBlockNumber: () => fresh.promise }, 'Timed out.', undefined, lane)
	const first = staleRead.getBlockNumber().catch(error => error)
	await Promise.resolve()
	abort.abort()
	try {
		expect(lane.pending).toBe(false)
		const second = freshRead.getBlockNumber()
		stale.resolve(1n)
		expect(await first).toBe(abort.signal.reason)
		expect(lane.pending).toBe(true)
		fresh.resolve(2n)
		await expect(second).resolves.toBe(2n)
		expect(lane.pending).toBe(false)
	} finally {
		stale.resolve(1n)
		fresh.resolve(2n)
	}
})
