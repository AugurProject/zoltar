import { describe, expect, test } from 'bun:test'
import { isAccountTransactionValue, isLogDetailValue, isRecord } from '../browser/api-validation.ts'
import { handleApi } from '../src/api.ts'
import {
	assertBlockAppend,
	assertContractDeploymentObservation,
	assertLogScanCursorUpdate,
	assertRewindTarget,
	assertStartBlockCompatible,
	type IndexedBlock,
	lockLiveEventWriter,
	releaseReservedConnection,
	replayWindowExpired,
	rewindDepth,
	ScannerDatabase,
	type StoredTransaction,
	scannerDatabaseOptions,
} from '../src/database.ts'
import { getAddress, keccak256, stringToHex } from '../src/ethereum.ts'
import { initializeSchema, UNSUPPORTED_SCHEMA_MESSAGE } from '../src/schema.ts'
import type { ContractMetadata, NetworkConfig, StoredLog, TokenMetadata } from '../src/types.ts'
import { uniswapV4PoolId } from '../src/uniswap.ts'

const postgresUrl = process.env['POSTGRES_TEST_URL']
const postgresTest = postgresUrl === undefined ? test.skip : test
const chainId = 31_337
const address = getAddress('0x1000000000000000000000000000000000000001')
const discoveredAddress = getAddress('0x2000000000000000000000000000000000000002')
const promotedAddress = getAddress('0x3000000000000000000000000000000000000003')
const rediscoveredAddress = getAddress('0x4000000000000000000000000000000000000004')
const orphanOnlyAddress = getAddress('0x5000000000000000000000000000000000000005')
const wethAddress = getAddress('0x6000000000000000000000000000000000000006')
const secondWethAddress = getAddress('0x6000000000000000000000000000000000000007')
const referencedOnlyAddress = getAddress('0x7000000000000000000000000000000000000008')
const pairAddress = getAddress('0x8000000000000000000000000000000000000009')
const uniswapPairAddress = getAddress('0x9000000000000000000000000000000000000009')
const inverseUniswapPairAddress = getAddress('0xa000000000000000000000000000000000000009')
const uniswapV4PoolManagerAddress = getAddress('0xb000000000000000000000000000000000000009')
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

const vaultCheckpoint = (hash: ReturnType<typeof blockHash>): StoredLog => ({
	...log(hash, 'replacement vault checkpoint'),
	logIndex: 1,
	decoded: {
		status: 'decoded',
		name: 'VaultAccountingCheckpoint',
		summary: 'replacement vault checkpoint',
		arguments: {
			vault: address,
			repBackingUnits: '120000000000000000000',
			capacityOwnershipAttoRep: 85_000_000_000_000_000_000n.toString(),
			claimableFeesAttoEth: 30_000_000_000_000_000n.toString(),
			feeIndex: '1',
			vaultFeeRemainder: '0',
			resultingTotalRepBackingUnits: '120000000000000000000',
			resultingFeeEligibleCapacityOwnershipAttoRep: 85_000_000_000_000_000_000n.toString(),
		},
	},
})

const decodedLog = (
	hash: ReturnType<typeof blockHash>,
	logIndex: number,
	emitter: ReturnType<typeof getAddress>,
	name: string,
	argumentsValue: Record<string, unknown>,
): StoredLog => ({
	...log(hash, name),
	logIndex,
	address: emitter,
	decoded: { status: 'decoded', name, summary: name, arguments: argumentsValue },
})

const repPriceLog = (hash: ReturnType<typeof blockHash>, price: string): StoredLog =>
	decodedLog(hash, 5, promotedAddress, 'PriceReported', {
		reportId: '42',
		price,
		lastSettlementTimestamp: '1767312000',
	})

const priceHistoryLogs = (hash: ReturnType<typeof blockHash>): readonly StoredLog[] => [
	decodedLog(hash, 2, address, 'DeploySecurityPool', {
		securityPool: discoveredAddress,
		parent: '0x0000000000000000000000000000000000000000',
		universeId: '0',
		questionId: '42',
		truthAuction: rediscoveredAddress,
		priceOracleManagerAndOperatorQueuer: promotedAddress,
		shareToken: wethAddress,
		statoblastSecurityMultiplierBps: '15000',
		initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n.toString(),
		currentRetentionRate: '999999000000000000',
		settlementCollateralAttoEth: 12_000_000_000_000_000_000n.toString(),
	}),
	decodedLog(hash, 3, address, 'PairCreated', {
		securityPool: discoveredAddress,
		shareToken: wethAddress,
		universeId: '0',
		pair: pairAddress,
		feeBps: '30',
	}),
	decodedLog(hash, 4, pairAddress, 'Sync', { yesReserve: '300000000000000000000', noReserve: '700000000000000000000' }),
	repPriceLog(hash, '19500000000000000000'),
	decodedLog(hash, 6, address, 'UniverseInitialized', {
		universeId: '0',
		parentUniverseId: '0',
		forkingOutcomeIndex: '0',
		reputationToken: rediscoveredAddress,
		forkQuestionId: '0',
		forkTime: '0',
		universeTheoreticalSupplyAttoRep: 10_000_000_000_000_000_000_000_000n.toString(),
	}),
	decodedLog(hash, 7, address, 'PairCreated', {
		token0: rediscoveredAddress,
		token1: wethAddress,
		pair: uniswapPairAddress,
		'3': '1',
	}),
	decodedLog(hash, 8, uniswapPairAddress, 'Sync', {
		reserve0: '1800000000000000000000',
		reserve1: '100000000000000000000',
	}),
	decodedLog(hash, 9, address, 'PairCreated', {
		token0: wethAddress,
		token1: rediscoveredAddress,
		pair: inverseUniswapPairAddress,
		'3': '2',
	}),
	decodedLog(hash, 10, inverseUniswapPairAddress, 'Sync', {
		reserve0: '100000000000000000000',
		reserve1: '2400000000000000000000',
	}),
]

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
		addressActivity: [],
		contractDeploymentObservations: [],
		logScanCursors: [],
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

describe('database checkpoint fencing', () => {
	test('keeps reserved advisory-lock sessions alive between RPC operations', () => {
		expect(scannerDatabaseOptions(10, 5)).toEqual({
			max: 10,
			idleTimeout: 0,
			maxLifetime: 0,
			connectionTimeout: 5,
		})
	})

	test('waits for asynchronous reserved connection release', async () => {
		let finishRelease: (() => void) | undefined
		let settled = false
		const release = releaseReservedConnection({
			release: () =>
				new Promise<void>((resolve) => {
					finishRelease = resolve
				}),
		}).then(() => {
			settled = true
		})

		await Promise.resolve()
		expect(settled).toBe(false)
		finishRelease?.()
		await release
		expect(settled).toBe(true)
	})

	test('measures a full rewind from the configured history boundary', () => {
		expect(rewindDepth(1_250n, 1_000n, -1n)).toBe(251n)
		expect(rewindDepth(1_250n, 1_000n, 1_200n)).toBe(50n)
	})

	test('requires a canonical refresh only when an event cursor predates retained history', () => {
		expect(replayWindowExpired(8, 9)).toBe(true)
		expect(replayWindowExpired(9, 9)).toBe(false)
		expect(replayWindowExpired(0, 0)).toBe(false)
	})

	test('accepts only the configured first block or the direct checkpoint child', () => {
		const parentHash = blockHash('parent')
		const otherHash = blockHash('other')
		expect(() => assertBlockAppend({ number: 10n, parentHash }, { startBlock: 10n })).not.toThrow()
		expect(() => assertBlockAppend({ number: 10n, parentHash }, { startBlock: 10n, indexedHash: parentHash })).toThrow('block hash without a block number')
		expect(() => assertBlockAppend({ number: 11n, parentHash }, { startBlock: 10n })).toThrow('must start at block 10')
		expect(() => assertBlockAppend({ number: 11n, parentHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).not.toThrow()
		expect(() => assertBlockAppend({ number: 12n, parentHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).toThrow(
			'next database checkpoint must be block 11',
		)
		expect(() => assertBlockAppend({ number: 11n, parentHash: otherHash }, { startBlock: 10n, indexedBlock: 10n, indexedHash: parentHash })).toThrow(
			'does not extend the current database checkpoint',
		)
	})

	test('persists a log dataset cursor only at the block committed with it', () => {
		const cursor = { contractAddress: address, startBlock: 10n, lastRetrievedBlock: 25n }
		expect(() => assertLogScanCursorUpdate(25n, cursor)).not.toThrow()
		expect(() => assertLogScanCursorUpdate(24n, cursor)).toThrow('must advance to committed block 24')
		expect(() => assertLogScanCursorUpdate(25n, { ...cursor, startBlock: 26n })).toThrow('invalid retrieval boundary')
	})

	test('anchors deployment observations to their committing block', () => {
		expect(() => assertContractDeploymentObservation(10n, { contractAddress: address, checkedBlock: 9n })).toThrow('must be anchored to committed block 10')
		expect(() =>
			assertContractDeploymentObservation(10n, {
				contractAddress: address,
				checkedBlock: 10n,
				deployment: { block: 11n, timestamp: new Date(0), exact: true },
			}),
		).toThrow('invalid deployment boundary')
	})

	test('rejects changing the configured start boundary after indexing has begun', () => {
		expect(() => assertStartBlockCompatible(100n, 100n, 125n)).not.toThrow()
		expect(() => assertStartBlockCompatible(200n, 100n, undefined)).not.toThrow()
		expect(() => assertStartBlockCompatible(200n, 200n, 125n)).toThrow(
			'Stored checkpoint 125 is below configured start block 200; rebuild the augurScan database from the configured start block',
		)
		expect(() => assertStartBlockCompatible(200n, 100n, 125n)).toThrow(
			'Cannot change the configured start block from 100 to 200 while checkpoint 125 exists; rebuild the augurScan database from the new start block',
		)
		expect(() => assertStartBlockCompatible(100n, 75n, undefined, true)).toThrow('while an effective index start is retained')
	})

	test('accepts only a prior canonical rewind target', () => {
		const hash = blockHash('ancestor')
		const checkpoint = { indexedBlock: 11n, indexedHash: blockHash('head') }
		expect(() => assertRewindTarget(10n, hash, checkpoint, true)).not.toThrow()
		expect(() => assertRewindTarget(-1n, undefined, checkpoint, false)).not.toThrow()
		expect(() => assertRewindTarget(11n, hash, checkpoint, true)).toThrow('must precede')
		expect(() => assertRewindTarget(10n, hash, checkpoint, false)).toThrow('not a canonical stored block')
		expect(() => assertRewindTarget(-1n, hash, checkpoint, false)).toThrow('must not specify an ancestor hash')
		expect(() => assertRewindTarget(10n, hash, { indexedBlock: 11n }, true)).toThrow('complete indexed checkpoint')
	})
})

postgresTest('rejects every public namespace object before fresh schema initialization', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	const resetPublicSchema = async (): Promise<void> => {
		await database.sql.unsafe('DROP SCHEMA public CASCADE')
		await database.sql.unsafe('CREATE SCHEMA public')
	}
	const applicationTableCount = async (): Promise<number> => {
		const rows = await database.sql`
			SELECT count(*)::integer AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'
		`
		return Number(rows[0]?.count)
	}
	try {
		await resetPublicSchema()
		await database.sql.unsafe("CREATE COLLATION public.legacy_collation (provider = libc, locale = 'C')")
		await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		expect(await applicationTableCount()).toBe(0)

		await resetPublicSchema()
		await database.sql.unsafe('CREATE OPERATOR public.## (FUNCTION = pg_catalog.int4pl, LEFTARG = int4, RIGHTARG = int4)')
		await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		expect(await applicationTableCount()).toBe(0)
	} finally {
		await resetPublicSchema()
		await initializeSchema(database.sql)
		await database.close()
	}
})

postgresTest('initializes, resumes, retains an orphan, and serves only its canonical replacement', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	try {
		await initializeSchema(database.sql)
		const concurrentMigrator = new ScannerDatabase(postgresUrl)
		try {
			await Promise.all([initializeSchema(database.sql), initializeSchema(concurrentMigrator.sql)])
			await initializeSchema(concurrentMigrator.sql)
		} finally {
			await concurrentMigrator.close()
		}
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.sql.unsafe('TRUNCATE TABLE live_events RESTART IDENTITY')
		await database.sql`UPDATE live_event_state SET pruned_through_id = 0, updated_at = now() WHERE singleton`
		const concurrentWriter = new ScannerDatabase(postgresUrl)
		try {
			let firstLocked: (() => void) | undefined
			let releaseFirst: (() => void) | undefined
			const locked = new Promise<void>((resolve) => {
				firstLocked = resolve
			})
			const release = new Promise<void>((resolve) => {
				releaseFirst = resolve
			})
			const firstWrite = database.sql.begin(async (transaction) => {
				await lockLiveEventWriter(transaction)
				const rows = await transaction`INSERT INTO live_events (event, payload) VALUES ('status', '{"writer":1}'::jsonb) RETURNING id`
				firstLocked?.()
				await release
				return Number(rows[0]?.['id'])
			})
			await locked
			let secondInserted = false
			const secondWrite = concurrentWriter.sql.begin(async (transaction) => {
				await lockLiveEventWriter(transaction)
				const rows = await transaction`INSERT INTO live_events (event, payload) VALUES ('status', '{"writer":2}'::jsonb) RETURNING id`
				secondInserted = true
				return Number(rows[0]?.['id'])
			})
			await Bun.sleep(25)
			expect(secondInserted).toBe(false)
			releaseFirst?.()
			expect(await Promise.all([firstWrite, secondWrite])).toEqual([1, 2])
		} finally {
			await concurrentWriter.close()
		}
		await database.sql.unsafe('TRUNCATE TABLE live_events RESTART IDENTITY')
		await database.sql`INSERT INTO live_events (event, payload, created_at) VALUES ('status', '{}'::jsonb, now() - interval '8 days')`
		await database.pruneLiveEvents()
		expect(await database.eventsAfter(0)).toEqual([{ id: 1, event: 'reset', payload: { reason: 'replay-window-expired', refreshRequired: true } }])
		const network: NetworkConfig = {
			id: 'integration',
			name: 'Integration chain',
			chainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 8n,
			contracts: [[address, 'Manifest contract', 'zoltar']],
		}
		expect(await database.seedNetwork(network)).toBe(false)
		expect(await database.networkStartBlock(chainId)).toBe(1n)
		await expect(database.seedNetwork({ ...network, startBlock: 3n }, undefined, false, true)).rejects.toThrow('while an effective index start is retained')
		expect(await database.networkStartBlock(chainId)).toBe(1n)
		const zeroBoundaryNetwork = { ...network, id: 'zero-boundary', chainId: chainId + 1, startBlock: 0n }
		expect(await database.seedNetwork(zeroBoundaryNetwork)).toBe(false)
		await expect(database.seedNetwork({ ...zeroBoundaryNetwork, startBlock: 100n }, undefined, false, true)).rejects.toThrow(
			'while an effective index start is retained',
		)
		expect(await database.networkStartBlock(zeroBoundaryNetwork.chainId)).toBe(0n)
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

			const collisionLease = await database.tryAcquireIndexerLock(chainId)
			if (collisionLease === undefined) throw new Error('indexer did not acquire its lock for exact-key validation')
			await collisionLease.connection`SELECT pg_advisory_lock((92138472::bigint << 32) | ${chainId}::bigint)`
			await collisionLease.connection`SELECT pg_advisory_unlock(92138472, ${chainId})`
			await expect(collisionLease.assertHeld()).rejects.toThrow('Indexer lease is no longer held')
			await collisionLease.connection`SELECT pg_advisory_unlock((92138472::bigint << 32) | ${chainId}::bigint)`
			await expect(collisionLease.release()).rejects.toThrow('Indexer lease unlock failed')

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
		const wethDiscovery: ContractMetadata = {
			address: wethAddress,
			label: 'Wrapped Ether',
			kind: 'weth',
			provenance: 'test',
			discoveryBlock: 1n,
			discoveryTxHash: transactionHash,
		}
		const secondWethDiscovery: ContractMetadata = {
			...wethDiscovery,
			address: secondWethAddress,
			label: 'Wrapped Ether v2',
		}
		const first: IndexedBlock = {
			...indexedBlock('block-one', genesisHash, [initialDiscovery, wethDiscovery, secondWethDiscovery], undefined, [
				{ address: rediscoveredAddress, name: 'Original token', symbol: 'OLD', decimals: 18, readBlock: 1n },
				{ address: wethAddress, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, readBlock: 1n },
				{ address: secondWethAddress, name: 'Wrapped Ether v2', symbol: 'WETH2', decimals: 18, readBlock: 1n },
			]),
			logScanCursors: [{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 1n }],
		}
		await database.storeBlock(chainId, first, writeLease)
		expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
		expect(await database.logScanCursors(chainId)).toEqual(
			new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 1n, lastRetrievedBlock: 1n }]]),
		)
		await expect(database.seedNetwork({ ...network, startBlock: 3n }, writeLease)).rejects.toThrow(
			'Cannot change the configured start block from 1 to 3 while checkpoint 1 exists; rebuild the augurScan database from the new start block',
		)
		expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
		const unchangedBoundary = await database.sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
		expect(unchangedBoundary[0]?.['start_block']).toBe('1')
		await database.sql`UPDATE networks SET start_block = 3 WHERE chain_id = ${chainId}`
		await expect(database.seedNetwork({ ...network, startBlock: 3n }, writeLease)).rejects.toThrow(
			'Stored checkpoint 1 is below configured start block 3; rebuild the augurScan database from the configured start block',
		)
		expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
		const inconsistentBoundary = await database.sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
		expect(inconsistentBoundary[0]?.['start_block']).toBe('3')
		await database.sql`UPDATE networks SET start_block = 1 WHERE chain_id = ${chainId}`
		const invalidParent = indexedBlock('block-two-invalid-parent', genesisHash)
		await expect(database.storeBlock(chainId, invalidParent, writeLease)).rejects.toThrow('does not extend the current database checkpoint')
		expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
		const incomplete = { ...indexedBlock('block-two-incomplete', first.hash, [], 'incomplete event'), transactions: [] }
		await expect(database.storeBlock(chainId, incomplete, writeLease)).rejects.toThrow()
		expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
		const rolledBackRows = await database.sql`SELECT hash FROM blocks WHERE chain_id = ${chainId} AND hash = ${incomplete.hash}`
		expect(rolledBackRows).toHaveLength(0)

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
		const orphanBase = indexedBlock('block-two-orphan', first.hash, [discovery, promotedDiscovery, laterRediscovery, orphanOnlyDiscovery], 'orphan event', [
			{ address: discoveredAddress, readError: 'ERC-20 metadata unavailable', readBlock: 2n },
			{ address: rediscoveredAddress, name: 'Orphaned token', symbol: 'BAD', decimals: 6, readBlock: 2n },
		])
		const orphanPrice = repPriceLog(orphanBase.hash, '99000000000000000000')
		const orphan: IndexedBlock = {
			...orphanBase,
			logs: [...orphanBase.logs, orphanPrice],
			contractDeploymentObservations: [
				{
					contractAddress: address,
					checkedBlock: 2n,
					deployment: { block: 2n, timestamp: new Date('2026-01-02T00:00:00Z'), exact: true },
				},
			],
			logScanCursors: [
				{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 2n },
				{ contractAddress: discoveredAddress, startBlock: 2n, lastRetrievedBlock: 2n },
			],
		}
		await database.storeBlock(chainId, orphan, writeLease)
		expect(
			await database.seedNetwork(
				{
					...network,
					contracts: [
						[address, 'Corrected manifest contract', 'openOracle'],
						[promotedAddress, 'Promoted manifest helper', 'securityPool'],
					],
				},
				writeLease,
			),
		).toBe(true)
		const seededContracts = await database.contracts(chainId)
		expect(seededContracts.get(address.toLowerCase())).toMatchObject({ label: 'Corrected manifest contract', kind: 'openOracle', provenance: 'manifest' })
		expect(seededContracts.get(promotedAddress.toLowerCase())).toEqual({
			address: promotedAddress,
			label: 'Promoted manifest helper',
			kind: 'securityPool',
			provenance: 'manifest',
		})
		expect((await database.contracts(chainId)).get(address.toLowerCase())).toMatchObject({ deploymentBlock: 2n, deploymentCheckedBlock: 2n })
		await database.rewind(chainId, 1n, first.hash, writeLease)
		const canonicalOrphanPrices =
			await database.sql`SELECT * FROM rep_eth_price_snapshots WHERE chain_id = ${chainId} AND block_hash = ${orphan.hash} AND canonical`
		expect(canonicalOrphanPrices).toHaveLength(0)
		expect(await database.logScanCursors(chainId)).toEqual(
			new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 1n, lastRetrievedBlock: 1n }]]),
		)
		expect((await database.contracts(chainId)).get(address.toLowerCase())).not.toHaveProperty('deploymentBlock')
		expect((await database.contracts(chainId)).get(address.toLowerCase())).not.toHaveProperty('deploymentCheckedBlock')
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

		const replacementBase = indexedBlock('block-two-replacement', first.hash, [discovery], 'replacement event', [
			{ address: discoveredAddress, name: 'Replacement token', symbol: 'NEW', decimals: 18, readBlock: 2n },
		])
		const uniswapPairDiscovery: ContractMetadata = {
			address: uniswapPairAddress,
			label: 'Uniswap V2 REP / WETH Pair',
			kind: 'uniswapV2Pair',
			provenance: 'Uniswap V2 Factory.PairCreated',
			discoveryBlock: 2n,
			discoveryTxHash: transactionHash,
		}
		const inverseUniswapPairDiscovery: ContractMetadata = {
			address: inverseUniswapPairAddress,
			label: 'Uniswap V2 WETH / REP Pair',
			kind: 'uniswapV2Pair',
			provenance: 'Uniswap V2 Factory.PairCreated',
			discoveryBlock: 2n,
			discoveryTxHash: transactionHash,
		}
		const replacementPrices = priceHistoryLogs(replacementBase.hash)
		const replacement: IndexedBlock = {
			...replacementBase,
			contracts: [...replacementBase.contracts, uniswapPairDiscovery, inverseUniswapPairDiscovery],
			logs: [...replacementBase.logs, vaultCheckpoint(replacementBase.hash), ...replacementPrices],
			addressActivity: [{ transactionHash, address, poolAddress: discoveredAddress, role: 'sender' }],
			logScanCursors: [
				{ contractAddress: address, startBlock: 1n, lastRetrievedBlock: 2n },
				{ contractAddress: discoveredAddress, startBlock: 2n, lastRetrievedBlock: 2n },
			],
		}
		await database.storeBlock(chainId, replacement, writeLease)
		const poolHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/pools/${chainId}/${discoveredAddress.toLowerCase()}`), database.sql)
		if (poolHistoryResponse === undefined) throw new Error('pool history API did not return a response')
		const poolHistory = await poolHistoryResponse.json()
		if (
			typeof poolHistory !== 'object' ||
			poolHistory === null ||
			Array.isArray(poolHistory) ||
			!('market' in poolHistory) ||
			!('ammPrices' in poolHistory) ||
			!('repEthPrices' in poolHistory) ||
			!('uniswapRepEthPrices' in poolHistory)
		)
			throw new Error('pool history API returned an invalid price payload')
		expect(poolHistory.market).toEqual({
			chain_id: chainId.toString(),
			block_hash: replacement.hash,
			tx_hash: transactionHash,
			log_index: 3,
			block_number: '2',
			pair_address: pairAddress.toLowerCase(),
			pool_address: discoveredAddress.toLowerCase(),
			share_token_address: wethAddress.toLowerCase(),
			universe_id: '0',
			fee_bps: '30',
			canonical: true,
			timestamp: '2026-01-02T00:00:00.000Z',
		})
		expect(poolHistory.ammPrices).toEqual([
			{
				chain_id: chainId.toString(),
				block_hash: replacement.hash,
				tx_hash: transactionHash,
				log_index: 4,
				block_number: '2',
				pair_address: pairAddress.toLowerCase(),
				yes_reserve_atto_shares: '300000000000000000000',
				no_reserve_atto_shares: '700000000000000000000',
				conditional_yes_bps: '7000',
				conditional_no_bps: '3000',
				canonical: true,
				timestamp: '2026-01-02T00:00:00.000Z',
			},
		])
		expect(poolHistory.repEthPrices).toEqual([
			{
				chain_id: chainId.toString(),
				block_hash: replacement.hash,
				tx_hash: transactionHash,
				log_index: 5,
				block_number: '2',
				coordinator_address: promotedAddress.toLowerCase(),
				event_name: 'PriceReported',
				report_id: '42',
				rep_per_eth_1e18: '19500000000000000000',
				settlement_timestamp: '2026-01-02T00:00:00.000Z',
				canonical: true,
				timestamp: '2026-01-02T00:00:00.000Z',
			},
		])
		expect(poolHistory.uniswapRepEthPrices).toEqual([
			{
				chain_id: chainId.toString(),
				block_hash: replacement.hash,
				tx_hash: transactionHash,
				log_index: 8,
				block_number: '2',
				venue: 'v2',
				market_id: uniswapPairAddress.toLowerCase(),
				event_name: 'Sync',
				contract_address: uniswapPairAddress.toLowerCase(),
				token0_address: rediscoveredAddress.toLowerCase(),
				token1_address: wethAddress.toLowerCase(),
				fee_hundredths_bip: '3000',
				tick_spacing: null,
				hooks_address: null,
				quote_symbol: 'WETH',
				quote_token_address: wethAddress.toLowerCase(),
				rep_per_eth_1e18: '18000000000000000000',
				timestamp: '2026-01-02T00:00:00.000Z',
			},
			{
				chain_id: chainId.toString(),
				block_hash: replacement.hash,
				tx_hash: transactionHash,
				log_index: 10,
				block_number: '2',
				venue: 'v2',
				market_id: inverseUniswapPairAddress.toLowerCase(),
				event_name: 'Sync',
				contract_address: inverseUniswapPairAddress.toLowerCase(),
				token0_address: wethAddress.toLowerCase(),
				token1_address: rediscoveredAddress.toLowerCase(),
				fee_hundredths_bip: '3000',
				tick_spacing: null,
				hooks_address: null,
				quote_symbol: 'WETH',
				quote_token_address: wethAddress.toLowerCase(),
				rep_per_eth_1e18: '24000000000000000000',
				timestamp: '2026-01-02T00:00:00.000Z',
			},
		])
		await database.storeRichListBalances(
			chainId,
			2n,
			replacement.hash,
			[
				{ owner: address, assetAddress: getAddress('0x0000000000000000000000000000000000000000'), assetKind: 'native', balance: 2_000_000_000_456_789_123n },
				{ owner: address, assetAddress: rediscoveredAddress, assetKind: 'rep', balance: 3_000_000_000_000_000_000n },
				{ owner: address, assetAddress: wethAddress, assetKind: 'weth', balance: 1_234_567_890_123_456_789n },
				{ owner: address, assetAddress: secondWethAddress, assetKind: 'weth', balance: 222_222_222_222_222_222n },
			],
			writeLease,
		)
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
		expect(metadataRows.find((row: Record<string, unknown>) => row['block_hash'] === replacement.hash)).toMatchObject({ canonical: true, decimals: 18 })

		const standardV4MarketId = uniswapV4PoolId(rediscoveredAddress, 3_000, 60)
		const nonstandardV4MarketId = uniswapV4PoolId(rediscoveredAddress, 250, 5)
		const uniswapV4PoolManagerDiscovery: ContractMetadata = {
			address: uniswapV4PoolManagerAddress,
			label: 'Uniswap V4 PoolManager',
			kind: 'uniswapV4PoolManager',
			provenance: 'test',
			discoveryBlock: 3n,
			discoveryTxHash: transactionHash,
		}
		const v4Initialize = (logIndex: number, marketId: string, fee: string, tickSpacing: string): StoredLog => ({
			...decodedLog(blockHash('block-three'), logIndex, uniswapV4PoolManagerAddress, 'Initialize', {
				id: marketId,
				currency0: '0x0000000000000000000000000000000000000000',
				currency1: rediscoveredAddress,
				fee,
				tickSpacing,
				hooks: '0x0000000000000000000000000000000000000000',
				sqrtPriceX96: (2n ** 96n).toString(),
			}),
			blockNumber: 3n,
		})
		const third: IndexedBlock = {
			...indexedBlock('block-three', replacement.hash, [uniswapV4PoolManagerDiscovery], 'batched V4 initializations'),
			number: 3n,
			timestamp: new Date('2026-01-03T00:00:00Z'),
			observedHead: 3n,
			logs: [v4Initialize(1, standardV4MarketId, '3000', '60'), v4Initialize(2, nonstandardV4MarketId, '250', '5')],
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
			await expect(database.recordFailure(chainId, 'stale former owner', new Date(), lostWriteLease)).rejects.toThrow()
			const statusRows = await failover.sql`SELECT phase, last_error FROM networks WHERE chain_id = ${chainId}`
			expect(statusRows[0]).toMatchObject({ phase: 'live', last_error: null })
		} finally {
			await failover.close()
		}
		const storedV4Markets =
			await database.sql`SELECT market_id FROM uniswap_rep_eth_markets WHERE chain_id = ${chainId} AND block_hash = ${third.hash} AND canonical ORDER BY market_id`
		expect(storedV4Markets).toEqual([{ market_id: standardV4MarketId }])
		const storedV4Observations =
			await database.sql`SELECT market_id FROM uniswap_rep_eth_price_observations WHERE chain_id = ${chainId} AND block_hash = ${third.hash} AND canonical ORDER BY market_id`
		expect(storedV4Observations).toEqual([{ market_id: standardV4MarketId }])
		const readIsolation = await database.read(async (sql) => {
			const rows = await sql`SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only`
			return rows[0]
		})
		expect(readIsolation).toMatchObject({ isolation: 'repeatable read', read_only: 'on' })
		const reorgWriter = new ScannerDatabase(postgresUrl)
		try {
			const snapshotStayedCanonical = await database.read(async (sql) => {
				const before = await sql`SELECT canonical FROM blocks WHERE chain_id = ${chainId} AND hash = ${third.hash}`
				expect(before[0]?.['canonical']).toBe(true)
				await reorgWriter.sql`UPDATE blocks SET canonical = false WHERE chain_id = ${chainId} AND hash = ${third.hash}`
				const after = await sql`SELECT canonical FROM blocks WHERE chain_id = ${chainId} AND hash = ${third.hash}`
				return after[0]?.['canonical']
			})
			expect(snapshotStayedCanonical).toBe(true)
		} finally {
			await reorgWriter.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${chainId} AND hash = ${third.hash}`
			await reorgWriter.close()
		}
		await database.seedNetwork({ ...network, contracts: [[orphanOnlyAddress, 'New child REP', 'reputationToken']] })

		const response = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}`), database.sql)
		if (response === undefined) throw new Error('logs API did not return a response')
		const payload = (await response.json()) as { items: Array<{ summary: string; block_hash: string; origin_address: string }> }
		expect(payload.items).toHaveLength(2)
		expect(payload.items).toContainEqual(expect.objectContaining({ summary: 'replacement event', block_hash: replacement.hash }))
		expect(payload.items[0]?.origin_address).toBe(address.toLowerCase())
		const orphanDetailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${orphan.hash}/${transactionHash}/0`), database.sql)
		expect(orphanDetailResponse?.status).toBe(404)
		expect(await orphanDetailResponse?.json()).toEqual({ error: 'Log not found' })
		const senderLogsResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&address=${address.toLowerCase()}`), database.sql)
		if (senderLogsResponse === undefined) throw new Error('sender-filtered logs API did not return a response')
		const senderLogs = (await senderLogsResponse.json()) as { items: Array<{ origin_address: string; arguments: Record<string, unknown> }> }
		expect(senderLogs.items).toHaveLength(2)
		expect(senderLogs.items.every((item) => item.origin_address === address.toLowerCase())).toBe(true)
		expect(senderLogs.items.every((item) => !JSON.stringify(item.arguments).toLowerCase().includes(address.toLowerCase()))).toBe(true)
		const detailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${replacement.hash}/${transactionHash}/0`), database.sql)
		if (detailResponse === undefined) throw new Error('log detail API did not return a response')
		const detail = (await detailResponse.json()) as { receipt: { logs: unknown[] }; argument_schema: unknown[]; origin_address: string }
		expect(isLogDetailValue(detail)).toBeTrue()
		expect(detail.receipt.logs).toHaveLength(1)
		expect(detail.argument_schema).toEqual([])
		expect(detail.origin_address).toBe(address.toLowerCase())
		await database.sql`UPDATE contracts SET canonical = false WHERE chain_id = ${chainId} AND address = ${discoveredAddress.toLowerCase()}`
		try {
			const identitylessListResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}`), database.sql)
			if (identitylessListResponse === undefined) throw new Error('identityless logs API did not return a response')
			const identitylessList = (await identitylessListResponse.json()) as { items: Array<Record<string, unknown>> }
			expect(identitylessList.items.find((item) => item['block_hash'] === replacement.hash)).toMatchObject({
				contract_label: null,
				contract_kind: null,
			})
			const identitylessDetailResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs/${chainId}/${replacement.hash}/${transactionHash}/0`),
				database.sql,
			)
			if (identitylessDetailResponse === undefined) throw new Error('identityless log detail API did not return a response')
			expect(await identitylessDetailResponse.json()).toMatchObject({
				contract_label: null,
				contract_kind: null,
				contract_provenance: null,
			})
		} finally {
			await database.sql`UPDATE contracts SET canonical = true WHERE chain_id = ${chainId} AND address = ${discoveredAddress.toLowerCase()}`
		}
		await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			SELECT ${chainId}, '0x' || lpad(to_hex(sequence), 64, '0'), ${third.hash}, 3, sequence, ${address.toLowerCase()},
				${discoveredAddress.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true
			FROM generate_series(1, 60) sequence
		`
		const referencedOnlyTransactionHash = blockHash('calldata-only-address-reference')
		await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			VALUES (${chainId}, ${referencedOnlyTransactionHash}, ${third.hash}, 3, 61, ${discoveredAddress.toLowerCase()},
				${address.toLowerCase()}, 0, '0x1234', 'success', 42000, '{}'::jsonb, true)
		`
		await database.sql`
			INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, function_name, function_signature, arguments, display_arguments, argument_schema, decode_status, summary)
			VALUES (${chainId}, ${third.hash}, ${referencedOnlyTransactionHash}, ${address.toLowerCase()}, 'reportFor', 'reportFor(address)',
				${JSON.stringify({ participant: referencedOnlyAddress.toLowerCase() })}::jsonb,
				${JSON.stringify({ participant: referencedOnlyAddress.toLowerCase() })}::jsonb,
				${JSON.stringify([{ index: 0, name: 'participant', type: 'address' }])}::jsonb, 'decoded', 'reportFor')
		`
		await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			VALUES (${chainId}, ${third.hash}, 3, ${referencedOnlyTransactionHash}, ${referencedOnlyAddress.toLowerCase()},
				'0x0000000000000000000000000000000000000000', 'referenced', true)
		`
		const newerSenderTransactionHash = blockHash('newer-sender-only-address-activity')
		await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			VALUES (${chainId}, ${newerSenderTransactionHash}, ${third.hash}, 3, 62, ${referencedOnlyAddress.toLowerCase()},
				${address.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
		await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			VALUES (${chainId}, ${third.hash}, 3, ${newerSenderTransactionHash}, ${referencedOnlyAddress.toLowerCase()},
				'0x0000000000000000000000000000000000000000', 'sender', true)
		`
		const interactionsResponse = await handleApi(
			new Request(`http://localhost/api/v1/address-interactions?chainId=${chainId}&address=${referencedOnlyAddress}&limit=1`),
			database.sql,
		)
		if (interactionsResponse === undefined) throw new Error('address interactions API did not return a response')
		const interactionsPayload: unknown = await interactionsResponse.json()
		expect(interactionsPayload).toMatchObject({
			items: [
				{
					tx_hash: referencedOnlyTransactionHash,
					roles: ['referenced'],
					pool_addresses: null,
					function_name: 'reportFor',
					action_arguments: { participant: referencedOnlyAddress.toLowerCase() },
				},
			],
			limit: 1,
		})
		if (!isRecord(interactionsPayload) || !Array.isArray(interactionsPayload['items'])) throw new Error('address interactions API returned malformed items')
		expect(interactionsPayload['items'].every(isAccountTransactionValue)).toBeTrue()
		const transactionsResponse = await handleApi(
			new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50`),
			database.sql,
		)
		if (transactionsResponse === undefined) throw new Error('address transactions API did not return a response')
		const transactions = (await transactionsResponse.json()) as {
			items: Array<Record<string, unknown>>
			nextCursor: string
			snapshotBlock: string
			total: number
		}
		expect(transactions).toMatchObject({ total: 61, snapshotBlock: '3' })
		expect(transactions.items).toHaveLength(50)
		await database.sql`UPDATE blocks SET canonical = false WHERE chain_id = ${chainId} AND hash = ${third.hash}`
		const staleCursorResponse = await handleApi(
			new Request(
				`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50&cursor=${encodeURIComponent(transactions.nextCursor)}`,
			),
			database.sql,
		)
		expect(staleCursorResponse?.status).toBe(409)
		expect(await staleCursorResponse?.json()).toEqual({ error: 'Transaction history changed; restart pagination' })
		const canonicalOnlyTransactionsResponse = await handleApi(
			new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50`),
			database.sql,
		)
		if (canonicalOnlyTransactionsResponse === undefined) throw new Error('canonical-only address transaction page did not return a response')
		expect(await canonicalOnlyTransactionsResponse.json()).toMatchObject({ total: 1, snapshotBlock: '2' })
		await database.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${chainId} AND hash = ${third.hash}`
		const alteredCursorParts = JSON.parse(atob(transactions.nextCursor)) as [number, string, string, string, number, string, number]
		alteredCursorParts[4]++
		const alteredTotalResponse = await handleApi(
			new Request(
				`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50&cursor=${encodeURIComponent(btoa(JSON.stringify(alteredCursorParts)))}`,
			),
			database.sql,
		)
		expect(alteredTotalResponse?.status).toBe(409)
		expect(await alteredTotalResponse?.json()).toEqual({ error: 'Transaction history changed; restart pagination' })
		const fourthHash = blockHash('block-four-direct')
		await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES (${chainId}, 4, ${fourthHash}, ${third.hash}, '2026-01-04T00:00:00Z', true)`
		await database.sql`
			INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
			VALUES (${chainId}, ${blockHash('newer-address-transaction')}, ${fourthHash}, 4, 0, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
		const secondPageResponse = await handleApi(
			new Request(
				`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=50&cursor=${encodeURIComponent(transactions.nextCursor)}`,
			),
			database.sql,
		)
		if (secondPageResponse === undefined) throw new Error('second address transaction page did not return a response')
		const secondPage = (await secondPageResponse.json()) as { items: Array<Record<string, unknown>>; nextCursor?: string; total: number }
		const snapshotItems = [...transactions.items, ...secondPage.items]
		expect(secondPage).toMatchObject({ total: 61 })
		expect(secondPage.nextCursor).toBeUndefined()
		expect(snapshotItems).toHaveLength(61)
		expect(new Set(snapshotItems.map((item) => item['tx_hash'])).size).toBe(61)
		expect(snapshotItems).toContainEqual(
			expect.objectContaining({
				tx_hash: transactionHash,
				from_address: address.toLowerCase(),
				block_hash: replacement.hash,
				action_summary: 'Unknown call',
			}),
		)
		expect(snapshotItems.some((item) => item['block_hash'] === fourthHash)).toBe(false)
		const currentTransactionsResponse = await handleApi(
			new Request(`http://localhost/api/v1/address-transactions?chainId=${chainId}&address=${address}&limit=1`),
			database.sql,
		)
		if (currentTransactionsResponse === undefined) throw new Error('current address transaction page did not return a response')
		expect(await currentTransactionsResponse.json()).toMatchObject({ total: 62, snapshotBlock: '4' })
		const richListResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}`), database.sql)
		if (richListResponse === undefined) throw new Error('rich-list API did not return a response')
		const richList = (await richListResponse.json()) as {
			items: Array<
				Record<string, unknown> & {
					rep_balances: Array<Record<string, unknown>>
					pool_associations: Array<Record<string, unknown>>
					vault_positions: Array<Record<string, unknown>>
					weth_balances: Array<Record<string, unknown>>
					native_balance_detail: Record<string, unknown>
				}
			>
			total: number
		}
		expect(richList.total).toBe(1)
		expect(richList.items[0]).toMatchObject({
			address: address.toLowerCase(),
			transaction_count: '1',
			interaction_count: '1',
			pool_count: '1',
			native_balance: '2000000000456789123',
			weth_balance: '1456790112345679011',
			weth_token_count: '2',
			sampled_weth_token_count: '2',
			rep_token_count: '2',
			sampled_rep_token_count: '1',
		})
		const addressProfileResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&address=${address}`), database.sql)
		if (addressProfileResponse === undefined) throw new Error('address profile query did not return a response')
		expect(await addressProfileResponse.json()).toMatchObject({
			total: 1,
			items: [expect.objectContaining({ address: address.toLowerCase(), pool_count: '1', vault_count: '1' })],
		})
		const addressIdentityResponse = await handleApi(
			new Request(`http://localhost/api/v1/address-identity?chainId=${chainId}&address=${discoveredAddress}`),
			database.sql,
		)
		if (addressIdentityResponse === undefined) throw new Error('address identity query did not return a response')
		expect(await addressIdentityResponse.json()).toMatchObject({
			address: discoveredAddress.toLowerCase(),
			label: 'Discovered pool',
			kind: 'securityPool',
		})
		expect(richList.items[0]?.rep_balances).toEqual([
			expect.objectContaining({
				address: rediscoveredAddress.toLowerCase(),
				balance: '3000000000000000000',
				symbol: 'OLD',
				contractLabel: 'Original discovery',
			}),
		])
		expect(richList.items[0]?.weth_balances).toEqual([
			expect.objectContaining({ address: wethAddress.toLowerCase(), balance: '1234567890123456789', symbol: 'WETH' }),
			expect.objectContaining({ address: secondWethAddress.toLowerCase(), balance: '222222222222222222', symbol: 'WETH2' }),
		])
		expect(richList.items[0]?.native_balance_detail).toEqual({ balance: '2000000000456789123', blockNumber: '2' })
		expect(richList.items[0]?.pool_associations).toEqual([expect.objectContaining({ address: discoveredAddress.toLowerCase() })])
		expect(richList.items[0]?.vault_positions).toEqual([
			expect.objectContaining({
				poolAddress: discoveredAddress.toLowerCase(),
				repBackingUnits: '120000000000000000000',
				capacityOwnershipAttoRep: 85_000_000_000_000_000_000n.toString(),
				claimableFeesAttoEth: 30_000_000_000_000_000n.toString(),
				blockNumber: '2',
			}),
		])
		const beyondEndResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&offset=1`), database.sql)
		if (beyondEndResponse === undefined) throw new Error('offset rich-list API did not return a response')
		const beyondEnd = (await beyondEndResponse.json()) as { items: unknown[]; total: number }
		expect(beyondEnd).toMatchObject({ items: [], total: 1 })
		const balanceLease = await database.tryAcquireIndexerLock(chainId)
		if (balanceLease === undefined) throw new Error('balance refresher did not acquire its lock')
		await database.storeRichListBalances(
			chainId,
			3n,
			third.hash,
			[
				{ owner: address, assetAddress: getAddress('0x0000000000000000000000000000000000000000'), assetKind: 'native', balance: 2_000_000_000_000_000_000n },
				{ owner: address, assetAddress: rediscoveredAddress, assetKind: 'rep', balance: 3_000_000_000_000_000_000n },
				{ owner: address, assetAddress: orphanOnlyAddress, assetKind: 'rep', balance: 4_000_000_000_000_000_000n },
			],
			balanceLease,
		)
		await balanceLease.release()
		const refreshedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}`), database.sql)
		if (refreshedResponse === undefined) throw new Error('refreshed rich-list API did not return a response')
		const refreshed = (await refreshedResponse.json()) as { items: Array<Record<string, unknown>> }
		expect(refreshed.items[0]).toMatchObject({ rep_token_count: '2', sampled_rep_token_count: '2' })
		expect(refreshed.items[0]).not.toHaveProperty('rep_balance')

		const extraRepTokens = Array.from({ length: 101 }, (_, index) =>
			getAddress(`0x${(0x7000000000000000000000000000000000000000n + BigInt(index)).toString(16)}`),
		)
		await database.seedNetwork({
			...network,
			contracts: extraRepTokens.map((token, index) => [token, `Extra REP ${index + 1}`, 'reputationToken']),
		})
		const assetLimitLease = await database.tryAcquireIndexerLock(chainId)
		if (assetLimitLease === undefined) throw new Error('asset-limit writer did not acquire its lock')
		await database.storeRichListBalances(
			chainId,
			3n,
			third.hash,
			extraRepTokens.map((token, index) => ({ owner: address, assetAddress: token, assetKind: 'rep' as const, balance: BigInt(index + 1) })),
			assetLimitLease,
		)
		await assetLimitLease.release()
		const cappedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}`), database.sql)
		if (cappedResponse === undefined) throw new Error('capped rich-list API did not return a response')
		const capped = (await cappedResponse.json()) as { items: Array<Record<string, unknown> & { rep_balances: Array<{ address: string }> }> }
		expect(capped.items[0]).toMatchObject({ sampled_rep_token_count: '103', returned_rep_token_count: '100', rep_balances_truncated: true })
		expect(capped.items[0]?.rep_balances).toHaveLength(100)
		expect(capped.items[0]?.rep_balances.map((balance) => balance.address)).toEqual(
			[rediscoveredAddress, orphanOnlyAddress, ...extraRepTokens]
				.map((token) => token.toLowerCase())
				.toSorted()
				.slice(0, 100),
		)

		await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			SELECT ${chainId}, ${replacement.hash}, 2, ${transactionHash},
				'0x' || lpad(to_hex(participant), 40, '0'),
				'0x0000000000000000000000000000000000000000', 'referenced', true
			FROM generate_series(1, 5000) participant
			ON CONFLICT DO NOTHING
		`
		const largePageResponse = await database.read((sql) => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10`), sql), 8_000)
		if (largePageResponse === undefined) throw new Error('large rich-list page did not return a response')
		const largePage = (await largePageResponse.json()) as { items: unknown[]; total: number }
		expect(largePage).toMatchObject({ total: 5001 })
		expect(largePage.items).toHaveLength(10)
		const largeBeyondEndResponse = await database.read(
			(sql) => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10&offset=100000`), sql),
			8_000,
		)
		if (largeBeyondEndResponse === undefined) throw new Error('large beyond-end rich-list page did not return a response')
		const largeBeyondEnd = (await largeBeyondEndResponse.json()) as { items: unknown[]; total: number }
		expect(largeBeyondEnd).toMatchObject({ items: [], total: 5001 })

		const manifestResetLease = await database.tryAcquireIndexerLock(chainId)
		if (manifestResetLease === undefined) throw new Error('manifest reset did not acquire its lock')
		expect(await database.seedNetwork({ ...network, contracts: [[address, 'Final manifest', 'zoltar']] }, manifestResetLease, true)).toBe(true)
		await manifestResetLease.release()
		expect(await database.checkpoint(chainId)).toBeUndefined()
		expect(await database.networkStartBlock(chainId)).toBe(1n)
		expect(await database.hasStoredBlocks(chainId)).toBe(true)
		const resetNetworkRows = await database.sql`SELECT finalized_block FROM networks WHERE chain_id = ${chainId}`
		expect(resetNetworkRows[0]?.['finalized_block']).toBeNull()
		const canonicalHistory = await database.sql`
			SELECT
				(SELECT count(*) FROM logs WHERE chain_id = ${chainId} AND canonical)::integer AS logs,
				(SELECT count(*) FROM pools WHERE chain_id = ${chainId} AND canonical)::integer AS pools,
				(SELECT count(*) FROM address_activity WHERE chain_id = ${chainId} AND canonical)::integer AS activity
		`
		expect(canonicalHistory[0]).toMatchObject({ logs: 0, pools: 0, activity: 0 })
		expect([...(await database.contracts(chainId)).values()]).toEqual([{ address, label: 'Final manifest', kind: 'zoltar', provenance: 'manifest' }])
		const retiredManifestAddress = extraRepTokens[0]
		if (retiredManifestAddress === undefined) throw new Error('retired manifest fixture is unavailable')
		await database.upsertContract(chainId, {
			address: retiredManifestAddress,
			label: 'Rediscovered security pool',
			kind: 'securityPool',
			provenance: 'Factory.DeploySecurityPool',
			discoveryBlock: 4n,
			discoveryTxHash: transactionHash,
		})
		expect((await database.contracts(chainId)).get(retiredManifestAddress.toLowerCase())).toMatchObject({
			label: 'Rediscovered security pool',
			kind: 'securityPool',
			provenance: 'Factory.DeploySecurityPool',
		})
		expect(await database.seedNetwork({ ...network, contracts: [[address, 'Final manifest', 'zoltar']] })).toBe(false)
		const retainedHistoryLease = await database.tryAcquireIndexerLock(chainId)
		if (retainedHistoryLease === undefined) throw new Error('retained-history validation did not acquire its lock')
		await expect(database.seedNetwork({ ...network, startBlock: 100n }, retainedHistoryLease, true)).rejects.toThrow(
			'while an effective index start is retained',
		)
		await retainedHistoryLease.release()
		expect(await database.networkStartBlock(chainId)).toBe(1n)
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest(
	'stores operations snapshots, paginates entity evidence, and explains indexed access paths',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const operationsChainId = chainId + 20 + process.pid
		const oracle = discoveredAddress
		const hash = blockHash('operations-completion')
		const network: NetworkConfig = {
			id: `operations-integration-${operationsChainId}`,
			name: 'Operations integration chain',
			chainId: operationsChainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[oracle, 'OpenOracle', 'openOracle']],
		}
		try {
			await initializeSchema(database.sql)
			const schemaState = await database.sql`
				SELECT
					(SELECT count(*)::integer FROM live_event_state WHERE singleton AND pruned_through_id = 0) AS live_state_count,
					current_setting('search_path') AS search_path
			`
			expect(schemaState[0]).toMatchObject({ live_state_count: 1, search_path: '"$user", public' })
			await database.seedNetwork(network)
			const awaitingResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${operationsChainId}`), database.sql)
			if (awaitingResponse === undefined) throw new Error('awaiting operations endpoint did not return a response')
			expect(awaitingResponse.status).toBe(200)
			expect(await awaitingResponse.json()).toMatchObject({
				asOf: { blockNumber: '0', blockTimestamp: '0', availability: 'Awaiting indexed evidence' },
				data: { reports: [], escalations: [], auctions: [] },
			})
			const lease = await database.tryAcquireIndexerLock(operationsChainId)
			if (lease === undefined) throw new Error('operations integration writer did not acquire its lock')
			try {
				const storedTransaction = { ...transaction(), hash: transactionHash, to: oracle }
				const reportData = {
					reportId: '7',
					numReports: '1',
					flags: '1',
					reportTimestamp: '1767225600',
					disputeDelay: '10',
					settlementTime: '30',
					currentAmount1: '100',
					currentAmount2: '5',
				}
				const submitted = { ...decodedLog(hash, 0, oracle, 'ReportSubmitted', reportData), blockNumber: 1n }
				const disputed = { ...decodedLog(hash, 1, oracle, 'ReportDisputed', { ...reportData, numReports: '2' }), blockNumber: 1n, transactionHash }
				const approvalId = `0x${'a'.repeat(64)}`
				const approvalEvidence: Array<{ name: string; argumentsValue: Record<string, unknown> }> = [
					{
						name: 'LiquidationApprovalSet',
						argumentsValue: { approvalId, receiverVault: address, operator: discoveredAddress, securityPool: oracle, targetVault: address },
					},
					{ name: 'LiquidationApprovalReserved', argumentsValue: { approvalId, operationId: '1', reservedDebtAttoEth: 10n.toString() } },
					{ name: 'LiquidationApprovalReleased', argumentsValue: { approvalId, operationId: '1', releasedDebtAttoEth: 2n.toString() } },
					{ name: 'LiquidationApprovalConsumed', argumentsValue: { approvalId, operationId: '1', consumedDebtAttoEth: 8n.toString() } },
					{ name: 'LiquidationApprovalRevoked', argumentsValue: { approvalId, receiverVault: address } },
					{ name: 'LiquidationApprovalNonceInvalidated', argumentsValue: { receiverVault: address, previousNonce: '1', newNonce: '2' } },
				]
				const approvalEvents = approvalEvidence.map(({ name, argumentsValue }, index) => ({
					...decodedLog(hash, index + 2, oracle, name, argumentsValue),
					blockNumber: 1n,
				}))
				await database.storeBlock(
					operationsChainId,
					{
						number: 1n,
						hash,
						parentHash: blockHash('operations-parent'),
						timestamp: new Date('2026-01-01T00:00:20Z'),
						observedHead: 1n,
						finalizedThrough: 1n,
						contracts: [],
						tokenMetadata: [],
						transactions: [storedTransaction],
						logs: [submitted, disputed, ...approvalEvents],
						addressActivity: [],
						contractDeploymentObservations: [],
						logScanCursors: [],
					},
					lease,
				)
				const storedApprovalEvents = await database.sql`
					SELECT event_name FROM liquidation_approval_events
					WHERE chain_id = ${operationsChainId} AND canonical ORDER BY log_index
				`
				expect(storedApprovalEvents.map((row: Record<string, unknown>) => row['event_name'])).toEqual([
					'LiquidationApprovalSet',
					'LiquidationApprovalReserved',
					'LiquidationApprovalReleased',
					'LiquidationApprovalConsumed',
					'LiquidationApprovalRevoked',
					'LiquidationApprovalNonceInvalidated',
				])
				const indexedOperationsResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${operationsChainId}`), database.sql)
				if (indexedOperationsResponse === undefined) throw new Error('indexed operations endpoint did not return a response')
				const indexedOperations = (await indexedOperationsResponse.json()) as {
					data: { risk: { approvalEvents: Array<{ event_name: string }> } }
				}
				expect(indexedOperations.data.risk.approvalEvents).toHaveLength(6)
				expect(indexedOperations.data.risk.approvalEvents.map((event) => event.event_name)).toContain('LiquidationApprovalNonceInvalidated')
				await database.storeEntityStateSnapshots(
					operationsChainId,
					1n,
					hash,
					new Date('2026-01-01T00:00:20Z'),
					[
						{
							entityType: 'auction',
							entityIdentity: oracle.toLowerCase(),
							sourceMethod: 'augurscan.auction-state.v1',
							readStatus: 'success',
							readResult: { finalized: false, activeTickCount: '2' },
						},
					],
					lease,
				)
			} finally {
				await lease.release()
			}

			await database.sql`
			INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical, finalized)
			SELECT ${operationsChainId}, item,
				'0x' || lpad(to_hex(item), 64, '0'),
				'0x' || lpad(to_hex(item - 1), 64, '0'),
				timestamptz '2026-01-01 00:00:20+00' + make_interval(secs => item), true, true
			FROM generate_series(2, 10003) item
		`
			await database.sql`
			INSERT INTO transactions (
				chain_id, hash, block_hash, block_number, transaction_index,
				from_address, to_address, value, input, status, gas_used, receipt, canonical
			)
			SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'),
				'0x' || lpad(to_hex(item), 64, '0'), item, 0,
				${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true
			FROM generate_series(2, 10003) item
		`
			await database.sql`
			INSERT INTO logs (
				chain_id, tx_hash, block_hash, block_number, transaction_index, log_index,
				emitter_address, topics, data, event_name, arguments, argument_schema,
				decode_status, summary, canonical, finalized
			)
			SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'),
				'0x' || lpad(to_hex(item), 64, '0'), item, 0, 0,
				${oracle.toLowerCase()}, '[]'::jsonb, '0x', 'Swap',
				jsonb_build_object('yesForNo', true, 'amountIn', '1', 'amountOut', '1', 'feeAmount', '1',
					'resultingYesReserve', item::text, 'resultingNoReserve', (item * 2)::text),
				'[]'::jsonb, 'decoded', 'Swap', true, true
			FROM generate_series(2, 10003) item
		`
			await database.sql`
			INSERT INTO amm_trade_events (
				chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
			)
			SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'),
				'0x' || lpad(to_hex(item + 20000), 64, '0'), 0, item, ${oracle.toLowerCase()}, 'Swap',
				jsonb_build_object('yesForNo', true, 'amountIn', '1', 'amountOut', '1', 'feeAmount', '1',
					'resultingYesReserve', item::text, 'resultingNoReserve', (item * 2)::text), true
			FROM generate_series(2, 10003) item
		`
			await database.sql`
			UPDATE networks SET indexed_block = 10003,
				indexed_hash = ${`0x${(10003).toString(16).padStart(64, '0')}`},
				indexed_timestamp = timestamptz '2026-01-01 00:00:20+00' + make_interval(secs => 10003),
				observed_block = 10003, finalized_block = 10003
			WHERE chain_id = ${operationsChainId}
		`
			await database.sql`
			INSERT INTO pools (
				chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
				universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
				security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
				initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
			) VALUES (
				${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				1, 1, ${address.toLowerCase()}, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				15000, 0, 0, 0, true
			)
		`
			await database.sql`
			INSERT INTO vault_snapshots (
				chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address,
				rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index,
				vault_fee_remainder, resulting_total_rep_backing_units,
				resulting_fee_eligible_capacity_ownership_atto_rep, canonical
			) VALUES (
				${operationsChainId}, ${hash}, ${transactionHash}, 1, 1, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				100, 100, 0, 0, 0, 100, 100, true
			)
		`
			await database.sql`
			INSERT INTO entity_state_snapshots (
				chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
				source_method, read_status, read_result, canonical
			) VALUES
			(
				${operationsChainId}, 'pool', ${oracle.toLowerCase()}, 1, ${hash}, timestamptz '2026-01-01 00:00:20+00',
				'augurscan.pool-risk.v1', 'success',
				jsonb_build_object('settlementCollateralAttoEth', '1', 'currentMintingCapacityAttoEth', '2',
					'totalBadDebtAttoEth', '0', 'systemState', '1',
					'price', jsonb_build_object('repPerEth1e18', '100')), true
			),
			(
				${operationsChainId}, 'vault', ${`${oracle.toLowerCase()}:${address.toLowerCase()}`}, 2,
				${`0x${(2).toString(16).padStart(64, '0')}`}, timestamptz '2026-01-01 00:00:22+00',
				'augurscan.vault-risk.v1', 'success',
				jsonb_build_object('poolHeldBackingAttoRep', '200', 'disputeStakedAttoRep', '0',
					'openInterestAttoEth', '1000000000000000000', 'securityMultiplierBps', '15000',
					'targetHealthFactorBps', '12000', 'badDebtAttoEth', '0'), true
			)
		`

			const firstResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1`),
				database.sql,
			)
			if (firstResponse === undefined) throw new Error('report detail endpoint did not return a response')
			const first = (await firstResponse.json()) as { data: { rounds: { items: unknown[]; hasMore: boolean; nextCursor: string } } }
			expect(first.data.rounds).toMatchObject({ hasMore: true })
			expect(first.data.rounds.items).toHaveLength(1)
			const secondResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&cursor=${encodeURIComponent(first.data.rounds.nextCursor)}`,
				),
				database.sql,
			)
			if (secondResponse === undefined) throw new Error('report detail continuation did not return a response')
			const second = (await secondResponse.json()) as { data: { rounds: { items: unknown[]; hasMore: boolean } } }
			expect(second.data.rounds).toMatchObject({ hasMore: false })
			expect(second.data.rounds.items).toHaveLength(1)

			await database.sql`
			INSERT INTO transactions (
				chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address,
				value, input, status, gas_used, receipt, canonical
			) VALUES
			(${operationsChainId}, ${`0x${'e'.repeat(64)}`}, ${hash}, 1, 2, ${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true),
			(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${hash}, 1, 1, ${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
			await database.sql`
			INSERT INTO logs (
				chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
				topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
			) VALUES
			(${operationsChainId}, ${`0x${'e'.repeat(64)}`}, ${hash}, 1, 2, 2, ${oracle.toLowerCase()}, '[]'::jsonb,
				'0x', 'ReportSettled', jsonb_build_object('reportId', '7'), '[]'::jsonb, 'decoded', 'Report 7 settled', true, true),
			(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${hash}, 1, 1, 1, ${oracle.toLowerCase()}, '[]'::jsonb,
				'0x', 'ReportSubmitted', jsonb_build_object('reportId', '8'), '[]'::jsonb, 'decoded', 'Report 8', true, true)
		`
			await database.sql`
			INSERT INTO open_oracle_report_events (
				chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
				report_id, event_name, round_number, report_data, canonical
			) VALUES
			(${operationsChainId}, ${hash}, ${`0x${'e'.repeat(64)}`}, 2, 1, ${oracle.toLowerCase()}, 7,
				'ReportSettled', 2, jsonb_build_object('reportId', '7'), true),
			(${operationsChainId}, ${hash}, ${`0x${'f'.repeat(64)}`}, 1, 1, ${oracle.toLowerCase()}, 8,
				'ReportSubmitted', 1, jsonb_build_object('reportId', '8'), true)
		`
			const firstCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1`), database.sql)
			if (firstCatalogResponse === undefined) throw new Error('report catalog did not return a response')
			const firstCatalog = (await firstCatalogResponse.json()) as {
				data: { items: Array<{ report_id: string; tx_hash: string }>; nextCursor: string }
			}
			expect(firstCatalog.data.items).toHaveLength(1)
			expect(firstCatalog.data.items[0]).toMatchObject({ report_id: '7', tx_hash: `0x${'e'.repeat(64)}` })
			const secondCatalogResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1&cursor=${encodeURIComponent(firstCatalog.data.nextCursor)}`),
				database.sql,
			)
			if (secondCatalogResponse === undefined) throw new Error('report catalog continuation did not return a response')
			const secondCatalog = (await secondCatalogResponse.json()) as { data: { items: Array<{ report_id: string }> } }
			expect(secondCatalog.data.items.map((item) => item.report_id)).toEqual(['8'])

			const tradingResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${oracle.toLowerCase()}`), database.sql)
			if (tradingResponse === undefined) throw new Error('trading endpoint did not return a response')
			const trading = (await tradingResponse.json()) as {
				data: {
					summary: { swaps_7d: number; input_volume_7d: string; fees_7d: string }
					twap7d: { state: string }
					observationsTruncated: boolean
					observationRange: { firstTimestamp: string; lastTimestamp: string; count: number }
				}
			}
			expect(trading.data).toMatchObject({
				summary: { swaps_7d: 10002, input_volume_7d: '10002', fees_7d: '10002' },
				twap7d: { state: 'Partial coverage' },
				observationsTruncated: true,
				observationRange: { firstTimestamp: '1767225624', lastTimestamp: '1767235623', count: 10000 },
			})

			await database.sql`DELETE FROM amm_trade_events WHERE chain_id = ${operationsChainId} AND block_number IN (2, 3)`
			await database.sql`
			INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical, finalized)
			VALUES (${operationsChainId}, 0, ${`0x${'f'.repeat(64)}`}, ${`0x${'e'.repeat(64)}`},
				timestamptz '2025-12-24 23:59:59+00', true, true)
		`
			await database.sql`
			INSERT INTO transactions (
				chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address,
				value, input, status, gas_used, receipt, canonical
			) VALUES (${operationsChainId}, ${`0x${'d'.repeat(64)}`}, ${`0x${'f'.repeat(64)}`}, 0, 0,
				${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
			await database.sql`
			INSERT INTO logs (
				chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
				topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
			) VALUES (${operationsChainId}, ${`0x${'d'.repeat(64)}`}, ${`0x${'f'.repeat(64)}`}, 0, 0, 0,
				${oracle.toLowerCase()}, '[]'::jsonb, '0x', 'Swap', '{}'::jsonb, '[]'::jsonb, 'decoded', 'Swap', true, true)
		`
			await database.sql`
			INSERT INTO amm_trade_events (
				chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
			) VALUES (${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0,
				${oracle.toLowerCase()}, 'Swap',
				jsonb_build_object('yesForNo', true, 'amountIn', '1', 'amountOut', '1', 'feeAmount', '1',
					'resultingYesReserve', '1', 'resultingNoReserve', '2'), true)
		`
			const boundaryResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${oracle.toLowerCase()}`), database.sql)
			if (boundaryResponse === undefined) throw new Error('boundary trading endpoint did not return a response')
			const boundary = (await boundaryResponse.json()) as {
				data: { summary: { swaps_7d: number }; observationsTruncated: boolean; observationRange: { firstTimestamp: string; count: number } }
			}
			expect(boundary.data).toMatchObject({
				summary: { swaps_7d: 10000 },
				observationsTruncated: true,
				observationRange: { firstTimestamp: '1767225624', count: 10000 },
			})

			const uniswapOnlyMarket = getAddress('0x9999999999999999999999999999999999999999').toLowerCase()
			await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				) VALUES (${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0,
					${uniswapOnlyMarket}, 'Swap', jsonb_build_object('sqrtPriceX96', '79228162514264337593543950336', 'liquidity', '100'), true)
			`
			const uniswapOnlyResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${uniswapOnlyMarket}`), database.sql)
			expect(uniswapOnlyResponse?.status).toBe(404)

			const uniswapSyncOnlyMarket = getAddress('0x9999999999999999999999999999999999999998').toLowerCase()
			await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				) VALUES (${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0,
					${uniswapSyncOnlyMarket}, 'Sync', jsonb_build_object('reserve0', '300', 'reserve1', '700'), true)
			`
			await database.sql`
				INSERT INTO protocol_timeline_entries (
					chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
					semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical
				) VALUES
					(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0, 'trading', ${uniswapSyncOnlyMarket},
						'Sync', jsonb_build_object('reserve0', '300', 'reserve1', '700'), '[]'::jsonb, ${uniswapSyncOnlyMarket}, 'Sync', true),
					(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0, 'amm', ${uniswapOnlyMarket},
						'Swap', jsonb_build_object('sqrtPriceX96', '79228162514264337593543950336'), '[]'::jsonb, ${uniswapOnlyMarket}, 'Swap', true)
			`
			const uniswapSyncOnlyResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${uniswapSyncOnlyMarket}`),
				database.sql,
			)
			expect(uniswapSyncOnlyResponse?.status).toBe(404)
			await database.sql`
				DELETE FROM protocol_timeline_entries WHERE chain_id = ${operationsChainId}
					AND entity_identity IN (${uniswapOnlyMarket}, ${uniswapSyncOnlyMarket})
			`
			await database.sql`
				DELETE FROM amm_trade_events WHERE chain_id = ${operationsChainId}
					AND market_address IN (${uniswapOnlyMarket}, ${uniswapSyncOnlyMarket})
			`

			await database.sql`
				INSERT INTO liquidation_approval_events (
					chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address,
					approval_identity, receiver_vault, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'),
					'0x' || lpad(to_hex(item + 20000), 64, '0'), 0, 0, item, ${oracle.toLowerCase()},
					'0x' || lpad(to_hex(item), 64, '0'), ${address.toLowerCase()}::text, 'LiquidationApprovalSet',
					jsonb_build_object(
						'approvalId', '0x' || lpad(to_hex(item), 64, '0'),
						'receiverVault', ${address.toLowerCase()}::text,
						'securityPool', CASE WHEN item = 102 THEN ${uniswapOnlyMarket}::text ELSE ${oracle.toLowerCase()}::text END,
						'targetVault', ${address.toLowerCase()}::text
					), true
				FROM generate_series(2, 102) item
			`
			const linkedApprovalId = `0x${'b'.repeat(64)}`
			await database.sql`
				INSERT INTO liquidation_approval_events (
					chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address,
					approval_identity, receiver_vault, event_name, event_data, canonical
				) VALUES
				(
					${operationsChainId}, ${`0x${(10002).toString(16).padStart(64, '0')}`},
					${`0x${(30002).toString(16).padStart(64, '0')}`}, 0, 0, 10002, ${uniswapOnlyMarket},
					${linkedApprovalId}, ${uniswapOnlyMarket}, 'LiquidationApprovalSet',
					jsonb_build_object('approvalId', ${linkedApprovalId}::text, 'receiverVault', ${uniswapOnlyMarket}::text,
						'securityPool', ${oracle.toLowerCase()}::text, 'targetVault', ${address.toLowerCase()}::text), true
				),
				(
					${operationsChainId}, ${`0x${(10003).toString(16).padStart(64, '0')}`},
					${`0x${(30003).toString(16).padStart(64, '0')}`}, 0, 0, 10003, ${uniswapOnlyMarket},
					${linkedApprovalId}, NULL, 'LiquidationApprovalReserved',
					jsonb_build_object('approvalId', ${linkedApprovalId}::text, 'operationId', '42'), true
				),
				(
					${operationsChainId}, ${`0x${(10003).toString(16).padStart(64, '0')}`},
					${`0x${(30003).toString(16).padStart(64, '0')}`}, 0, 0, 10003, ${oracle.toLowerCase()},
					${linkedApprovalId}, ${uniswapOnlyMarket}, 'LiquidationApprovalSet',
					jsonb_build_object('approvalId', ${linkedApprovalId}::text, 'receiverVault', ${uniswapOnlyMarket}::text,
						'securityPool', ${uniswapOnlyMarket}::text, 'targetVault', ${uniswapOnlyMarket}::text), true
				)
			`
			const boundedApprovalsResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${operationsChainId}`), database.sql)
			if (boundedApprovalsResponse === undefined) throw new Error('bounded operations endpoint did not return a response')
			const boundedApprovals = (await boundedApprovalsResponse.json()) as { data: { risk: { approvalEvents: unknown[] } } }
			expect(boundedApprovals.data.risk.approvalEvents).toHaveLength(100)

			const riskResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}`),
				database.sql,
			)
			if (riskResponse === undefined) throw new Error('vault risk endpoint did not return a response')
			const risk = (await riskResponse.json()) as {
				data: Record<string, unknown> & { approvalEvents: Array<{ approval_identity: string; event_name: string; event_data: Record<string, unknown> }> }
			}
			expect(risk.data).toMatchObject({
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				snapshot_evidence: {
					vaultSnapshot: { blockNumber: '2', blockHash: `0x${(2).toString(16).padStart(64, '0')}` },
					poolSnapshot: { blockNumber: '1', blockHash: hash },
				},
			})
			expect(risk.data['scanner_reason']).toContain('different evidence blocks')
			expect(risk.data.approvalEvents).toHaveLength(100)
			expect(risk.data.approvalEvents).toContainEqual(
				expect.objectContaining({ approval_identity: linkedApprovalId, event_name: 'LiquidationApprovalReserved' }),
			)
			expect(risk.data.approvalEvents.some((event) => event.event_data['securityPool'] === uniswapOnlyMarket)).toBe(false)

			await database.sql`
				UPDATE entity_state_snapshots SET
					block_number = 1, block_hash = ${hash}, block_timestamp = timestamptz '2026-01-01 00:00:20+00'
				WHERE chain_id = ${operationsChainId} AND entity_type = 'vault'
			`
			await database.sql`
				UPDATE entity_state_snapshots SET read_result = jsonb_set(read_result, '{price,protocolValid}', 'false'::jsonb, true)
				WHERE chain_id = ${operationsChainId} AND entity_type = 'pool'
			`
			const invalidPriceResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}`),
				database.sql,
			)
			if (invalidPriceResponse === undefined) throw new Error('invalid-price risk endpoint did not return a response')
			const invalidPrice = (await invalidPriceResponse.json()) as { data: Record<string, unknown> }
			expect(invalidPrice.data).toMatchObject({ protocol_state: 'unavailable', scanner_severity: 'unavailable' })
			expect(invalidPrice.data['scanner_reason']).toContain('invalid accounting price')

			await database.sql`
				UPDATE entity_state_snapshots SET read_result =
					CASE entity_type
						WHEN 'pool' THEN jsonb_set(read_result, '{totalBadDebtAttoEth}', '"7"'::jsonb, true)
						ELSE jsonb_set(read_result, '{badDebtAttoEth}', '"9"'::jsonb, true)
					END
				WHERE chain_id = ${operationsChainId} AND entity_type IN ('pool', 'vault')
			`
			const badDebtPoolResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/risk/pools/${operationsChainId}/${oracle.toLowerCase()}`),
				database.sql,
			)
			const badDebtVaultResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}`),
				database.sql,
			)
			if (badDebtPoolResponse === undefined || badDebtVaultResponse === undefined) throw new Error('bad-debt risk endpoint did not return a response')
			const badDebtPool = (await badDebtPoolResponse.json()) as { data: Record<string, unknown> }
			const badDebtVault = (await badDebtVaultResponse.json()) as { data: Record<string, unknown> }
			expect(badDebtPool.data).toMatchObject({ protocol_state: 'bad-debt', scanner_severity: 'critical' })
			expect(badDebtVault.data).toMatchObject({ protocol_state: 'bad-debt', scanner_severity: 'critical' })

			const snapshotRows = await database.sql`
			SELECT read_status, read_result, canonical FROM entity_state_snapshots
			WHERE chain_id = ${operationsChainId} AND entity_type = 'auction'
		`
			expect(snapshotRows[0]).toMatchObject({ read_status: 'success', canonical: true, read_result: { finalized: false, activeTickCount: '2' } })

			const explainQueries = [
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM open_oracle_report_events WHERE chain_id = ${operationsChainId} AND open_oracle_address = ${oracle.toLowerCase()} AND report_id = 7 AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM escalation_game_events WHERE chain_id = ${operationsChainId} AND game_address = ${oracle.toLowerCase()} AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM truth_auction_events WHERE chain_id = ${operationsChainId} AND auction_address = ${oracle.toLowerCase()} AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM protocol_timeline_entries WHERE chain_id = ${operationsChainId} AND entity_type = 'open-oracle-report' AND entity_identity = ${`${oracle.toLowerCase()}:7`} AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM amm_trade_events WHERE chain_id = ${operationsChainId} AND market_address = ${oracle.toLowerCase()} AND canonical ORDER BY block_number, log_index, tx_hash LIMIT 100`,
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM fork_migration_events WHERE chain_id = ${operationsChainId} AND universe_identity = '7' AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
				database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM entity_state_snapshots WHERE chain_id = ${operationsChainId} AND entity_type = 'auction' AND entity_identity = ${oracle.toLowerCase()} AND canonical ORDER BY block_number DESC LIMIT 1`,
			]
			const plans = await Promise.all(explainQueries)
			expect(plans).toHaveLength(7)
			for (const plan of plans) expect(JSON.stringify(plan)).toContain('Plan')

			const resetLease = await database.tryAcquireIndexerLock(operationsChainId)
			if (resetLease === undefined) throw new Error('operations manifest-reset writer did not acquire its lock')
			expect(await database.seedNetwork({ ...network, contracts: [[address, 'Replacement manifest contract', 'openOracle']] }, resetLease, true)).toBe(true)
			await resetLease.release()
			const staleSnapshots = await database.sql`
				SELECT DISTINCT read_status, canonical FROM entity_state_snapshots WHERE chain_id = ${operationsChainId}
			`
			expect(staleSnapshots).toEqual([{ read_status: 'stale', canonical: false }])

			await database.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${operationsChainId} AND hash = ${hash}`
			for (const table of ['pools', 'pool_state_events', 'vault_snapshots', 'escalation_game_events', 'truth_auction_events'])
				await database.sql.unsafe(`UPDATE ${table} SET canonical = true WHERE chain_id = $1`, [operationsChainId])
			const resampleTargets = await database.stateSnapshotTargets(operationsChainId, 1n)
			expect(new Set(resampleTargets.map((target) => target.entityType))).toEqual(new Set(['pool', 'vault']))
		} finally {
			await database.close()
		}
	},
	60_000,
)
