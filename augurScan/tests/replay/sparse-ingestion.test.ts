import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase, type IndexedBlock } from '../../src/database.ts'
import { toHex, zeroAddress, zeroHash } from '../../src/ethereum.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { poll, type PollOperations } from '../../src/indexer/network-synchronization.ts'

for (const mode of ['quiet', 'events', 'event-reorg'] as const) {
	test(`indexes a 100000-block ${mode} range with sparse checkpoints`, async () => {
		const database = new ScannerDatabase('postgres://unused')
		const indexer = createNetworkIndexer({ id: 'sepolia', name: 'Sepolia', chainId: 11_155_111, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 12n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
		indexer.stateBoundary.discovered = true
		indexer.lease = { backendPid: 1, connection: Object.assign(database.sql, { release() {}, [Symbol.dispose]() {} }), assertHeld: async () => {}, release: async () => {} }
		const header = (number: bigint) => ({ hash: toHex(number, { size: 32 }), parentHash: toHex(number - 1n, { size: 32 }), timestamp: 1_700_000_000n + number })
		const contracts = new Map([[zeroAddress, { address: zeroAddress, label: 'Oracle', kind: 'openOracle', provenance: 'manifest', deploymentBlock: 10n, deploymentBlockExact: true }]])
		const logs = mode === 'quiet' ? [] : [10n, 50n].map(number => ({ address: zeroAddress, blockNumber: number, blockHash: header(number).hash, transactionHash: toHex(number + 1_000n, { size: 32 }), transactionIndex: 0n, logIndex: 0n, topics: [zeroHash], data: '0x' as const }))
		const stored: IndexedBlock[] = []
		const fullBlocks = spyOn(indexer.providers.client, 'getBlock').mockImplementation(async () => {
			throw new Error('Unexpected full-block read')
		})
		const transactionReads: string[] = []
		let changedBeforeCommit = false
		const mocks = [
			fullBlocks,
			spyOn(database, 'recordIndexerOwnership').mockResolvedValue(),
			spyOn(database, 'checkpoint').mockResolvedValue(undefined),
			spyOn(database, 'contracts').mockResolvedValue(contracts),
			spyOn(database, 'tokenMetadata').mockResolvedValue(new Map()),
			spyOn(database, 'logScanCursors').mockResolvedValue(new Map()),
			spyOn(indexer.providers.client, 'getBlockNumber').mockResolvedValue(100_009n),
			spyOn(indexer.providers.client, 'getTransaction').mockImplementation(async ({ hash }) => {
				transactionReads.push(hash)
				const number = BigInt(hash) - 1_000n
				return { hash, blockHash: header(number).hash, blockNumber: number, transactionIndex: 0n, from: zeroAddress, to: zeroAddress, gas: 21_000n, nonce: 0n, value: 0n, input: '0x' }
			}),
			spyOn(indexer.providers.client, 'getTransactionReceipt').mockImplementation(async ({ hash }) => {
				const number = BigInt(hash) - 1_000n
				return { transactionHash: hash, blockHash: header(number).hash, blockNumber: number, transactionIndex: 0n, from: zeroAddress, to: zeroAddress, gasUsed: 21_000n, cumulativeGasUsed: 21_000n, status: 'success', logs: logs.filter(log => log.transactionHash === hash) }
			}),
			spyOn(database, 'storeBlocks').mockImplementation(async (_chain, blocks, _lease, _provenance, validate) => {
				changedBeforeCommit = mode === 'event-reorg'
				await validate?.()
				stored.push(...blocks)
			}),
		]
		const operations: PollOperations = {
			reconcileReorg: async () => {},
			refreshContractDeployment: async () => {},
			getBlockHeader: async (_providers, number) => ({ ...header(number), hash: changedBeforeCommit && number === 10n ? zeroHash : header(number).hash }),
			getNextLogSegment: async () => ({ toBlock: 100_009n, logs, endBlockHash: header(100_009n).hash, endBlockHeader: header(100_009n), scanInputs: [{ address: zeroAddress, startBlock: 10n, fromBlock: 10n }], deploymentObservations: [] }),
			indexBlock,
		}
		try {
			expect(await poll(indexer, operations)).toBe(mode !== 'event-reorg')
			const expectedBlocks = { quiet: [100_009n], 'event-reorg': [], events: [10n, 50n, 100_009n] }[mode]
			expect(stored.map(block => block.number)).toEqual(expectedBlocks)
			if (mode !== 'event-reorg') expect(stored.at(-1)?.logScanCursors).toEqual([{ contractAddress: zeroAddress, startBlock: 10n, lastRetrievedBlock: 100_009n }])
			expect(transactionReads).toEqual(logs.map(log => log.transactionHash))
			expect(fullBlocks).not.toHaveBeenCalled()
		} finally {
			for (const mock of mocks) mock.mockRestore()
			await database.close()
		}
	})
}
