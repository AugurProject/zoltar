import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { getAddress, toHex, zeroHash } from '../../src/ethereum.ts'
import { ChainContinuityError } from '../../src/indexer-runtime.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { getBlockHeader, getFullBlock } from '../../src/indexer/network-provider.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'

test('canonical header reads do not request or expose full transaction data', async () => {
	const requests: unknown[][] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = await request.json()
			expect(body.method).toBe('eth_getBlockByNumber')
			requests.push(body.params)
			return Response.json({ jsonrpc: '2.0', id: body.id, result: { number: '0xa', hash: toHex(10n, { size: 32 }), parentHash: zeroHash, timestamp: '0x1', transactions: [] } })
		},
	})
	const database = new ScannerDatabase('postgres://unused')
	const indexer = createNetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: [server.url.href], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
	try {
		const header = await getBlockHeader(indexer.providers, 10n)
		expect(requests).toEqual([['0xa', false]])
		expect(header.transactions).toBeUndefined()
		expect((await getFullBlock(indexer.providers, 10n)).transactions).toEqual([])
		expect(requests).toEqual([
			['0xa', false],
			['0xa', true],
		])
	} finally {
		server.stop(true)
		await database.close()
	}
})

for (const mode of ['valid', 'missing transaction', 'wrong transaction block', 'missing transaction position', 'wrong receipt block', 'wrong receipt hash', 'wrong receipt position'] as const) {
	test(`reuses full block transactions and checks evidence consistency (${mode})`, async () => {
		const database = new ScannerDatabase('postgres://unused')
		const indexer = createNetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
		indexer.providers.traceUnsupported.add(indexer.providers.active)
		const address = getAddress('0x1000000000000000000000000000000000000001')
		const hash = toHex(10n, { size: 32 })
		const transactionHash = toHex(11n, { size: 32 })
		const transaction = { blockHash: mode === 'wrong transaction block' ? zeroHash : hash, blockNumber: 10n, transactionIndex: mode === 'missing transaction position' ? undefined : 0n, hash: transactionHash, from: address, to: address, gas: 21_000n, nonce: 0n, value: 1n, input: '0x' as const }
		const block = { hash, parentHash: zeroHash, timestamp: 1n, transactions: mode === 'missing transaction' ? [] : [transaction] }
		const log = { address, blockHash: hash, blockNumber: 10n, transactionHash, transactionIndex: 0n, logIndex: 0n, topics: [zeroHash], data: '0x' as const }
		const contracts = new Map([[address.toLowerCase(), { address, kind: 'openOracle', label: 'Oracle', provenance: 'manifest' }]])
		const transactionRead = spyOn(indexer.providers.client, 'getTransaction').mockImplementation(async () => {
			throw new Error('Unexpected transaction fetch')
		})
		const receiptRead = spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({
			blockHash: mode === 'wrong receipt block' ? zeroHash : hash,
			blockNumber: 10n,
			transactionHash: mode === 'wrong receipt hash' ? zeroHash : transactionHash,
			transactionIndex: mode === 'wrong receipt position' ? 1n : 0n,
			from: address,
			to: address,
			cumulativeGasUsed: 21_000n,
			gasUsed: 21_000n,
			logs: [],
			status: 'success',
		})
		try {
			const result = indexBlock(
				indexer,
				10n,
				10n,
				contracts,
				new Map(),
				undefined,
				block,
				mode === 'missing transaction' ? [log] : [],
				async () => [],
				async () => block,
			)
			if (mode === 'valid') {
				expect((await result).block.transactions).toMatchObject([{ hash: transactionHash, value: 1n, transactionIndex: 0 }])
			} else {
				await expect(result).rejects.toThrow(ChainContinuityError)
			}
			expect(transactionRead).not.toHaveBeenCalled()
		} finally {
			transactionRead.mockRestore()
			receiptRead.mockRestore()
			await database.close()
		}
	})
}
