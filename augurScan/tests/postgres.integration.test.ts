import { expect, test } from 'bun:test'
import { handleApi } from '../src/api.ts'
import { type IndexedBlock, ScannerDatabase, type StoredTransaction } from '../src/database.ts'
import { getAddress, keccak256, stringToHex } from '../src/ethereum.ts'
import { migrate } from '../src/migrate.ts'
import type { ContractMetadata, NetworkConfig, StoredLog, TokenMetadata } from '../src/types.ts'

const postgresUrl = process.env['POSTGRES_TEST_URL']
const postgresTest = postgresUrl === undefined ? test.skip : test
const chainId = 31_337
const address = getAddress('0x1000000000000000000000000000000000000001')
const discoveredAddress = getAddress('0x2000000000000000000000000000000000000002')
const promotedAddress = getAddress('0x3000000000000000000000000000000000000003')
const rediscoveredAddress = getAddress('0x4000000000000000000000000000000000000004')
const orphanOnlyAddress = getAddress('0x5000000000000000000000000000000000000005')
const transactionHash = keccak256(stringToHex('augurScan integration transaction'))
const blockHash = (name: string) => keccak256(stringToHex(name))

const transaction = (): StoredTransaction => ({
	hash: transactionHash,
	transactionIndex: 0,
	from: address,
	to: discoveredAddress,
	value: 0n,
	input: '0x',
	status: 'success',
	gasUsed: 21_000n,
	receipt: { transactionHash, status: 'success', logs: [] },
	decoded: { status: 'unknown', summary: 'Unknown call' },
})

const log = (hash: ReturnType<typeof blockHash>, summary: string): StoredLog => ({
	transactionHash,
	blockHash: hash,
	blockNumber: 2n,
	transactionIndex: 0,
	logIndex: 0,
	address: discoveredAddress,
	topics: [],
	data: '0x',
	decoded: { status: 'unknown', summary },
})

const indexedBlock = (
	name: string,
	parentHash: ReturnType<typeof blockHash>,
	contracts: readonly ContractMetadata[] = [],
	summary?: string,
	tokenMetadata: readonly TokenMetadata[] = [],
): IndexedBlock => {
	const hash = blockHash(name)
	const number = name.includes('one') ? 1n : 2n
	return {
		number,
		hash,
		parentHash,
		timestamp: new Date(`2026-01-0${number}T00:00:00Z`),
		observedHead: 2n,
		finalizedThrough: 0n,
		contracts,
		tokenMetadata,
		transactions:
			summary === undefined
				? []
				: [
						{
							...transaction(),
							receipt: {
								transactionHash,
								blockHash: hash,
								status: 'success',
								logs: [{ address: discoveredAddress, topics: [], data: '0x', logIndex: 0 }],
							},
						},
					],
		logs: summary === undefined ? [] : [log(hash, summary)],
	}
}

postgresTest('migrates, resumes, retains an orphan, and serves only its canonical replacement', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	try {
		await migrate(database.sql)
		const concurrentMigrator = new ScannerDatabase(postgresUrl)
		try {
			await Promise.all([migrate(database.sql), migrate(concurrentMigrator.sql)])
			await migrate(concurrentMigrator.sql)
		} finally {
			await concurrentMigrator.close()
		}
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		const network: NetworkConfig = {
			id: 'integration',
			name: 'Integration chain',
			chainId,
			rpcUrl: 'http://127.0.0.1:8545',
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			confirmationDepth: 8n,
			contracts: [[address, 'Manifest contract', 'zoltar']],
		}
		await database.seedNetwork(network)
		const contender = new ScannerDatabase(postgresUrl)
		try {
			const lease = await database.tryAcquireIndexerLock(chainId)
			if (lease === undefined) throw new Error('first indexer did not acquire its lock')
			await lease.assertHeld()
			expect(await contender.tryAcquireIndexerLock(chainId)).toBeUndefined()
			await lease.release()
			const contenderLease = await contender.tryAcquireIndexerLock(chainId)
			if (contenderLease === undefined) throw new Error('standby indexer did not acquire the released lock')
			await contenderLease.assertHeld()
			await contenderLease.release()

			const lostLease = await database.tryAcquireIndexerLock(chainId)
			if (lostLease === undefined) throw new Error('indexer did not reacquire its lock for lease-loss validation')
			await contender.sql`SELECT pg_terminate_backend(${lostLease.backendPid})`
			await expect(lostLease.assertHeld()).rejects.toThrow()
			await lostLease.release().catch(() => undefined)
			const takeoverLease = await contender.tryAcquireIndexerLock(chainId)
			if (takeoverLease === undefined) throw new Error('standby did not take over after lease-session termination')
			await takeoverLease.assertHeld()
			await takeoverLease.release()
		} finally {
			await contender.close()
		}

		const writeLease = await database.tryAcquireIndexerLock(chainId)
		if (writeLease === undefined) throw new Error('writer did not acquire its lock')
		const genesisHash = blockHash('genesis')
		const initialDiscovery: ContractMetadata = {
			address: rediscoveredAddress,
			label: 'Original discovery',
			kind: 'reputationToken',
			provenance: 'Zoltar.UniverseCreated',
			discoveryBlock: 1n,
			discoveryTxHash: transactionHash,
		}
		const first = indexedBlock('block-one', genesisHash, [initialDiscovery], undefined, [
			{ address: rediscoveredAddress, name: 'Original token', symbol: 'OLD', decimals: 18, readBlock: 1n },
		])
		await database.storeBlock(chainId, first, writeLease)
		expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })

		const restarted = new ScannerDatabase(postgresUrl)
		try {
			expect(await restarted.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
		} finally {
			await restarted.close()
		}

		const discovery: ContractMetadata = {
			address: discoveredAddress,
			label: 'Discovered pool',
			kind: 'securityPool',
			provenance: 'Factory.DeploySecurityPool',
			discoveryBlock: 2n,
			discoveryTxHash: transactionHash,
		}
		const promotedDiscovery: ContractMetadata = {
			address: promotedAddress,
			label: 'Dynamically discovered helper',
			kind: 'securityPool',
			provenance: 'Factory.DeploySecurityPool',
			discoveryBlock: 2n,
			discoveryTxHash: transactionHash,
		}
		const laterRediscovery: ContractMetadata = {
			...initialDiscovery,
			label: 'Orphaned rediscovery',
			discoveryBlock: 2n,
		}
		const orphanOnlyDiscovery: ContractMetadata = {
			...laterRediscovery,
			address: orphanOnlyAddress,
			label: 'Orphan-only helper',
		}
		const orphan = indexedBlock('block-two-orphan', first.hash, [discovery, promotedDiscovery, laterRediscovery, orphanOnlyDiscovery], 'orphan event', [
			{ address: discoveredAddress, readError: 'ERC-20 metadata unavailable', readBlock: 2n },
			{ address: rediscoveredAddress, name: 'Orphaned token', symbol: 'BAD', decimals: 6, readBlock: 2n },
		])
		await database.storeBlock(chainId, orphan, writeLease)
		await database.seedNetwork(
			{
				...network,
				contracts: [
					[address, 'Corrected manifest contract', 'openOracle'],
					[promotedAddress, 'Promoted manifest helper', 'securityPool'],
				],
			},
			writeLease,
		)
		const seededContracts = await database.contracts(chainId)
		expect(seededContracts.get(address.toLowerCase())).toMatchObject({ label: 'Corrected manifest contract', kind: 'openOracle', provenance: 'manifest' })
		expect(seededContracts.get(promotedAddress.toLowerCase())).toEqual({
			address: promotedAddress,
			label: 'Promoted manifest helper',
			kind: 'securityPool',
			provenance: 'manifest',
		})
		await database.rewind(chainId, 1n, first.hash, writeLease)
		expect((await database.contracts(chainId)).get(promotedAddress.toLowerCase())?.provenance).toBe('manifest')
		expect((await database.contracts(chainId)).get(rediscoveredAddress.toLowerCase())).toMatchObject({
			label: 'Original discovery',
			kind: 'reputationToken',
			discoveryBlock: 1n,
		})
		expect((await database.tokenMetadata(chainId)).get(rediscoveredAddress.toLowerCase())).toMatchObject({
			name: 'Original token',
			symbol: 'OLD',
			decimals: 18,
			readBlock: 1n,
		})
		const orphanContractResponse = await handleApi(new Request(`http://localhost/api/v1/contracts/${chainId}/${orphanOnlyAddress}`), database.sql)
		expect(orphanContractResponse?.status).toBe(404)

		const replacement = indexedBlock('block-two-replacement', first.hash, [discovery], 'replacement event', [
			{ address: discoveredAddress, name: 'Replacement token', symbol: 'NEW', decimals: 6, readBlock: 2n },
		])
		await database.storeBlock(chainId, replacement, writeLease)
		await database.seedNetwork({ ...network, contracts: [[discoveredAddress, 'Temporarily promoted pool', 'securityPool']] }, writeLease)
		await database.seedNetwork({ ...network, contracts: [] }, writeLease)
		const reconciledContracts = await database.contracts(chainId)
		expect(reconciledContracts.has(address.toLowerCase())).toBe(false)
		expect(reconciledContracts.has(promotedAddress.toLowerCase())).toBe(false)
		expect(reconciledContracts.get(discoveredAddress.toLowerCase())).toMatchObject({
			label: 'Discovered pool',
			kind: 'securityPool',
			provenance: 'Factory.DeploySecurityPool',
			discoveryBlock: 2n,
			discoveryTxHash: transactionHash,
		})
		await writeLease.release()
		const blockRows = await database.sql`SELECT hash, canonical FROM blocks WHERE chain_id = ${chainId} AND number = 2 ORDER BY hash`
		expect(blockRows).toHaveLength(2)
		expect(blockRows.filter((row: Record<string, unknown>) => row['canonical'] === true)).toHaveLength(1)
		expect(blockRows.find((row: Record<string, unknown>) => row['hash'] === orphan.hash)?.['canonical']).toBe(false)
		const metadataRows =
			await database.sql`SELECT block_hash, decimals, canonical FROM token_metadata WHERE chain_id = ${chainId} AND address = ${discoveredAddress.toLowerCase()} ORDER BY block_hash`
		expect(metadataRows).toHaveLength(2)
		expect(metadataRows.find((row: Record<string, unknown>) => row['block_hash'] === orphan.hash)?.['canonical']).toBe(false)
		expect(metadataRows.find((row: Record<string, unknown>) => row['block_hash'] === replacement.hash)).toMatchObject({ canonical: true, decimals: 6 })

		const third: IndexedBlock = {
			...indexedBlock('block-three', replacement.hash),
			number: 3n,
			timestamp: new Date('2026-01-03T00:00:00Z'),
			observedHead: 3n,
		}
		const failover = new ScannerDatabase(postgresUrl)
		try {
			const lostWriteLease = await database.tryAcquireIndexerLock(chainId)
			if (lostWriteLease === undefined) throw new Error('writer did not reacquire for fenced-write validation')
			await failover.sql`SELECT pg_terminate_backend(${lostWriteLease.backendPid})`
			await expect(database.storeBlock(chainId, third, lostWriteLease)).rejects.toThrow()
			expect(await failover.checkpoint(chainId)).toEqual({ number: 2n, hash: replacement.hash })
			await lostWriteLease.release().catch(() => undefined)
			const takeoverWriteLease = await failover.tryAcquireIndexerLock(chainId)
			if (takeoverWriteLease === undefined) throw new Error('takeover writer did not acquire after fencing')
			await failover.storeBlock(chainId, third, takeoverWriteLease)
			expect(await failover.checkpoint(chainId)).toEqual({ number: 3n, hash: third.hash })
			await takeoverWriteLease.release()
			await expect(database.recordFailure(chainId, 'stale former owner', lostWriteLease)).rejects.toThrow()
			const statusRows = await failover.sql`SELECT phase, last_error FROM networks WHERE chain_id = ${chainId}`
			expect(statusRows[0]).toMatchObject({ phase: 'live', last_error: null })
		} finally {
			await failover.close()
		}

		const response = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}`), database.sql)
		if (response === undefined) throw new Error('logs API did not return a response')
		const payload = (await response.json()) as { items: Array<{ summary: string; block_hash: string }> }
		expect(payload.items).toHaveLength(1)
		expect(payload.items[0]).toMatchObject({ summary: 'replacement event', block_hash: replacement.hash })
		const detailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${replacement.hash}/${transactionHash}/0`), database.sql)
		if (detailResponse === undefined) throw new Error('log detail API did not return a response')
		const detail = (await detailResponse.json()) as { receipt: { logs: unknown[] }; argument_schema: unknown[] }
		expect(detail.receipt.logs).toHaveLength(1)
		expect(detail.argument_schema).toEqual([])
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})
