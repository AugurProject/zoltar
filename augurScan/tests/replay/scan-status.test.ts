import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase, type IndexedBlock } from '../../src/database.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'
import { type PollOperations, poll } from '../../src/indexer/network-synchronization.ts'
import { toHex, zeroAddress, zeroHash } from '../../src/ethereum.ts'

for (const mode of ['committed', 'empty', 'failed', 'reorg', 'wide', 'partial-failure', 'partial-reorg', 'heartbeat'] as const) {
	test(`scan summary reflects ${mode} ingestion and only counts committed logs`, async () => {
		const database = new ScannerDatabase('postgres://unused')
		const signal = new AbortController().signal
		const indexer = createNetworkIndexer({ id: 'sepolia', name: 'Sepolia', chainId: 11_155_111, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 12n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, signal)
		indexer.stateBoundary.discovered = true
		indexer.lease = { backendPid: 1, connection: Object.assign(database.sql, { release() {}, [Symbol.dispose]() {} }), assertHeld: async () => {}, release: async () => {} }
		const largeRange = mode === 'wide' || mode === 'partial-failure' || mode === 'partial-reorg'
		const segmentEnd = largeRange ? 259n : 10n
		const contracts = new Map([[zeroAddress, { address: zeroAddress, label: 'OpenOracle', kind: 'openOracle', provenance: 'manifest', deploymentBlock: 10n, deploymentBlockExact: true }]])
		const storedRanges: Array<readonly [bigint | undefined, bigint | undefined, number]> = []
		const hash = toHex(10n, { size: 32 })
		const header = { number: 10n, hash, parentHash: zeroHash, timestamp: 1_700_000_000n, transactions: [] }
		const block: IndexedBlock = {
			number: 10n,
			hash,
			parentHash: zeroHash,
			timestamp: new Date(),
			observedHead: 10n,
			finalizedThrough: 0n,
			contracts: [],
			tokenMetadata: [],
			transactions: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: [],
			logs: mode === 'empty' ? [] : [0, 1].map(logIndex => ({ transactionHash: zeroHash, blockHash: hash, blockNumber: 10n, transactionIndex: 0, logIndex, address: zeroAddress, topics: [], data: '0x', decoded: { status: 'unknown', summary: 'Discovered protocol log' } })),
		}
		let committed = false
		const lines: string[] = []
		const mocks = [
			spyOn(console, 'info').mockImplementation(line => {
				if (typeof line === 'string' && line.includes('ProcessedMs=')) {
					if (line.includes('logsAdded=')) expect(committed).toBe(true)
					lines.push(String(line))
				}
			}),
			spyOn(database, 'recordIndexerOwnership').mockResolvedValue(),
			spyOn(database, 'checkpoint').mockResolvedValue(undefined),
			spyOn(database, 'contracts').mockResolvedValue(contracts),
			spyOn(database, 'tokenMetadata').mockResolvedValue(new Map()),
			spyOn(database, 'logScanCursors').mockResolvedValue(new Map()),
			spyOn(indexer.providers.client, 'getBlockNumber')
				.mockResolvedValueOnce(largeRange ? 200_000n : 10n)
				.mockResolvedValue(largeRange ? 200_000n : 12n),
			spyOn(database, 'storeBlocks').mockImplementation(async (_chainId, blocks, _lease, _provenance, validate) => {
				await validate?.()
				const lastBlock = blocks.at(-1)
				if (lastBlock === undefined) throw new Error('Expected a nonempty commit batch')
				if (largeRange) expect(lastBlock.logScanCursors).toEqual([{ contractAddress: zeroAddress, startBlock: 10n, lastRetrievedBlock: lastBlock.number }])
				if (mode === 'failed' || (mode === 'partial-failure' && committed)) throw new Error('Commit failed')
				storedRanges.push([blocks[0]?.number, blocks.at(-1)?.number, blocks.length])
				committed = true
			}),
		]
		const intervalMock = mode === 'heartbeat' ? spyOn(globalThis, 'setInterval') : undefined
		const expectUncommittedHeartbeat = () => {
			for (const [callback, interval] of intervalMock?.mock.calls ?? []) {
				if (interval === 30_000 && typeof callback === 'function') callback()
			}
			expect(lines.length).toBeGreaterThan(0)
			expect(lines.at(-1)).toContain('Sepolia 9:')
			expect(lines.at(-1)).toContain('blocksScanned=0 progress=0.00% etaSeconds=unknown status=backfilling')
			expect(lines.at(-1)).toContain('blocksBehind=1')
			lines.length = 0
		}
		const operations: PollOperations = {
			reconcileReorg: async () => {},
			refreshContractDeployment: async () => {},
			getNextLogSegment: async (_state, fromBlock, maximumToBlock) => {
				if (mode === 'heartbeat') expectUncommittedHeartbeat()
				if (largeRange) {
					expect(fromBlock).toBe(10n)
					expect(maximumToBlock).toBe(100_009n)
				}
				// A reduced segment must be committed only through its accepted end.
				return { toBlock: segmentEnd, logs: [], scanInputs: [{ address: zeroAddress, startBlock: 10n, fromBlock }], deploymentObservations: [], endBlockHash: hash, endBlockHeader: { ...header, number: segmentEnd } }
			},
			getBlockHeader: async (_providers, number) => ({ ...header, number, hash: mode === 'reorg' || (mode === 'partial-reorg' && committed && number === segmentEnd) ? zeroHash : hash }),
			// The completed ingestion result includes logs discovered after the initial empty RPC segment.
			indexBlock: async (_state, number) => {
				if (mode === 'heartbeat') expectUncommittedHeartbeat()
				return { block: { ...block, number }, contracts, tokenMetadata: new Map() }
			},
		}
		try {
			if (mode === 'failed' || mode === 'partial-failure') await expect(poll(indexer, operations)).rejects.toThrow('Commit failed')
			else expect(await poll(indexer, operations)).toBe(mode !== 'reorg' && !largeRange)
			expect(lines).toHaveLength(1)
			if (mode === 'wide')
				expect(storedRanges).toEqual([
					[10n, 109n, 100],
					[110n, 209n, 100],
					[210n, 259n, 50],
				])
			if (mode === 'committed' || mode === 'empty' || mode === 'wide' || mode === 'heartbeat') {
				expect(lines[0]).toContain(`logsAdded=${block.logs.length * (largeRange ? 250 : 1)}`)
				expect(lines[0]).toContain(`blocksScanned=${largeRange ? 250 : 1}`)
				expect(lines[0]).toContain(`status=${mode === 'wide' ? 'backfilling' : 'lagging'} lagging=true reason=behind-head blocksBehind=${largeRange ? 199_741 : 2}`)
			} else if (mode === 'partial-failure' || mode === 'partial-reorg') {
				expect(storedRanges).toEqual([[10n, 109n, 100]])
				expect(lines[0]).toContain('logsAdded=200')
				expect(lines[0]).toContain('blocksScanned=100')
				expect(lines[0]).toContain(`status=${mode === 'partial-failure' ? 'failed' : 'incomplete'}`)
			} else {
				expect(lines[0]).toContain(`status=${mode === 'failed' ? 'failed' : 'incomplete'}`)
				expect(lines[0]).not.toContain('logsAdded=')
			}
		} finally {
			intervalMock?.mockRestore()
			for (const mock of mocks) mock.mockRestore()
			await database.close()
		}
	})
}
