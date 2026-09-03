import { expect, test } from 'bun:test'
import { receiptWaitAttemptMilliseconds } from '../../src/execution/transaction-tracker.ts'

test('bounds each receipt wait so shutdown is observed within the grace period', () => {
	expect(receiptWaitAttemptMilliseconds(1_000)).toBe(1_000)
	expect(receiptWaitAttemptMilliseconds(3_600_000)).toBe(5_000)
})
