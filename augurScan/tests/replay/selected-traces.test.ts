import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { getAddress, toHex, zeroHash } from '../../src/ethereum.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'

for (const mode of ['default', 'enabled', 'pruned', 'unsupported', 'transient'] as const) {
	test(`optional traces enrich only log-selected transactions (${mode})`, async () => {
		const requests: string[] = []
		const transactionHash = toHex(11n, { size: 32 })
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = await request.json()
				requests.push(body.method)
				expect(body.method).toBe('debug_traceTransaction')
				expect(body.params[0]).toBe(transactionHash)
				const errors = {
					default: undefined,
					enabled: undefined,
					unsupported: { code: -32601, message: 'method not found' },
					pruned: { code: -32603, message: 'state at block #10 is pruned' },
					transient: { code: -32603, message: 'temporary database failure' },
				}
				const error = errors[mode]
				return Response.json({ jsonrpc: '2.0', id: body.id, ...(error === undefined ? { result: { type: 'CALL', value: '0x1', calls: [{ type: 'CALL', to: '0x2000000000000000000000000000000000000002', value: '0x1' }] } } : { error }) })
			},
		})
		const database = new ScannerDatabase('postgres://unused')
		const indexer = createNetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: [server.url.href], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal, { traceSelectedTransactions: mode !== 'default' })
		const address = getAddress('0x1000000000000000000000000000000000000001')
		const block = { hash: toHex(10n, { size: 32 }), parentHash: zeroHash, timestamp: 1n }
		const transaction = { blockHash: block.hash, blockNumber: 10n, transactionIndex: 0n, hash: transactionHash, from: address, to: address, gas: 21_000n, nonce: 0n, value: 1n, input: '0x' as const }
		const log = { address, blockHash: block.hash, blockNumber: 10n, transactionHash, transactionIndex: 0n, logIndex: 0n, topics: [zeroHash], data: '0x' as const }
		const contracts = new Map([[address.toLowerCase(), { address, kind: 'openOracle', label: 'Oracle', provenance: 'manifest' }]])
		const transactionRead = spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue(transaction)
		const receiptRead = spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ blockHash: block.hash, blockNumber: 10n, transactionHash, transactionIndex: 0n, from: address, to: address, cumulativeGasUsed: 21_000n, gasUsed: 21_000n, logs: [log], status: 'success' })
		const scan = (logs = [log]) =>
			indexBlock(
				indexer,
				10n,
				10n,
				contracts,
				new Map(),
				undefined,
				block,
				logs,
				async () => [],
				async () => block,
			)
		try {
			if (mode === 'transient') await expect(scan()).rejects.toMatchObject({ method: 'debug_traceTransaction' })
			else {
				const result = await scan()
				const expected = { default: 'not-requested', enabled: 'available', pruned: 'unavailable-historical-state', unsupported: 'unavailable' }[mode]
				expect(result.block.transactions).toHaveLength(1)
				expect(result.block.transactions[0]?.receipt).toMatchObject({ selectionSource: 'protocol-log', callTraceStatus: expected })
				if (mode === 'enabled') expect(result.block.transactions[0]?.receipt).toHaveProperty('callTrace.calls')
				if (mode === 'unsupported') {
					await scan()
					expect(requests).toHaveLength(1)
				}
			}
			const count = requests.length
			expect((await scan([])).block.transactions).toEqual([])
			expect(requests).toHaveLength(count)
			if (mode === 'default') expect(requests).toEqual([])
		} finally {
			transactionRead.mockRestore()
			receiptRead.mockRestore()
			server.stop(true)
			await database.close()
		}
	})
}
