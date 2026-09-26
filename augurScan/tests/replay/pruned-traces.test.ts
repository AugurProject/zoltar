import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { getAddress, toHex, zeroHash } from '../../src/ethereum.ts'
import type { ContractMetadata } from '../../src/types.ts'
import { NetworkIndexer } from '../../src/indexer/block-ingestion.ts'

test('discovers and remembers the trace boundary while continuing log indexing', async () => {
	let floor = 42n
	let transientFailure = false
	const requests: bigint[] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = await request.json()
			expect(body.method).toBe('debug_traceBlockByHash')
			if (transientFailure) return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32603, message: 'temporary database failure' } })
			const number = BigInt(body.params[0])
			requests.push(number)
			return Response.json({ jsonrpc: '2.0', id: body.id, ...(number < floor ? { error: { code: -32603, message: `failed to apply blockhash contract call: database error: Database error: state at block #${number} is pruned` } } : { result: [] }) })
		},
	})
	const database = new ScannerDatabase('postgres://unused')
	const indexer = new NetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: [server.url.href, server.url.href], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
	const block = (number: bigint) => ({ number, hash: toHex(number, { size: 32 }), parentHash: zeroHash, timestamp: 1_700_000_000n, transactions: [] })
	const header = spyOn(indexer, 'getBlockHeader').mockImplementation(async number => block(number))
	const oracle = getAddress('0x1000000000000000000000000000000000000001')
	const sender = getAddress('0x2000000000000000000000000000000000000002')
	const contracts = new Map<string, ContractMetadata>([[oracle.toLowerCase(), { address: oracle, kind: 'openOracle', label: 'Oracle', provenance: 'manifest' }]])
	const scan = async (number: bigint) => {
		const current = block(number)
		const hash = toHex(number + 1000n, { size: 32 })
		const transaction = { blockHash: current.hash, blockNumber: number, from: sender, gas: 100_000n, hash, input: '0x' as const, nonce: 0n, to: oracle, transactionIndex: 0n, value: 0n }
		const log = { address: oracle, blockHash: current.hash, blockNumber: number, transactionHash: hash, transactionIndex: 0n, logIndex: 0n, topics: [zeroHash], data: '0x' as const }
		const transactionRead = spyOn(indexer.client, 'getTransaction').mockResolvedValue(transaction)
		const receiptRead = spyOn(indexer.client, 'getTransactionReceipt').mockResolvedValue({ blockHash: current.hash, blockNumber: number, cumulativeGasUsed: 100_000n, from: sender, gasUsed: 100_000n, logs: [log], status: 'success', to: oracle, transactionHash: hash, transactionIndex: 0n })
		try {
			return await indexer.indexBlock(number, 100n, contracts, new Map(), undefined, { ...current, transactions: [transaction] }, [log], async () => [])
		} finally {
			transactionRead.mockRestore()
			receiptRead.mockRestore()
		}
	}
	try {
		const first = await scan(10n)
		expect(first.block.logs).toHaveLength(1)
		expect(first.block.transactions[0]?.receipt).toMatchObject({ callTraceStatus: 'unavailable-historical-state' })
		expect(requests.filter(number => number === 10n)).toHaveLength(1)
		expect(requests.length).toBeLessThanOrEqual(10)
		requests.length = 0
		const skipped = await scan(11n)
		expect(skipped.block.transactions[0]?.receipt).toMatchObject({ callTraceStatus: 'unavailable-historical-state' })
		await scan(41n)
		expect(requests).toEqual([])
		await scan(42n)
		expect(requests).toEqual([42n])
		floor = 60n
		await scan(43n)
		requests.length = 0
		await scan(59n)
		expect(requests).toEqual([])
		await scan(60n)
		expect(requests).toEqual([60n])
		transientFailure = true
		await expect(scan(61n)).rejects.toMatchObject({ method: 'debug_traceBlockByHash', cause: { message: 'temporary database failure' } })
		transientFailure = false
		const alternative = indexer.providers[1]
		if (alternative === undefined) throw new Error('Missing alternate provider')
		indexer.selectProvider(alternative)
		floor = 10n
		requests.length = 0
		await scan(11n)
		expect(requests).toEqual([11n])
	} finally {
		header.mockRestore()
		server.stop(true)
		await database.close()
	}
})
