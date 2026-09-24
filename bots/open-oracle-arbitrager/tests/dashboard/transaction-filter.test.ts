import { expect, test } from 'bun:test'
import { transactionMatchesFilter } from '#dashboard/transaction-filter'

test('Failed transaction filter includes reverted and submission failures', () => {
	expect(transactionMatchesFilter('reverted', 'failed')).toBe(true)
	expect(transactionMatchesFilter('submission-failed', 'failed')).toBe(true)
	expect(transactionMatchesFilter('confirmed', 'failed')).toBe(false)
	expect(transactionMatchesFilter('confirmed', 'confirmed')).toBe(true)
})
