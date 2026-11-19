import { expect, spyOn, test } from 'bun:test'
import { decodeFunctionResult, encodeAbiParameters, getAddress, keccak256, type Log, stringToHex, toHex } from '../../src/ethereum.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { indexerLogSources, isProtocolActivitySource, scanDiscoveredLogCoverage } from '../../src/indexer-runtime.ts'
import { projectionsFrom } from '../../src/projections.ts'
import type { ContractMetadata } from '../../src/types.ts'
import { discoveredReceiptReplay } from '../support/replay-receipt-block.ts'

const feed = getAddress('0x1111111111111111111111111111111111111111')
const escrow = getAddress('0x2222222222222222222222222222222222222222')
const sponsor = getAddress('0x3333333333333333333333333333333333333333')
const factory = getAddress('0x4444444444444444444444444444444444444444')
const topic = (signature: string) => keccak256(stringToHex(signature))
const contract = (address: ContractMetadata['address'], kind: string): ContractMetadata => ({ address, kind, label: kind, provenance: 'test' })

test('factory registration discovers a child feed before any question pool exists', async () => {
	const { database, indexer, hash, tx, header, position } = discoveredReceiptReplay()
	const registration: Log = {
		...position,
		address: factory,
		logIndex: 0n,
		topics: [topic('SharedPriceFeedRegistered(address,uint248,address)'), toHex(BigInt(sponsor), { size: 32 }), toHex(2n, { size: 32 }), toHex(BigInt(feed), { size: 32 })],
		data: '0x',
	}
	const mocks = [
		spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue({ hash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: sponsor, to: factory, gas: 1_000_000n, nonce: 0n, value: 0n, input: '0x' }),
		spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ transactionHash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: sponsor, to: factory, gasUsed: 1_000_000n, cumulativeGasUsed: 1_000_000n, status: 'success', logs: [registration] }),
	]
	try {
		const result = await indexBlock(
			indexer,
			10n,
			10n,
			new Map([[factory.toLowerCase(), contract(factory, 'securityPoolFactory')]]),
			new Map(),
			header.parentHash,
			header,
			[registration],
			async () => [],
			async () => header,
		)
		expect(result.contracts.get(feed.toLowerCase())).toMatchObject({ kind: 'sharedPoolPriceFeed', discoveryBlock: 10n })
		expect(indexerLogSources([...result.contracts.values()]).map(source => source.address)).toContain(feed)
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})

test('a settled report registers its escrow and stores the completion from the same receipt without a log request', async () => {
	const { database, indexer, hash, tx, header, position } = discoveredReceiptReplay()
	const report = toHex(7n, { size: 32 })
	const logs: Log[] = [
		{ ...position, address: feed, logIndex: 0n, topics: [topic('PriceReported(uint256,uint256,uint256)'), report], data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [5n, 6n]) },
		{ ...position, address: escrow, logIndex: 1n, topics: [topic('ReportCompleted(uint256,address,uint8)'), report, toHex(BigInt(feed), { size: 32 })], data: encodeAbiParameters([{ type: 'uint8' }], [1]) },
	]
	const mocks = [
		spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue({ hash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: sponsor, to: feed, gas: 1_000_000n, nonce: 0n, value: 0n, input: '0x' }),
		spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ transactionHash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: sponsor, to: feed, gasUsed: 1_000_000n, cumulativeGasUsed: 1_000_000n, status: 'success', logs }),
		spyOn(indexer.providers.client, 'readContract').mockImplementation(async request => {
			expect(request.blockNumber).toBe(10n)
			if (request.functionName !== 'reportCandidates' && request.functionName !== 'feed') throw new Error(`Unexpected read ${request.functionName}`)
			const data = request.functionName === 'feed' ? encodeAbiParameters([{ type: 'address' }], [feed]) : encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], [escrow, sponsor, sponsor, 1n])
			return decodeFunctionResult({ abi: request.abi, functionName: request.functionName, data })
		}),
	]
	try {
		const settled = logs[0]
		if (settled === undefined) throw new Error('Missing settlement log')
		const contracts = new Map([[feed.toLowerCase(), contract(feed, 'sharedPoolPriceFeed')]])
		const requested: string[][] = []
		const result = await indexBlock(
			indexer,
			10n,
			10n,
			contracts,
			new Map(),
			header.parentHash,
			header,
			[settled],
			// The synchronizer's discovery scan: only log-scan sources among the discoveries are queried.
			async (addresses, known) => {
				const coverage = await scanDiscoveredLogCoverage(
					10n,
					10n,
					addresses,
					known,
					async sources => {
						requested.push([...sources])
						return logs.filter(log => sources.includes(log.address))
					},
					async () => [],
				)
				return coverage.currentBlockLogs
			},
			async () => header,
		)
		expect(result.contracts.get(escrow.toLowerCase())).toMatchObject({ kind: 'sharedPoolReportEscrow', discoveryBlock: 10n })
		expect(requested).toEqual([])
		const completion = result.block.logs.find(log => log.address === escrow)
		if (completion === undefined) throw new Error('Escrow completion was not stored')
		expect(projectionsFrom(completion)).toContainEqual(expect.objectContaining({ domain: 'oracle', entityType: 'price-feed', entityIdentity: feed.toLowerCase(), semanticEventKind: 'ReportCompleted' }))
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})

test('escrows, commitment indexes and fee streams never join the scanned address set', () => {
	const escrows = Array.from({ length: 50 }, (_, index) => contract(getAddress(toHex(BigInt(index + 1_000), { size: 20 })), 'sharedPoolReportEscrow'))
	const registered = [contract(feed, 'sharedPoolPriceFeed'), contract(escrow, 'securityPoolCommitmentIndex'), contract(sponsor, 'securityPoolCapitalFeeStreams'), ...escrows]
	expect(indexerLogSources(registered).map(source => source.address)).toEqual([feed])
	for (const kind of ['sharedPoolReportEscrow', 'securityPoolCommitmentIndex', 'securityPoolCapitalFeeStreams']) expect(isProtocolActivitySource(contract(escrow, kind))).toBe(false)
	for (const kind of ['securityPoolSettlementBook', 'securityPoolReporterLedger', 'securityPoolPortfolioServices', 'securityPoolPortfolioSettlement', 'securityPoolCapitalLedger']) expect(isProtocolActivitySource(contract(escrow, kind))).toBe(true)
})
