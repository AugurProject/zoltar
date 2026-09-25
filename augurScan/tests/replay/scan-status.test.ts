import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase, type IndexedBlock } from '../../src/database.ts'
import { NetworkIndexer } from '../../src/indexer/block-ingestion.ts'
import { toHex, zeroAddress, zeroHash } from '../../src/ethereum.ts'

for (const mode of ['committed', 'empty', 'failed', 'reorg'] as const) {
	test(`scan summary reflects ${mode} ingestion and only counts committed logs`, async () => {
		const database = new ScannerDatabase('postgres://unused')
		const signal = new AbortController().signal
		const indexer = new NetworkIndexer({ id: 'sepolia', name: 'Sepolia', chainId: 11_155_111, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 12n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, signal)
		indexer.stateBoundaryDiscovered = true
		indexer.lease = { backendPid: 1, connection: Object.assign(database.sql, { release() {}, [Symbol.dispose]() {} }), assertHeld: async () => {}, release: async () => {} }
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
			spyOn(database, 'contracts').mockResolvedValue(new Map()),
			spyOn(database, 'tokenMetadata').mockResolvedValue(new Map()),
			spyOn(database, 'logScanCursors').mockResolvedValue(new Map()),
			spyOn(indexer, 'reconcileReorg').mockResolvedValue(),
			spyOn(indexer, 'refreshContractDeployment').mockResolvedValue(),
			spyOn(indexer.client, 'getBlockNumber').mockResolvedValueOnce(10n).mockResolvedValue(12n),
			spyOn(indexer, 'getNextLogSegment').mockResolvedValue({ toBlock: 10n, logs: [], scanInputs: [], deploymentObservations: [], endBlockHash: hash, endBlockHeader: header }),
			spyOn(indexer, 'getBlockHeader').mockResolvedValue({ ...header, hash: mode === 'reorg' ? zeroHash : hash }),
			// The completed ingestion result includes logs discovered after the initial empty RPC segment.
			spyOn(indexer, 'indexBlock').mockResolvedValue({ block, contracts: new Map(), tokenMetadata: new Map() }),
			spyOn(database, 'storeBlocks').mockImplementation(async (_chainId, _blocks, _lease, _provenance, validate) => {
				await validate?.()
				if (mode === 'failed') throw new Error('Commit failed')
				committed = true
			}),
		]
		try {
			if (mode === 'failed') await expect(indexer.poll()).rejects.toThrow('Commit failed')
			else expect(await indexer.poll()).toBe(mode !== 'reorg')
			expect(lines).toHaveLength(1)
			if (mode === 'committed' || mode === 'empty') {
				expect(lines[0]).toContain(`logsAdded=${block.logs.length}`)
				expect(lines[0]).toContain('blocksScanned=1')
				expect(lines[0]).toContain('status=lagging lagging=true reason=behind-head blocksBehind=2')
			} else {
				expect(lines[0]).toContain(`status=${mode === 'failed' ? 'failed' : 'incomplete'}`)
				expect(lines[0]).not.toContain('logsAdded=')
			}
		} finally {
			for (const mock of mocks) mock.mockRestore()
			await database.close()
		}
	})
}
