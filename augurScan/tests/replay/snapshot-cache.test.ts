import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { decodeFunctionResult, encodeAbiParameters, getAddress, toHex, zeroHash } from '../../src/ethereum.ts'
import { refreshEntityStateSnapshots } from '../../src/indexer/ingestion-operations.ts'
import { poll } from '../../src/indexer/network-synchronization.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'

for (const mode of ['committed', 'reorg', 'store failure'] as const) {
	test(`snapshot identity cache is published only with canonical persisted state (${mode})`, async () => {
		const database = new ScannerDatabase('postgres://unused')
		const indexer = createNetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
		indexer.lease = { backendPid: 1, connection: Object.assign(database.sql, { async release() {}, [Symbol.dispose]() {} }), assertHeld: async () => {}, release: async () => {} }
		const pool = getAddress('0x1111111111111111111111111111111111111111')
		const hash = toHex(10n, { size: 32 })
		let headers = 0
		const mocks = [
			spyOn(database, 'stateSnapshotTargets').mockResolvedValue([{ entityType: 'pool', entityIdentity: pool, address: pool }]),
			spyOn(indexer.providers.client, 'getBlock').mockImplementation(async () => ({ hash: mode === 'reorg' && headers++ > 0 ? zeroHash : hash, number: 10n, parentHash: zeroHash, timestamp: 100n, transactions: [] })),
			spyOn(indexer.providers.client, 'readContract').mockImplementation(async ({ abi, functionName }) => {
				const method = abi.find(entry => entry.type === 'function' && entry.name === functionName)
				if (method?.type !== 'function' || method.outputs === undefined) throw new Error(`Missing fixture function ${functionName}`)
				const values: Readonly<Record<string, unknown>> = { securityPoolFactory: pool, getSecurityPoolPortfolio: pool, collateralToken: pool, symbol: 'USDC', decimals: 6n, awaitingForkContinuation: false, isEscalationResolved: false }
				const value = values[functionName] ?? 1n
				return decodeFunctionResult({ abi, functionName, data: encodeAbiParameters(method.outputs, [value]) })
			}),
			spyOn(database, 'storeEntityStateSnapshots').mockImplementation(async () => {
				if (mode === 'store failure') throw new Error('Store failed')
			}),
		]
		try {
			const refresh = refreshEntityStateSnapshots(indexer, 10n, hash)
			if (mode === 'committed') await refresh
			else await expect(refresh).rejects.toThrow(mode === 'reorg' ? 'changed while it was being indexed' : 'Store failed')
			expect(indexer.collateralIdentityCache.size).toBe(mode === 'committed' ? 3 : 0)
		} finally {
			for (const mock of mocks) mock.mockRestore()
			await database.close()
		}
	})
}

test('a chain rewind discards previously committed collateral identity', async () => {
	const database = new ScannerDatabase('postgres://unused')
	const indexer = createNetworkIndexer({ id: 'test', name: 'Test', chainId: 31337, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 0n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal)
	indexer.lease = { backendPid: 1, connection: Object.assign(database.sql, { async release() {}, [Symbol.dispose]() {} }), assertHeld: async () => {}, release: async () => {} }
	const pool = getAddress('0x1111111111111111111111111111111111111111')
	indexer.collateralIdentityCache.set('previous identity', pool)
	const mocks = [
		spyOn(database, 'recordIndexerOwnership').mockResolvedValue(undefined),
		spyOn(database, 'checkpoint')
			.mockResolvedValueOnce({ number: 10n, hash: toHex(10n, { size: 32 }) })
			.mockResolvedValue(undefined),
		spyOn(indexer.providers.client, 'getBlock').mockResolvedValue({ number: 10n, hash: zeroHash, parentHash: zeroHash, timestamp: 100n, transactions: [] }),
		spyOn(database, 'canonicalCheckpointAtOrBefore').mockResolvedValue(undefined),
		spyOn(database, 'rewind').mockResolvedValue(undefined),
		spyOn(indexer.providers.client, 'getBlockNumber').mockResolvedValue(0n),
		spyOn(database, 'updateObservedHead').mockResolvedValue(undefined),
	]
	try {
		await poll(indexer)
		expect(indexer.collateralIdentityCache.size).toBe(0)
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})
