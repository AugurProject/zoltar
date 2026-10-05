import { describe, expect, test } from 'bun:test'
import { submissionWindowBlocker } from '../../protocol/submissionWindow.js'

describe('bounded Trading submission window', () => {
	test('requires more than 60 seconds before question close for swaps and deposits', () => {
		for (const operation of ['entry', 'exit', 'initialize', 'add'] as const) {
			for (const remaining of [1n, 60n, 61n]) expect(submissionWindowBlocker({ endTime: 100n + remaining }, operation, 100n) === undefined).toBe(remaining > 60n)
		}
	})
	test('does not depend on the oracle price, and removals ignore question timing', () => {
		for (const operation of ['entry', 'exit', 'initialize', 'add'] as const) expect(submissionWindowBlocker({ endTime: 1000n }, operation, 100n)).toBeUndefined()
		expect(submissionWindowBlocker({ endTime: 0n }, 'remove', undefined)).toBeUndefined()
	})
	test('fails closed for unknown question or current timing', () => {
		expect(submissionWindowBlocker({ endTime: 0n }, 'exit', 100n)).toContain('unavailable')
		expect(submissionWindowBlocker({ endTime: 1000n }, 'exit', undefined)).toContain('unavailable')
	})
})
