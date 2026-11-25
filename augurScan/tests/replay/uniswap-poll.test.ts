import { expect, spyOn, test } from 'bun:test'
import dependencyAbis from '../../config/dependency-abis.json'
import { ScannerDatabase } from '../../src/database.ts'
import { type Address, toEventSelector, toHex, zeroHash } from '../../src/ethereum.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { getNextLogSegment } from '../../src/indexer/log-scanner.ts'
import { getBlockHeader } from '../../src/indexer/network-provider.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'
import { poll } from '../../src/indexer/network-synchronization.ts'
import { uniswapV4PoolId } from '../../src/uniswap.ts'

test('ordinary polling selects later REP pool creation and V4 pool activity without scanning quote tokens by address', async () => {
	const database = new ScannerDatabase('postgres://unused')
	const indexer = createNetworkIndexer({ id: 'sepolia', name: 'Sepolia', chainId: 11_155_111, rpcUrls: ['http://unused.invalid'], startBlock: 20n, confirmationDepth: 12n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
	indexer.stateBoundary.discovered = true
	indexer.lease = { backendPid: 1, connection: Object.assign(database.sql, { async release() {}, [Symbol.dispose]() {} }), assertHeld: async () => {}, release: async () => {} }
	const address = (id: number): Address => toHex(id, { size: 20 })
	const kinds = ['reputationToken', 'weth', 'usdc', 'uniswapV2Factory', 'uniswapV3Factory', 'uniswapV4PoolManager']
	const contracts = new Map(kinds.map((kind, i) => [address(i + 1), { address: address(i + 1), kind, label: kind, provenance: 'manifest', deploymentBlock: 10n, deploymentBlockExact: true }]))
	const hash = toHex(20, { size: 32 })
	const readLogs = spyOn(indexer.providers.logClient, 'getLogs').mockResolvedValue([])
	const mocks = [
		readLogs,
		spyOn(database, 'recordIndexerOwnership').mockResolvedValue(),
		spyOn(database, 'checkpoint').mockResolvedValue(undefined),
		spyOn(database, 'contracts').mockResolvedValue(contracts),
		spyOn(database, 'tokenMetadata').mockResolvedValue(new Map()),
		spyOn(database, 'logScanCursors').mockResolvedValue(new Map()),
		spyOn(database, 'retainedEntitySampleBlocks').mockResolvedValue([]),
		spyOn(database, 'storeBlocks').mockResolvedValue(),
		spyOn(indexer.providers.client, 'getBlockNumber').mockResolvedValue(20n),
		spyOn(indexer.providers.client, 'getBlock').mockResolvedValue({ number: 20n, hash, parentHash: zeroHash, timestamp: 20n, transactions: [] }),
	]
	try {
		await poll(indexer, { reconcileReorg: async () => {}, refreshContractDeployment: async () => {}, refreshStateSamples: async () => {}, indexBlock, getNextLogSegment, getBlockHeader })
		const queries = readLogs.mock.calls.map(([query]) => query)
		expect(queries.filter(query => !query.event && !query.topics).map(query => query.address)).toEqual([[address(1)]])
		for (const [factory, event] of [
			[address(4), 'PairCreated'],
			[address(5), 'PoolCreated'],
		] as const) {
			const topics = queries.filter(query => query.address === factory && query.event?.name === event).map(query => query.args)
			expect(topics).toEqual([
				{ token0: [address(2), address(3)], token1: undefined },
				{ token0: undefined, token1: [address(2), address(3)] },
			])
		}
		const poolTopics = queries.find(query => query.address === address(6))?.topics
		const eventNames = ['Initialize', 'Swap', 'ModifyLiquidity', 'Donate', 'ProtocolFeeUpdated']
		const events = dependencyAbis.uniswapV4PoolManager.filter(entry => entry.type === 'event' && eventNames.includes(entry.name ?? ''))
		expect(poolTopics?.[0]).toEqual(events.map(toEventSelector))
		expect(poolTopics?.[1]).toContain(uniswapV4PoolId(address(1), 3_000, 60, address(3)))
		expect(poolTopics?.[1]).toContain(uniswapV4PoolId(address(1), 3_000, 60))
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})
