// Shared constants, block and log builders, and database helpers for the PostgreSQL integration suites.
// Every suite is gated by POSTGRES_TEST_URL and runs against one shared database, so each test owns
// distinct chain identifiers and cleans up the rows it writes.
import { expect, test } from 'bun:test'
import type { IndexedBlock, ScannerDatabase, StoredTransaction } from '../../src/database.ts'
import { getAddress, keccak256, stringToHex } from '../../src/ethereum.ts'
import { initializeSchema } from '../../src/schema.ts'
import { CURRENT_SCHEMA_VERSION, UNSUPPORTED_SCHEMA_MESSAGE } from '../../src/schema-policy.ts'
import type { ContractMetadata, StoredLog, TokenMetadata } from '../../src/types.ts'

const postgresUrl = process.env['POSTGRES_TEST_URL']
export const postgresTest = postgresUrl === undefined ? test.skip : test

export const requirePostgresUrl = (): string => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	return postgresUrl
}

export const chainId = 31_337
export const address = getAddress('0x1000000000000000000000000000000000000001')
export const discoveredAddress = getAddress('0x2000000000000000000000000000000000000002')
export const promotedAddress = getAddress('0x3000000000000000000000000000000000000003')
export const rediscoveredAddress = getAddress('0x4000000000000000000000000000000000000004')
export const orphanOnlyAddress = getAddress('0x5000000000000000000000000000000000000005')
export const wethAddress = getAddress('0x6000000000000000000000000000000000000006')
export const secondWethAddress = getAddress('0x6000000000000000000000000000000000000007')
export const referencedOnlyAddress = getAddress('0x7000000000000000000000000000000000000008')
export const pairAddress = getAddress('0x8000000000000000000000000000000000000009')
export const uniswapPairAddress = getAddress('0x9000000000000000000000000000000000000009')
export const inverseUniswapPairAddress = getAddress('0xa000000000000000000000000000000000000009')
export const uniswapV4PoolManagerAddress = getAddress('0xb000000000000000000000000000000000000009')
export const transactionHash = keccak256(stringToHex('augurScan integration transaction'))
export const blockHash = (name: string) => keccak256(stringToHex(name))
export type BlockHash = ReturnType<typeof blockHash>

export const transaction = (): StoredTransaction => ({
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

export const log = (hash: BlockHash, summary: string): StoredLog => ({
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

export const vaultCheckpoint = (hash: BlockHash): StoredLog => ({
	...log(hash, 'replacement vault checkpoint'),
	logIndex: 1,
	decoded: {
		status: 'decoded',
		name: 'VaultAccountingCheckpoint',
		summary: 'replacement vault checkpoint',
		arguments: {
			vault: address,
			repBackingUnits: '120000000000000000000',
			underwritingLimitAttoEth: 85_000_000_000_000_000_000n.toString(),
			claimableFeesAttoEth: 30_000_000_000_000_000n.toString(),
			feeIndex: '1',
			vaultFeeRemainder: '0',
			resultingTotalRepBackingUnits: '120000000000000000000',
			resultingFeeEligibleUnderwritingLimitAttoEth: 85_000_000_000_000_000_000n.toString(),
		},
	},
})

export const decodedLog = (hash: BlockHash, logIndex: number, emitter: ReturnType<typeof getAddress>, name: string, argumentsValue: Record<string, unknown>): StoredLog => ({
	...log(hash, name),
	logIndex,
	address: emitter,
	decoded: { status: 'decoded', name, summary: name, arguments: argumentsValue },
})

export const repPriceLog = (hash: BlockHash, price: string): StoredLog =>
	decodedLog(hash, 5, promotedAddress, 'PriceReported', {
		reportId: '42',
		price,
		lastSettlementTimestamp: '1767312000',
	})

export const priceHistoryLogs = (hash: BlockHash): readonly StoredLog[] => [
	decodedLog(hash, 2, address, 'DeploySecurityPool', {
		securityPool: discoveredAddress,
		parent: '0x0000000000000000000000000000000000000000',
		universeId: '0',
		questionId: '42',
		truthAuction: rediscoveredAddress,
		openOraclePriceCoordinator: promotedAddress,
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

export const indexedBlock = (name: string, parentHash: BlockHash, contracts: readonly ContractMetadata[] = [], summary?: string, tokenMetadata: readonly TokenMetadata[] = []): IndexedBlock => {
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
		logs: summary === undefined ? [] : [{ ...log(hash, summary), blockNumber: number }],
	}
}

export type IndexerRunSourceHashes = {
	readonly indexerRunId: string
	readonly abiSourceHash: string
	readonly applicationSourceHash: string
	readonly projectionSourceHash: string
}

// Records an indexer run whose source hashes are derived from the suffix unless overridden.
export const insertIndexerRun = async (database: ScannerDatabase, suffix: string, abiSourceHash = `abi-${suffix}`, projectionSourceHash = `projection-${suffix}`): Promise<IndexerRunSourceHashes> => {
	const rows = await database.sql`
		INSERT INTO indexer_runs
			(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash, indexer_enabled, network_configuration)
		VALUES (${CURRENT_SCHEMA_VERSION}, 'test', ${abiSourceHash}, ${`application-${suffix}`}, ${projectionSourceHash}, true, '{}'::jsonb)
		RETURNING id::text
	`
	const indexerRunId = rows[0]?.['id']
	if (typeof indexerRunId !== 'string') throw new Error('test indexer run was not inserted')
	return {
		indexerRunId,
		abiSourceHash,
		applicationSourceHash: `application-${suffix}`,
		projectionSourceHash,
	}
}

export const expectBehaviorChangingSchemaObjectsRejected = async (database: ScannerDatabase): Promise<void> => {
	const cases = [
		{
			create: 'CREATE TRIGGER augurscan_unexpected_trigger BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION pg_catalog.suppress_redundant_updates_trigger()',
			remove: 'DROP TRIGGER augurscan_unexpected_trigger ON public.actions',
		},
		{
			create: 'CREATE RULE augurscan_unexpected_rule AS ON DELETE TO public.actions DO INSTEAD NOTHING',
			remove: 'DROP RULE augurscan_unexpected_rule ON public.actions',
		},
		{
			create: 'CREATE POLICY augurscan_unexpected_policy ON public.actions USING (true)',
			remove: 'DROP POLICY augurscan_unexpected_policy ON public.actions',
		},
		{
			create: 'ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY',
			remove: 'ALTER TABLE public.actions DISABLE ROW LEVEL SECURITY',
		},
		{
			create: 'ALTER TABLE public.actions FORCE ROW LEVEL SECURITY',
			remove: 'ALTER TABLE public.actions NO FORCE ROW LEVEL SECURITY',
		},
	] as const
	for (const item of cases) {
		await database.sql.unsafe(item.create)
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe(item.remove)
		}
	}
}
