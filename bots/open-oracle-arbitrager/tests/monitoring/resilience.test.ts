import { describe, expect, test } from 'bun:test'
import { bestSuccessful, compactFinalityWindow, pollUntilStopped, replaceOverlap, retryDelayMilliseconds } from '#monitoring/resilience'
import { completeSuccessfulPoll, completeUnconfiguredPoll } from '../../src/runtime/operator.ts'

describe('OpenOracle monitor resilience', () => {
	test('keeps a healthy quote when another direction fails', async () => {
		const errors: unknown[] = []
		const best = await bestSuccessful(
			[() => Promise.reject(new Error('unquotable direction')), () => Promise.resolve({ profit: 42n })],
			value => value.profit,
			error => errors.push(error),
		)
		expect(best).toEqual({ profit: 42n })
		expect(errors).toHaveLength(1)
	})

	test('retries a transient poll failure before stopping', async () => {
		let polls = 0
		let waits = 0
		const errors: unknown[] = []
		await pollUntilStopped(
			async () => {
				polls += 1
				if (polls === 1) throw new Error('transient RPC failure')
				return true
			},
			async () => {
				waits += 1
			},
			false,
			error => errors.push(error),
		)
		expect(polls).toBe(2)
		expect(waits).toBe(1)
		expect(errors).toHaveLength(1)
	})

	test('backs off repeated failures and resets after a successful cycle', async () => {
		expect(retryDelayMilliseconds(1_000, 1, () => 0)).toBe(1_000)
		expect(retryDelayMilliseconds(1_000, 4, () => 0)).toBe(8_000)
		expect(retryDelayMilliseconds(60_000, 20, () => 0)).toBe(300_000)
		const waits: number[] = []
		const pollFailureCounts: number[] = []
		let polls = 0
		await pollUntilStopped(
			async consecutiveFailures => {
				pollFailureCounts.push(consecutiveFailures)
				polls += 1
				if (polls <= 2) throw new Error('offline')
				return polls === 4
			},
			async failures => {
				waits.push(failures)
			},
			false,
			() => undefined,
		)
		expect(waits).toEqual([1, 2, 0])
		expect(pollFailureCounts).toEqual([0, 1, 2, 0])
	})

	test('preserves a failed poll retry when its scan is deferred by the signer gate', async () => {
		const pollFailureCounts: number[] = []
		const waits: number[] = []
		let polls = 0
		await pollUntilStopped(
			async consecutiveFailures => {
				pollFailureCounts.push(consecutiveFailures)
				polls += 1
				if (polls === 1) throw new Error('RPC failed')
				if (polls === 2) return 'deferred'
				return true
			},
			async consecutiveFailures => {
				waits.push(consecutiveFailures)
			},
			false,
			() => undefined,
		)
		expect(pollFailureCounts).toEqual([0, 1, 1])
		expect(waits).toEqual([1, 1])
	})

	test('clears retry metadata through every shared successful-poll exit', () => {
		for (const stopAfterPoll of [false, true]) {
			const state: Parameters<typeof completeSuccessfulPoll>[0] = {
				consecutivePollFailures: 4,
				lastError: 'old poll failure',
				lastPollFailureAt: '2026-08-17T12:00:00.000Z',
				lastRetryAt: '2026-08-17T12:00:05.000Z',
				nextRetryAt: '2026-08-17T12:00:10.000Z',
				paused: false,
				retryInProgress: true,
				status: 'error',
			}
			expect(completeSuccessfulPoll(state, 'Risk policy requires operator attention', stopAfterPoll)).toBe(stopAfterPoll)
			expect(state).toEqual({ consecutivePollFailures: 0, lastError: 'Risk policy requires operator attention', lastPollFailureAt: undefined, lastRetryAt: undefined, nextRetryAt: undefined, paused: false, retryInProgress: false, status: 'error' })
		}
	})

	test('clears a recovered retry before returning to unconfigured paused state', () => {
		const state: Parameters<typeof completeUnconfiguredPoll>[0] = {
			consecutivePollFailures: 2,
			lastError: 'old poll failure',
			lastPollFailureAt: '2026-08-17T12:00:00.000Z',
			lastRetryAt: '2026-08-17T12:00:05.000Z',
			nextRetryAt: undefined,
			paused: false,
			retryInProgress: true,
			status: 'error',
		}
		expect(completeUnconfiguredPoll(state)).toBe(false)
		expect(state).toEqual({ consecutivePollFailures: 0, lastError: undefined, lastPollFailureAt: undefined, lastRetryAt: undefined, nextRetryAt: undefined, paused: false, retryInProgress: false, status: 'paused' })
	})

	test('removes orphaned overlap logs before replaying canonical replacements', () => {
		type Log = { block: bigint; index: number; state: string }
		const compare = (left: Log, right: Log) => {
			if (left.block === right.block) return left.index - right.index
			return left.block < right.block ? -1 : 1
		}
		const result = replaceOverlap(
			[
				{ block: 9n, index: 0, state: 'canonical-before-overlap' },
				{ block: 10n, index: 0, state: 'orphaned-submission' },
				{ block: 11n, index: 0, state: 'orphaned-settlement' },
			],
			[{ block: 10n, index: 1, state: 'canonical-dispute' }],
			10n,
			log => log.block,
			compare,
		)
		expect(result).toEqual([
			{ block: 9n, index: 0, state: 'canonical-before-overlap' },
			{ block: 10n, index: 1, state: 'canonical-dispute' },
		])
	})

	test('compacts each report to one finalized anchor plus its complete reorg window', () => {
		const values = [
			{ block: 1n, report: 1n, terminal: false },
			{ block: 50n, report: 1n, terminal: false },
			{ block: 88n, report: 1n, terminal: false, version: 'first-in-block' },
			{ block: 88n, report: 1n, terminal: false, version: 'last-in-block' },
			{ block: 89n, report: 1n, terminal: false },
			{ block: 100n, report: 1n, terminal: false },
			{ block: 80n, report: 2n, terminal: false },
			{ block: 88n, report: 2n, terminal: true },
		]
		expect(
			compactFinalityWindow(
				values,
				100n,
				12n,
				value => value.report,
				value => value.block,
				value => value.terminal,
			),
		).toEqual([
			{ block: 88n, report: 1n, terminal: false, version: 'last-in-block' },
			{ block: 89n, report: 1n, terminal: false },
			{ block: 100n, report: 1n, terminal: false },
		])
	})
})
