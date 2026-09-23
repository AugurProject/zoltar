import { expect, test } from 'bun:test'
import { boundBlockTransactions } from '../../src/repositories/block-transaction-limit.ts'

test('reports that a block with 251 transactions has more than its 250 shown rows', () => {
	const records = Array.from({ length: 251 }, (_, index) => ({ hash: `0x${index.toString(16).padStart(64, '0')}` }))
	const bounded = boundBlockTransactions(records)
	expect(bounded.transactions).toHaveLength(250)
	expect(bounded.transactions.at(-1)?.hash).toBe(records[249]?.hash)
	expect(bounded.hasMore).toBe(true)
})
