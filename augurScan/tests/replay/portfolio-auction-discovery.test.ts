import { expect, spyOn, test } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { decodeFunctionResult, encodeAbiParameters, getAddress, toFunctionSelector, toHex, keccak256, stringToHex, zeroAddress, type Log } from '../../src/ethereum.ts'
import { createNetworkIndexer } from '../../src/indexer/network-state.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { projectionsFrom } from '../../src/projections.ts'
import { sampleEntityStateWithRead } from '../../src/snapshots.ts'

const controller = getAddress('0x1111111111111111111111111111111111111111')
const auction = getAddress('0x2222222222222222222222222222222222222222')
const engine = getAddress('0x3333333333333333333333333333333333333333')

test('branch events discover the uniform engine, index its auction event and sample the projected auction identity', async () => {
	const database = new ScannerDatabase('postgres://unused')
	const indexer = createNetworkIndexer({ id: 'sepolia', name: 'Sepolia', chainId: 11_155_111, rpcUrls: ['http://unused.invalid'], startBlock: 10n, confirmationDepth: 12n, explorerBaseUrl: '', nativeSymbol: 'ETH', contracts: [] }, database, new AbortController().signal, { traceSelectedTransactions: false })
	indexer.stateBoundary.discovered = true
	const hash = toHex(10n, { size: 32 })
	const tx = toHex(20n, { size: 32 })
	const header = { hash, parentHash: toHex(9n, { size: 32 }), timestamp: 1_700_000_000n }
	const position = { blockNumber: 10n, blockHash: hash, transactionHash: tx, transactionIndex: 0n }
	const logs: Log[] = [
		{ ...position, address: controller, logIndex: 0n, topics: [keccak256(stringToHex('BranchStarted(uint248,uint256,uint256)')), toHex(2n, { size: 32 })], data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [100n, 200n]) },
		{
			...position,
			address: engine,
			logIndex: 1n,
			topics: [keccak256(stringToHex('AuctionStarted(uint256,uint256,uint256,uint256,uint256,uint256)'))],
			data: encodeAbiParameters(
				Array.from({ length: 6 }, () => ({ type: 'uint256' })),
				[100n, 200n, 1n, 100n, 200n, 2n],
			),
		},
	]
	const reads: string[] = []
	const mocks = [
		spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue({ hash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: zeroAddress, to: controller, gas: 1_000_000n, nonce: 0n, value: 0n, input: '0x' }),
		spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ transactionHash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: zeroAddress, to: controller, gasUsed: 1_000_000n, cumulativeGasUsed: 1_000_000n, status: 'success', logs }),
		spyOn(indexer.providers.client, 'readContract').mockImplementation(async request => {
			expect(request.blockNumber).toBe(10n)
			reads.push(request.functionName)
			const result = (address: `0x${string}`) => decodeFunctionResult({ abi: request.abi, functionName: request.functionName, data: encodeAbiParameters([{ type: 'address' }], [address]) })
			if (request.address === controller && request.functionName === 'auctions') {
				expect(Array.from(request.args ?? [])).toEqual([2n])
				return result(auction)
			}
			if (request.address === auction && request.functionName === 'forkAuthority') return result(controller)
			if (request.address === auction && request.functionName === 'engine') return result(engine)
			if (request.address === engine && request.functionName === 'controller') return result(auction)
			throw new Error(`Unexpected discovery read ${request.functionName}`)
		}),
	]
	try {
		const first = logs[0]
		if (first === undefined) throw new Error('Missing branch log')
		const result = await indexBlock(
			indexer,
			10n,
			10n,
			new Map([[controller.toLowerCase(), { address: controller, kind: 'securityPoolPortfolioForkCoordinator', label: 'Portfolio Fork Coordinator', provenance: 'test' }]]),
			new Map(),
			header.parentHash,
			header,
			[first],
			async addresses => logs.filter(log => addresses.includes(log.address)),
			async () => header,
		)
		expect(result.contracts.get(auction.toLowerCase())?.kind).toBe('securityPoolPortfolioAuction')
		expect(result.contracts.get(engine.toLowerCase())?.kind).toBe('securityPoolUniformPriceAuction')
		expect(reads).toEqual(['auctions', 'forkAuthority', 'engine', 'controller', 'portfolio', 'collateralToken'])
		const indexed = result.block.logs.find(log => log.address === engine)
		if (indexed === undefined) throw new Error('Engine event was not indexed')
		expect(projectionsFrom(indexed)).toContainEqual(expect.objectContaining({ domain: 'auction', semanticEventKind: 'AuctionStarted' }))
		const snapshot = await sampleEntityStateWithRead({ entityType: 'auction', entityIdentity: indexed.address.toLowerCase(), address: indexed.address }, async (address, abi, name) => {
			expect(address).toBe(engine)
			expect(abi.some(item => item.type === 'function' && item.name === name && toFunctionSelector(item).length === 10)).toBe(true)
			if (name === 'initialized') return true
			if (name === 'finalized') return false
			if (name === 'clearing') return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false]
			return 1n
		})
		expect(snapshot.readStatus).toBe('success')
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})
