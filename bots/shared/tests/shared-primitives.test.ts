import { describe, expect, test } from 'bun:test'
import { initialCursor, scanRanges } from '../src/monitoring/block-sync.ts'
import { quorumValue } from '../src/monitoring/read-quorum.ts'
import { createSignerOperationGate } from '../src/execution/signer-operation-gate.ts'
import { paddedTransactionGas, prepareSignedTransaction, submitSignedTransaction } from '../src/execution/transaction-submission.ts'
import { parseTransaction, privateKeyToAccount } from '../src/ethereum.ts'

describe('shared bot primitives', () => {
	test('splits a block scan into bounded inclusive ranges', () => {
		const cursor = initialCursor(25n, 25n)
		expect(scanRanges(cursor, 25n, 10n)).toEqual([
			{ fromBlock: 0n, toBlock: 9n },
			{ fromBlock: 10n, toBlock: 19n },
			{ fromBlock: 20n, toBlock: 25n },
		])
	})

	test('requires independent quorum observations to agree', () => {
		expect(
			quorumValue('head', [
				{ endpoint: 'https://one.example', value: { hash: '0x01', number: 1n } },
				{ endpoint: 'https://two.example', value: { hash: '0x01', number: 1n } },
			]),
		).toEqual({ hash: '0x01', number: 1n })
		expect(() =>
			quorumValue('head', [
				{ endpoint: 'https://one.example', value: 1n },
				{ endpoint: 'https://two.example', value: 2n },
			]),
		).toThrow('RPC disagreement')
	})

	test('serializes signer operations', () => {
		const gate = createSignerOperationGate()
		expect(gate.acquire('scan')).toBe(true)
		expect(gate.acquire('deployment')).toBe(false)
		gate.release('scan')
		expect(gate.acquire('deployment')).toBe(true)
	})

	test('preserves ETH value in a prepared signed transaction', async () => {
		const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
		if (account.signTransaction === undefined) throw new Error('Local test account cannot sign')
		const signed = await prepareSignedTransaction({
			baseFeePerGas: 10n,
			blockNumber: 100n,
			chainId: 1,
			data: '0x1234',
			from: account.address,
			gasEstimate: 100_000n,
			nonce: 3n,
			signTransaction: account.signTransaction,
			to: '0x0000000000000000000000000000000000000010',
			value: 42n,
		})
		expect(signed.transaction.value).toBe(42n)
		expect(parseTransaction(signed.serializedTransaction).value).toBe(42n)
		expect(signed.transaction.gas).toBe(paddedTransactionGas(100_000n))
	})

	test('enforces the configured public submission acceptance threshold', async () => {
		await expect(
			submitSignedTransaction({
				address: '0x0000000000000000000000000000000000000001',
				hash: `0x${'11'.repeat(32)}`,
				maxBlockNumber: 100n,
				publicRpcUrls: ['https://one.example', 'https://two.example'],
				publicSubmit: async url => {
					if (url.includes('two')) throw new Error('rejected')
					return `0x${'11'.repeat(32)}`
				},
				serializedTransaction: '0x1234',
				settings: { minimumRelaySuccesses: 2, mode: 'public', relayUrls: [] },
				signMessage: async () => `0x${'22'.repeat(65)}`,
			}),
		).rejects.toThrow('required 2 accepting RPCs')
	})

	test('enforces the configured private relay acceptance threshold', async () => {
		const hash = `0x${'33'.repeat(32)}` as const
		const accepting = Bun.serve({
			port: 0,
			fetch: () => Response.json({ id: 1, jsonrpc: '2.0', result: hash }),
		})
		const rejecting = Bun.serve({
			port: 0,
			fetch: () => Response.json({ error: { code: -32_000, message: 'rejected' }, id: 1, jsonrpc: '2.0' }),
		})
		try {
			if (accepting.port === undefined || rejecting.port === undefined) throw new Error('Test relays did not bind ports')
			await expect(
				submitSignedTransaction({
					address: '0x0000000000000000000000000000000000000001',
					hash,
					maxBlockNumber: 100n,
					publicRpcUrls: [],
					publicSubmit: async () => hash,
					serializedTransaction: '0x1234',
					settings: {
						minimumRelaySuccesses: 2,
						mode: 'private',
						relayUrls: [`http://127.0.0.1:${accepting.port.toString()}`, `http://127.0.0.1:${rejecting.port.toString()}`],
					},
					signMessage: async () => `0x${'22'.repeat(65)}`,
				}),
			).rejects.toThrow('required 2 accepting relays')
		} finally {
			accepting.stop(true)
			rejecting.stop(true)
		}
	})
})
