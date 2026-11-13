import { expect, spyOn, test } from 'bun:test'
import { decodeFunctionResult, encodeAbiParameters, getAddress, toHex, keccak256, stringToHex, type Log } from '../../src/ethereum.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { projectionsFrom } from '../../src/projections.ts'
import { discoveredReceiptReplay } from '../support/replay-receipt-block.ts'

const portfolio = getAddress('0x1111111111111111111111111111111111111111')
const capital = getAddress('0x2222222222222222222222222222222222222222')
const owner = getAddress('0x3333333333333333333333333333333333333333')

test('universe preparation discovers capital and indexes deposits from the same receipt', async () => {
	const { database, indexer, hash, tx, header, position } = discoveredReceiptReplay()
	const logs: Log[] = [
		{ ...position, address: portfolio, logIndex: 0n, topics: [keccak256(stringToHex('UniversePrepared(uint248,address)')), toHex(2n, { size: 32 })], data: encodeAbiParameters([{ type: 'address' }], [capital]) },
		{ ...position, address: capital, logIndex: 1n, topics: [keccak256(stringToHex('PrincipalDeposited(address,address,uint256)')), toHex(BigInt(owner), { size: 32 }), toHex(BigInt(owner), { size: 32 })], data: encodeAbiParameters([{ type: 'uint256' }], [100n]) },
	]
	const mocks = [
		spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue({ hash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: owner, to: portfolio, gas: 1_000_000n, nonce: 0n, value: 0n, input: '0x' }),
		spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ transactionHash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: owner, to: portfolio, gasUsed: 1_000_000n, cumulativeGasUsed: 1_000_000n, status: 'success', logs }),
		spyOn(indexer.providers.client, 'readContract').mockImplementation(async request => {
			expect(request.blockNumber).toBe(10n)
			const address = request.functionName === 'capitalLedger' ? capital : portfolio
			return decodeFunctionResult({ abi: request.abi, functionName: request.functionName, data: request.functionName === 'universeId' ? encodeAbiParameters([{ type: 'uint248' }], [2n]) : encodeAbiParameters([{ type: 'address' }], [address]) })
		}),
	]
	try {
		const first = logs[0]
		if (first === undefined) throw new Error('Missing preparation log')
		const result = await indexBlock(
			indexer,
			10n,
			10n,
			new Map([[portfolio.toLowerCase(), { address: portfolio, kind: 'securityPoolPortfolio', label: 'Portfolio', provenance: 'test' }]]),
			new Map(),
			header.parentHash,
			header,
			[first],
			async addresses => logs.filter(log => addresses.includes(log.address)),
			async () => header,
		)
		expect(result.contracts.get(capital.toLowerCase())?.kind).toBe('securityPoolCapitalLedger')
		const deposit = result.block.logs.find(log => log.address === capital)
		if (deposit === undefined) throw new Error('Capital event was not indexed')
		expect(projectionsFrom(deposit)).toContainEqual(expect.objectContaining({ domain: 'risk', semanticEventKind: 'PrincipalDeposited', entityIdentity: `${capital.toLowerCase()}:${owner.toLowerCase()}` }))
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})
