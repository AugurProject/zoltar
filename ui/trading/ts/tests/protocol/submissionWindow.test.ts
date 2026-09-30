import { describe, expect, test } from 'bun:test'
import { submissionWindowBlocker } from '../../protocol/submissionWindow.js'

describe('bounded Trading submission window', () => {
	test('requires more than60seconds before question close for swaps and deposits', () => {
		for (const operation of ['entry', 'exit', 'initialize', 'add'] as const) {
			for (const remaining of [1n, 60n, 61n]) expect(submissionWindowBlocker({ endTime: 100n + remaining, oracleValidUntilTimestamp: 1000n }, operation, 100n) === undefined).toBe(remaining > 60n)
		}
	})
	test('requires oracle time for minting, while sales and removals do not depend on it', () => {
		for (const operation of ['entry', 'initialize', 'add'] as const) {
			for (const remaining of [1n, 60n, 61n]) expect(submissionWindowBlocker({ endTime: 1000n, oracleValidUntilTimestamp: 100n + remaining }, operation, 100n) === undefined).toBe(remaining > 60n)
			expect(submissionWindowBlocker({ endTime: 1000n }, operation, 100n)).toContain('unavailable')
		}
		expect(submissionWindowBlocker({ endTime: 1000n }, 'exit', 100n)).toBeUndefined()
		expect(submissionWindowBlocker({ endTime: 0n }, 'remove', undefined)).toBeUndefined()
	})
	test('fails closed for unknown question or current timing', () => {
		expect(submissionWindowBlocker({ endTime: 0n }, 'exit', 100n)).toContain('unavailable')
		expect(submissionWindowBlocker({ endTime: 1000n }, 'exit', undefined)).toContain('unavailable')
	})
})
