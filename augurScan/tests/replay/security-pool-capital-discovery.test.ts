import { expect, spyOn, test } from 'bun:test'
import { decodeFunctionResult, encodeAbiParameters, getAddress, toHex, keccak256, stringToHex, type Log } from '../../src/ethereum.ts'
import { indexBlock } from '../../src/indexer/ingestion-operations.ts'
import { projectionsFrom } from '../../src/projections.ts'
import { discoveredReceiptReplay } from '../support/replay-receipt-block.ts'

const securityPool = getAddress('0x1111111111111111111111111111111111111111')
const capital = getAddress('0x2222222222222222222222222222222222222222')
const owner = getAddress('0x3333333333333333333333333333333333333333')
const index = getAddress('0x4444444444444444444444444444444444444444')
const streams = getAddress('0x5555555555555555555555555555555555555555')

test('universe preparation discovers capital and indexes deposits from the same receipt', async () => {
	const { database, indexer, hash, tx, header, position } = discoveredReceiptReplay()
	const logs: Log[] = [
		{ ...position, address: securityPool, logIndex: 0n, topics: [keccak256(stringToHex('UniversePrepared(uint248,address)')), toHex(2n, { size: 32 })], data: encodeAbiParameters([{ type: 'address' }], [capital]) },
		{ ...position, address: capital, logIndex: 1n, topics: [keccak256(stringToHex('PrincipalDeposited(address,address,uint256)')), toHex(BigInt(owner), { size: 32 }), toHex(BigInt(owner), { size: 32 })], data: encodeAbiParameters([{ type: 'uint256' }], [100n]) },
	]
	const mocks = [
		spyOn(indexer.providers.client, 'getTransaction').mockResolvedValue({ hash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: owner, to: securityPool, gas: 1_000_000n, nonce: 0n, value: 0n, input: '0x' }),
		spyOn(indexer.providers.client, 'getTransactionReceipt').mockResolvedValue({ transactionHash: tx, blockHash: hash, blockNumber: 10n, transactionIndex: 0n, from: owner, to: securityPool, gasUsed: 1_000_000n, cumulativeGasUsed: 1_000_000n, status: 'success', logs }),
		spyOn(indexer.providers.client, 'readContract').mockImplementation(async request => {
			expect(request.blockNumber).toBe(10n)
			const addresses: Readonly<Record<string, string>> = { capitalLedger: capital, commitmentIndex: index, feeStreams: streams, securityPool }
			const address = addresses[request.functionName] ?? securityPool
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
			new Map([[securityPool.toLowerCase(), { address: securityPool, kind: 'securityPool', label: 'Security pool', provenance: 'test' }]]),
			new Map(),
			header.parentHash,
			header,
			[first],
			async addresses => logs.filter(log => addresses.includes(log.address)),
			async () => header,
		)
		expect(result.contracts.get(capital.toLowerCase())?.kind).toBe('securityPoolCapitalLedger')
		// The ledger's accounting components are registered with it, from reads tagged with the same block.
		expect(result.contracts.get(index.toLowerCase())).toMatchObject({ kind: 'securityPoolCommitmentIndex', discoveryBlock: 10n })
		expect(result.contracts.get(streams.toLowerCase())).toMatchObject({ kind: 'securityPoolCapitalFeeStreams', discoveryBlock: 10n })
		const deposit = result.block.logs.find(log => log.address === capital)
		if (deposit === undefined) throw new Error('Capital event was not indexed')
		expect(projectionsFrom(deposit)).toContainEqual(expect.objectContaining({ domain: 'risk', semanticEventKind: 'PrincipalDeposited', entityIdentity: `${capital.toLowerCase()}:${owner.toLowerCase()}` }))
	} finally {
		for (const mock of mocks) mock.mockRestore()
		await database.close()
	}
})
