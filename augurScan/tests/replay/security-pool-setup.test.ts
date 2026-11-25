import { expect, spyOn, test } from 'bun:test'
import { decodeFunctionResult, encodeAbiParameters, getAddress, keccak256, stringToHex, toHex, type Log } from '../../src/ethereum.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { discoveredReceiptReplay } from '../support/replay-receipt-block.ts'

test('setup indexes the origin BookCreated before the pool emits SetupAdvanced without a question', async () => {
	const { database, indexer, hash, tx, header, position } = discoveredReceiptReplay()
	const pool = getAddress(toHex(1n, { size: 20 }))
	const settlement = getAddress(toHex(2n, { size: 20 }))
	const book = getAddress(toHex(3n, { size: 20 }))
	const sender = getAddress(toHex(4n, { size: 20 }))
	const topic = (signature: string) => keccak256(stringToHex(signature))
	const advanced: Log = { ...position, address: pool, logIndex: 1n, topics: [topic('SetupAdvanced(uint8)')], data: encodeAbiParameters([{ type: 'uint8' }], [1]) }
	const created: Log = {
		...position,
		address: book,
		logIndex: 0n,
		topics: [topic('BookCreated(uint64,uint64,uint256,uint256)'), toHex(1n, { size: 32 }), toHex(0n, { size: 32 })],
		data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [0n, 0n]),
	}
	const mocks = [
		spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue({ hash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: sender, to: pool, gas: 1_000_000n, nonce: 0n, value: 0n, input: '0x' }),
		spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ transactionHash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: sender, to: pool, gasUsed: 1_000_000n, cumulativeGasUsed: 1_000_000n, status: 'success', logs: [created, advanced] }),
		spyOn(indexer.providers.client, 'readContract').mockImplementation(async request => {
			let value = pool
			if (request.functionName === 'ledger') value = book
			else if (request.functionName === 'settlement' || request.address === book) value = settlement
			return decodeFunctionResult({ abi: request.abi, functionName: request.functionName, data: encodeAbiParameters([{ type: 'address' }], [value]) })
		}),
	]
	try {
		const result = await indexBlock(
			indexer,
			10n,
			10n,
			new Map([[pool.toLowerCase(), { address: pool, kind: 'securityPool', label: 'Security Pool', provenance: 'factory' }]]),
			new Map(),
			header.parentHash,
			header,
			[advanced],
			async addresses => (addresses.includes(book) ? [created] : []),
			async () => header,
		)
		expect(result.contracts.get(book.toLowerCase())).toMatchObject({ kind: 'securityPoolSettlementBook', discoveryBlock: 10n })
		expect(result.block.logs.find(log => log.address === book)?.decoded.name).toBe('BookCreated')
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})
