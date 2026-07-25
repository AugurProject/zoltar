import { describe, expect, test } from 'bun:test'
import { bestSuccessful, pollUntilStopped, replaceOverlap } from './resilience.js'

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
})
