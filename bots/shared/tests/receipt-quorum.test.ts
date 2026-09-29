import { describe, expect, test } from 'bun:test'
import type { Hex, TransactionReceipt } from '../src/ethereum.ts'
import { isReceiptNotFound, observeReceiptWithQuorum, readReceiptOrMissing } from '../src/execution/receipt-quorum.ts'
import { ConnectivityDegradedError } from '../src/monitoring/resilience.ts'

const hash: Hex = `0x${'ab'.repeat(32)}`

function receipt(blockNumber: bigint): TransactionReceipt {
	return {
		blockHash: `0x${'cd'.repeat(32)}`,
		blockNumber,
		contractAddress: undefined,
		cumulativeGasUsed: 21_000n,
		effectiveGasPrice: 1n,
		from: `0x${'11'.repeat(20)}`,
		gasUsed: 21_000n,
		logs: [],
		logsBloom: `0x${'00'.repeat(256)}`,
		status: 'success',
		to: `0x${'22'.repeat(20)}`,
		transactionHash: hash,
		transactionIndex: 0n,
		type: 'eip1559',
	}
}

function notFound() {
	const error = new Error(`Transaction receipt with hash "${hash}" could not be found. The Transaction may not be processed on a chain yet.`)
	error.name = 'TransactionReceiptNotFoundError'
	return error
}

const reader = (lookup: () => Promise<TransactionReceipt>) => ({ getTransactionReceipt: lookup })

describe('receipt quorum', () => {
	test('recognizes every receipt-not-found shape the bots encounter', () => {
		const named = new Error('lookup failed')
		named.name = 'TransactionReceiptNotFoundError'
		expect(isReceiptNotFound(named)).toBe(true)
		expect(isReceiptNotFound(notFound())).toBe(true)
		expect(isReceiptNotFound(new Error('Transaction receipt not found'))).toBe(true)
		expect(isReceiptNotFound(new Error('Transaction with hash "0x01" could not be found.'))).toBe(true)
		expect(isReceiptNotFound(new Error('connection refused'))).toBe(false)
		expect(isReceiptNotFound('could not be found')).toBe(false)
	})

	test('reads a missing receipt as undefined and rethrows other lookup failures', async () => {
		expect(
			await readReceiptOrMissing(
				reader(async () => receipt(1n)),
				hash,
			),
		).toEqual(receipt(1n))
		expect(
			await readReceiptOrMissing(
				reader(async () => Promise.reject(notFound())),
				hash,
			),
		).toBeUndefined()
		await expect(
			readReceiptOrMissing(
				reader(async () => Promise.reject(new Error('connection refused'))),
				hash,
			),
		).rejects.toThrow('connection refused')
	})

	test('requires the quorum to agree on the receipt or on its absence', async () => {
		const found = [
			{ client: reader(async () => receipt(7n)), endpoint: 'first' },
			{ client: reader(async () => receipt(7n)), endpoint: 'second' },
		]
		expect(await observeReceiptWithQuorum(found, hash, 2)).toEqual(receipt(7n))
		const missing = found.map(({ endpoint }) => ({ client: reader(async () => Promise.reject(notFound())), endpoint }))
		expect(await observeReceiptWithQuorum(missing, hash, 2)).toBeUndefined()
		const disagreeing = [found[0], missing[1]].flatMap(entry => (entry === undefined ? [] : [entry]))
		await expect(observeReceiptWithQuorum(disagreeing, hash, 2)).rejects.toThrow('RPC disagreement for receipt')
		const unavailable = [found[0], { client: reader(async () => Promise.reject(new Error('connection refused'))), endpoint: 'second' }].flatMap(entry => (entry === undefined ? [] : [entry]))
		await expect(observeReceiptWithQuorum(unavailable, hash, 2)).rejects.toBeInstanceOf(ConnectivityDegradedError)
	})
})
