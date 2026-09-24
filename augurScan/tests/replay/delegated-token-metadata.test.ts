import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { concatHex, encodeAbiParameters, encodeFunctionData, getAddress, type Hex, toHex, zeroHash } from '../../src/ethereum.ts'
import { abiForKind } from '../../src/abi-catalog.ts'
import { NetworkIndexer } from '../../src/indexer/block-ingestion.ts'
import type { ContractMetadata } from '../../src/types.ts'

const oracle = getAddress('0x1000000000000000000000000000000000000001')
const manager = getAddress('0x2000000000000000000000000000000000000002')
const token = getAddress('0x3000000000000000000000000000000000000003')
const sender = getAddress('0x4000000000000000000000000000000000000004')
const abi = (kind: string) => {
	const value = abiForKind(kind)
	if (value === undefined) throw new Error(`Missing ABI ${kind}`)
	return value
}
const deposit = encodeFunctionData({ abi: abi('openOracle'), functionName: 'deposit', args: [token, 1_500_001n, sender] })
const wrap = (target: typeof oracle, input: Hex) => encodeFunctionData({ abi: abi('delegationManager'), functionName: 'redeemDelegations', args: [['0x'], [zeroHash], [concatHex([target, toHex(0n, { size: 32 }), input])]] })

for (const mode of ['direct', 'registered wrapper', 'unregistered wrapper', 'nested unregistered wrapper'] as const) {
	test(`${mode} discovers unknown deposit token metadata from calldata alone`, async () => {
		const reads: string[] = []
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const body = await request.json()
				if (body.method === 'debug_traceBlockByHash') return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'method not found' } })
				expect(body.method).toBe('eth_call')
				expect(body.params[0].to.toLowerCase()).toBe(token.toLowerCase())
				expect(body.params[1]).toBe('0xa')
				const selector = body.params[0].data
				const field = new Map([
					['0x313ce567', 'decimals'],
					['0x06fdde03', 'name'],
					['0x95d89b41', 'symbol'],
				]).get(selector)
				if (field === undefined) throw new Error(`Unexpected metadata selector ${selector}`)
				reads.push(field)
				const result = field === 'decimals' ? toHex(6n, { size: 32 }) : encodeAbiParameters([{ type: 'string' }], [field === 'name' ? 'Unknown Token' : 'TKN'])
				return Response.json({ jsonrpc: '2.0', id: body.id, result })
			},
		})
		const database = new ScannerDatabase('postgres://unused')
		const indexer = new NetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: [server.url.href], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
		const contracts = new Map<string, ContractMetadata>([[oracle.toLowerCase(), { address: oracle, kind: 'openOracle', label: 'Oracle', provenance: 'manifest' }]])
		if (mode === 'registered wrapper') contracts.set(manager.toLowerCase(), { address: manager, kind: 'delegationManager', label: 'Manager', provenance: 'manifest' })
		let input = deposit
		if (mode !== 'direct') input = wrap(oracle, input)
		if (mode === 'nested unregistered wrapper') input = wrap(manager, input)
		const to = mode === 'direct' ? oracle : manager
		const block = { number: 10n, hash: toHex(10n, { size: 32 }), parentHash: zeroHash, timestamp: 1_700_000_000n, transactions: [] }
		const transactionHash = toHex(1n, { size: 32 })
		// A token-free, unknown protocol log selects the transaction for indexing.
		// Neither this log nor the receipt can reveal the token address or decimals.
		const log = { address: oracle, blockHash: block.hash, blockNumber: 10n, transactionHash, transactionIndex: 0n, logIndex: 0n, topics: [zeroHash], data: '0x' as const }
		const header = spyOn(indexer, 'getBlockHeader').mockResolvedValue(block)
		const transaction = spyOn(indexer.client, 'getTransaction').mockResolvedValue({ blockHash: block.hash, blockNumber: 10n, from: sender, gas: 100_000n, hash: transactionHash, input, nonce: 0n, to, transactionIndex: 0n, value: 0n })
		const receipt = spyOn(indexer.client, 'getTransactionReceipt').mockResolvedValue({ blockHash: block.hash, blockNumber: 10n, cumulativeGasUsed: 100_000n, from: sender, gasUsed: 100_000n, logs: [log], status: 'success', to, transactionHash, transactionIndex: 0n })
		try {
			const result = await indexer.indexBlock(10n, 10n, contracts, new Map(), undefined, block, [log], async () => [])
			expect(result.block.transactions[0]?.receipt).toMatchObject({ callTraceStatus: 'unavailable' })
			expect(reads.sort()).toEqual(['decimals', 'name', 'symbol'])
			expect(result.block.tokenMetadata).toEqual([{ address: token, decimals: 6, name: 'Unknown Token', symbol: 'TKN', readBlock: 10n }])
			expect(result.block.transactions[0]?.decoded.summary).toContain('amount=1.500001 TKN')
			expect(result.block.transactions[0]?.decoded.summary).not.toContain('base units')
		} finally {
			for (const mock of [header, transaction, receipt]) mock.mockRestore()
			server.stop(true)
			await database.close()
		}
	})
}
