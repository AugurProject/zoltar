import { describe, expect, test } from 'bun:test'
import { isAccountTransactionValue, isLogDetailValue, isRecord } from '../browser/api-validation.ts'
import { handleApi } from '../src/api.ts'
import { decodeOpaqueCursor } from '../src/cursor-codec.ts'
import {
	assertBlockAppend,
	assertContractDeploymentObservation,
	assertLogScanCursorUpdate,
	assertRewindTarget,
	assertStartBlockCompatible,
	canonicalTablePolicies,
	type IndexedBlock,
	type IndexerLease,
	lockLiveEventWriter,
	releaseReservedConnection,
	replayWindowExpired,
	rewindDepth,
	ScannerDatabase,
	type StoredTransaction,
	scannerDatabaseOptions,
} from '../src/database.ts'
import { getAddress, keccak256, stringToHex, zeroAddress } from '../src/ethereum.ts'
import { CURRENT_SCHEMA_VERSION, initializeSchema, UNSUPPORTED_SCHEMA_MESSAGE } from '../src/schema.ts'
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

const expectBehaviorChangingSchemaObjectsRejected = async (database: ScannerDatabase): Promise<void> => {
	const cases = [
		{
			create:
				'CREATE TRIGGER augurscan_unexpected_trigger BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION pg_catalog.suppress_redundant_updates_trigger()',
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

postgresTest('rejects incomplete, altered, and extended layouts despite a current schema marker', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	try {
		await initializeSchema(database.sql)

		await database.sql.unsafe('DROP INDEX public.protocol_timeline_recent')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe(
				'CREATE INDEX protocol_timeline_recent ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC) WHERE canonical',
			)
		}

		await database.sql.unsafe('ALTER TABLE public.actions ALTER COLUMN summary TYPE character varying USING summary::character varying')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('ALTER TABLE public.actions ALTER COLUMN summary TYPE text USING summary::text')
		}

		await database.sql.unsafe('CREATE TABLE public.augurscan_layout_intruder (id integer)')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('DROP TABLE public.augurscan_layout_intruder')
		}

		await expectBehaviorChangingSchemaObjectsRejected(database)

		await initializeSchema(database.sql)
	} finally {
		await database.close()
	}
})

postgresTest('migrates v1 canonical and orphan timeline evidence to v2 identities and source provenance', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	const migrationChainId = chainId + 20 + process.pid
	const forkLogs = [
		{ block: 100n, parentUniverseId: '10', childUniverseId: '11', canonical: true },
		{ block: 101n, parentUniverseId: '20', childUniverseId: '21', canonical: false },
	] as const
	const pairLogs = [
		{ block: 102n, pair: pairAddress.toLowerCase(), canonical: true, augur: true },
		{ block: 103n, pair: inverseUniswapPairAddress.toLowerCase(), canonical: false, augur: false },
	] as const
	try {
		await initializeSchema(database.sql)
		await database.sql`DELETE FROM networks WHERE chain_id = ${migrationChainId}`
		await database.sql.unsafe(
			'DROP TABLE public.address_balance_observations, public.token_metadata_observations, public.entity_state_observations, public.history_invalidation_causes, public.action_interpretations, public.log_interpretations, public.history_invalidation_occurrences, public.chain_reorganizations, public.indexer_runs, public.augurscan_schema_migrations',
		)
		await database.sql.unsafe(
			'ALTER TABLE public.entity_state_snapshots DROP COLUMN indexer_run_id, DROP COLUMN abi_source_hash, DROP COLUMN application_source_hash, DROP COLUMN projection_source_hash',
		)
		await database.sql.unsafe(
			'ALTER TABLE public.networks DROP COLUMN applied_abi_source_hash, DROP COLUMN applied_application_source_hash, DROP COLUMN applied_projection_source_hash',
		)
		await database.sql.unsafe('ALTER TABLE public.contracts DROP COLUMN configured_deployment_block')
		await database.sql.unsafe(
			'DROP INDEX public.pool_snapshots_detail_page, public.protocol_timeline_entity_history_page, public.protocol_timeline_history_page, public.vault_snapshots_detail_page',
		)
		await database.sql`UPDATE augurscan_schema SET schema_version = '1' WHERE singleton`
		await database.sql.unsafe('DROP INDEX public.protocol_timeline_recent')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe(
				'CREATE INDEX protocol_timeline_recent ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC) WHERE canonical',
			)
		}
		await database.sql.unsafe('CREATE TABLE public.augurscan_v1_layout_intruder (id integer)')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('DROP TABLE public.augurscan_v1_layout_intruder')
		}
		await expectBehaviorChangingSchemaObjectsRejected(database)
		await database.sql`
			INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block)
			VALUES (${migrationChainId}, ${`migration-${migrationChainId}`}, 'Migration fixture', 'https://example.invalid', 0)
		`
		for (const item of [...forkLogs, ...pairLogs]) {
			const hash = blockHash(`v1-migration-block-${item.block}`)
			const txHash = blockHash(`v1-migration-transaction-${item.block}`)
			await database.sql`
				INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical)
				VALUES (${migrationChainId}, ${item.block.toString()}, ${hash}, ${blockHash(`v1-migration-parent-${item.block}`)}, now(), ${item.canonical})
			`
			await database.sql`
				INSERT INTO transactions
					(chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, receipt, canonical)
				VALUES (${migrationChainId}, ${txHash}, ${hash}, ${item.block.toString()}, 0, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 0, '0x', 'success', '{}'::jsonb, ${item.canonical})
			`
		}
		for (const item of forkLogs) {
			const hash = blockHash(`v1-migration-block-${item.block}`)
			const txHash = blockHash(`v1-migration-transaction-${item.block}`)
			const argumentsValue = {
				universeId: item.parentUniverseId,
				childUniverseId: item.childUniverseId,
				outcomeIndex: '1',
				childReputationToken: rediscoveredAddress.toLowerCase(),
				childUniverseTheoreticalSupplyAttoRep: 100n.toString(),
			}
			await database.sql`
				INSERT INTO logs
					(chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data,
					 event_name, arguments, decode_status, summary, canonical)
				VALUES (${migrationChainId}, ${txHash}, ${hash}, ${item.block.toString()}, 0, 0, ${address.toLowerCase()}, '[]'::jsonb, '0x',
					'DeployChild', (${JSON.stringify(argumentsValue)}::text)::jsonb, 'decoded', 'DeployChild', ${item.canonical})
			`
			await database.sql`
				INSERT INTO protocol_timeline_entries
					(chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity, semantic_event_kind,
					 summary_data, source_contract, source_event, canonical)
				VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, ${item.block.toString()}, 'fork', ${item.childUniverseId}, 'DeployChild',
					(${JSON.stringify(argumentsValue)}::text)::jsonb, ${address.toLowerCase()}, 'DeployChild', ${item.canonical})
			`
			await database.sql`
				INSERT INTO fork_migration_events
					(chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical)
				VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, ${item.block.toString()}, ${item.childUniverseId}, 'DeployChild',
					(${JSON.stringify(argumentsValue)}::text)::jsonb, ${item.canonical})
			`
		}
		for (const item of pairLogs) {
			const hash = blockHash(`v1-migration-block-${item.block}`)
			const txHash = blockHash(`v1-migration-transaction-${item.block}`)
			const argumentsValue = {
				securityPool: discoveredAddress.toLowerCase(),
				shareToken: wethAddress.toLowerCase(),
				universeId: '10',
				pair: item.pair,
				feeBps: '30',
			}
			await database.sql`
				INSERT INTO logs
					(chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data,
					 event_name, arguments, decode_status, summary, canonical)
				VALUES (${migrationChainId}, ${txHash}, ${hash}, ${item.block.toString()}, 0, 0, ${address.toLowerCase()}, '[]'::jsonb, '0x',
					'PairCreated', (${JSON.stringify(argumentsValue)}::text)::jsonb, 'decoded', 'PairCreated', ${item.canonical})
			`
			if (item.augur) {
				await database.sql`
					INSERT INTO amm_markets
						(chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address, share_token_address, universe_id, fee_bps, canonical)
					VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, ${item.block.toString()}, ${item.pair}, ${discoveredAddress.toLowerCase()},
						${wethAddress.toLowerCase()}, 10, 30, ${item.canonical})
				`
			}
		}
		const survivingStateBlock = forkLogs[0]
		const survivingStateBlockHash = blockHash(`v1-migration-block-${survivingStateBlock.block}`)
		const survivingStateTransactionHash = blockHash(`v1-migration-transaction-${survivingStateBlock.block}`)
		const survivingStateReadResult = {
			settlementCollateralAttoEth: 1n.toString(),
			currentMintingCapacityAttoEth: 2n.toString(),
			totalBadDebtAttoEth: 0n.toString(),
			systemState: '1',
			price: { repPerEth1e18: '100', protocolValid: true },
		}
		await database.sql`
			INSERT INTO pools (
				chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
				universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
				security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
				initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
			) VALUES (
				${migrationChainId}, ${survivingStateBlockHash}, ${survivingStateTransactionHash}, 0,
				${survivingStateBlock.block.toString()}, ${discoveredAddress.toLowerCase()}, ${address.toLowerCase()},
				10, 7, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, ${wethAddress.toLowerCase()},
				15000, 0, 0, 0, true
			)
		`
		await database.sql`
			INSERT INTO entity_state_snapshots (
				chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
				source_method, read_status, read_result, canonical
			) VALUES (
				${migrationChainId}, 'pool', ${discoveredAddress.toLowerCase()}, ${survivingStateBlock.block.toString()},
				${survivingStateBlockHash}, now(), 'augurscan.pool-risk.v1', 'success',
				(${JSON.stringify(survivingStateReadResult)}::text)::jsonb, true
			)
		`
		await database.sql`
			INSERT INTO address_balance_snapshots (
				chain_id, block_hash, block_number, address, asset_address, asset_kind, balance, canonical
			) VALUES (
				${migrationChainId}, ${survivingStateBlockHash}, ${survivingStateBlock.block.toString()},
				${address.toLowerCase()}, ${rediscoveredAddress.toLowerCase()}, 'rep', 77, true
			)
		`
		await database.sql`
			INSERT INTO token_metadata (
				chain_id, address, block_hash, name, symbol, decimals, read_block, canonical
			) VALUES (
				${migrationChainId}, ${rediscoveredAddress.toLowerCase()}, ${survivingStateBlockHash},
				'Migrated REP', 'MREP', 18, ${survivingStateBlock.block.toString()}, true
			)
		`
		await database.sql`
			UPDATE networks SET indexed_block = ${survivingStateBlock.block.toString()}, indexed_hash = ${survivingStateBlockHash},
				indexed_timestamp = now(), observed_block = ${survivingStateBlock.block.toString()}, phase = 'live'
			WHERE chain_id = ${migrationChainId}
		`

		await initializeSchema(database.sql)
		const migratedMarker = await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`
		expect(migratedMarker).toEqual([{ schema_version: CURRENT_SCHEMA_VERSION }])
		const migratedTimeline = await database.sql`
			SELECT entity_identity, source_event, canonical FROM protocol_timeline_entries
			WHERE chain_id = ${migrationChainId} ORDER BY block_number
		`
		expect(migratedTimeline).toEqual([
			{ entity_identity: '10', source_event: 'DeployChild', canonical: true },
			{ entity_identity: '20', source_event: 'DeployChild', canonical: false },
			{ entity_identity: pairAddress.toLowerCase(), source_event: 'PairCreated', canonical: true },
		])
		const migratedTrades = await database.sql`
			SELECT market_address, canonical FROM amm_trade_events
			WHERE chain_id = ${migrationChainId} AND event_name = 'PairCreated' ORDER BY block_number
		`
		expect(migratedTrades).toEqual([{ market_address: pairAddress.toLowerCase(), canonical: true }])
		const migratedForkEvents = await database.sql`
			SELECT universe_identity, canonical FROM fork_migration_events
			WHERE chain_id = ${migrationChainId} ORDER BY block_number
		`
		expect(migratedForkEvents).toEqual([
			{ universe_identity: '10', canonical: true },
			{ universe_identity: '20', canonical: false },
		])
		const migratedStateObservations = await database.sql`
			SELECT entity_type, entity_identity, read_result, canonical, indexer_run_id,
				abi_source_hash, application_source_hash, projection_source_hash
			FROM entity_state_observations WHERE chain_id = ${migrationChainId}
		`
		expect(migratedStateObservations).toEqual([
			{
				entity_type: 'pool',
				entity_identity: discoveredAddress.toLowerCase(),
				read_result: survivingStateReadResult,
				canonical: true,
				indexer_run_id: null,
				abi_source_hash: null,
				application_source_hash: null,
				projection_source_hash: null,
			},
		])
		const migratedBalanceObservations = await database.sql`
			SELECT read_status, balance::text, read_failure_reason, canonical, indexer_run_id, application_source_hash
			FROM address_balance_observations WHERE chain_id = ${migrationChainId}
		`
		expect(migratedBalanceObservations).toEqual([
			{ read_status: 'success', balance: '77', read_failure_reason: null, canonical: true, indexer_run_id: null, application_source_hash: null },
		])
		const migratedMetadataObservations = await database.sql`
			SELECT name, symbol, decimals, read_status, read_error, canonical, indexer_run_id, application_source_hash
			FROM token_metadata_observations WHERE chain_id = ${migrationChainId}
		`
		expect(migratedMetadataObservations).toEqual([
			{
				name: 'Migrated REP',
				symbol: 'MREP',
				decimals: 18,
				read_status: 'success',
				read_error: null,
				canonical: true,
				indexer_run_id: null,
				application_source_hash: null,
			},
		])
		const migratedRiskResponse = await handleApi(
			new Request(`http://localhost/api/v1/state/risk/pools/${migrationChainId}/${discoveredAddress.toLowerCase()}`),
			database.sql,
		)
		if (migratedRiskResponse === undefined) throw new Error('migrated risk response was not returned')
		expect(migratedRiskResponse.status).toBe(200)
		expect(await migratedRiskResponse.json()).toMatchObject({
			data: {
				indexer_run_id: null,
				abi_source_hash: null,
				application_source_hash: null,
				projection_source_hash: null,
				history: {
					stateSnapshots: [
						expect.objectContaining({
							indexer_run_id: null,
							abi_source_hash: null,
							application_source_hash: null,
							projection_source_hash: null,
						}),
					],
				},
			},
		})
	} finally {
		await initializeSchema(database.sql)
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest('limits health continuity auditing to the latest 10,000 indexed blocks', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	const auditChainId = chainId + 40 + process.pid
	const oldFirstHash = blockHash('integrity-window-old-first')
	const oldSecondHash = blockHash('integrity-window-old-second')
	const recentHash = blockHash('integrity-window-recent')
	const checkpointHash = blockHash('integrity-window-checkpoint')
	try {
		await initializeSchema(database.sql)
		await database.sql`DELETE FROM blocks WHERE chain_id = ${auditChainId}`
		await database.sql`DELETE FROM networks WHERE chain_id = ${auditChainId}`
		await database.sql`
			INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block)
			VALUES (${auditChainId}, ${`integrity-window-${auditChainId}`}, 'Integrity window fixture', 'https://example.invalid', 0)
		`
		await database.sql`
			INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES
				(${auditChainId}, 1, ${oldFirstHash}, ${blockHash('integrity-window-genesis')}, now(), true),
				(${auditChainId}, 2, ${oldSecondHash}, ${blockHash('integrity-window-wrong-old-parent')}, now(), true),
				(${auditChainId}, 19999, ${recentHash}, ${blockHash('integrity-window-unretained-parent')}, now(), true),
				(${auditChainId}, 20000, ${checkpointHash}, ${recentHash}, now(), true)
		`
		await database.sql`
			UPDATE networks SET indexed_block = 20000, indexed_hash = ${checkpointHash}, indexed_timestamp = now()
			WHERE chain_id = ${auditChainId}
		`

		const oldDiscontinuityOutsideWindow = (await database.auditIntegrity()).filter((issue) => issue.chainId === auditChainId)
		expect(oldDiscontinuityOutsideWindow).toEqual([])

		await database.sql`
			UPDATE blocks SET parent_hash = ${blockHash('integrity-window-wrong-recent-parent')}
			WHERE chain_id = ${auditChainId} AND hash = ${checkpointHash}
		`
		expect(await database.auditIntegrity()).toContainEqual({
			chainId: auditChainId,
			code: 'canonical_discontinuity',
			detail: 'Canonical block 20000 does not extend the preceding stored block',
		})
	} finally {
		await database.sql`DELETE FROM blocks WHERE chain_id = ${auditChainId}`
		await database.sql`DELETE FROM networks WHERE chain_id = ${auditChainId}`
		await database.close()
	}
})

postgresTest('classifies every chain-scoped canonical table', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	try {
		await initializeSchema(database.sql)
		const rows = await database.sql`
			SELECT canonical.table_name
			FROM information_schema.columns AS canonical
			JOIN information_schema.columns AS chain
				ON chain.table_schema = canonical.table_schema AND chain.table_name = canonical.table_name
			WHERE canonical.table_schema = 'public' AND canonical.column_name = 'canonical' AND chain.column_name = 'chain_id'
			ORDER BY canonical.table_name
		`
		expect(rows.map((row: Record<string, unknown>) => String(row['table_name']))).toEqual(canonicalTablePolicies.map(({ table }) => table).toSorted())
	} finally {
		await database.close()
	}
})

postgresTest('drains lease operations queued before release and rejects later work', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	const blocker = new ScannerDatabase(postgresUrl)
	const releaseChainId = chainId + 20 + process.pid
	const network = {
		id: `lease-release-${releaseChainId}`,
		name: 'Lease release ordering',
		chainId: releaseChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 0n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [],
	} satisfies NetworkConfig
	let lease: IndexerLease | undefined
	let unblockRow: (() => void) | undefined
	let blockingTransaction: Promise<void> | undefined
	const rowBlocked = new Promise<void>((resolve) => {
		unblockRow = resolve
	})
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork(network)
		lease = await database.tryAcquireIndexerLock(releaseChainId)
		if (lease === undefined) throw new Error('release-ordering writer did not acquire its lock')
		let confirmRowLocked: (() => void) | undefined
		const rowLocked = new Promise<void>((resolve) => {
			confirmRowLocked = resolve
		})
		blockingTransaction = blocker.sql.begin(async (transaction) => {
			await transaction`SELECT 1 FROM networks WHERE chain_id = ${releaseChainId} FOR UPDATE`
			confirmRowLocked?.()
			await rowBlocked
		})
		await rowLocked

		const firstUpdate = database.updateObservedHead(releaseChainId, 1n, 'backfilling', lease)
		for (let attempt = 0; attempt < 100; attempt++) {
			const activity = await database.sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${lease.backendPid}`
			if (activity[0]?.['wait_event_type'] === 'Lock') break
			if (attempt === 99) throw new Error('lease operation did not wait for the network row lock')
			await Bun.sleep(10)
		}
		const secondUpdate = database.updateObservedHead(releaseChainId, 2n, 'live', lease)
		const release = lease.release()
		unblockRow?.()
		await blockingTransaction
		await Promise.all([firstUpdate, secondUpdate, release])

		const stored = await database.sql`SELECT observed_block, phase FROM networks WHERE chain_id = ${releaseChainId}`
		expect(stored).toEqual([{ observed_block: '2', phase: 'live' }])
		await expect(database.updateObservedHead(releaseChainId, 3n, 'live', lease)).rejects.toThrow('Indexer lease was released')
	} finally {
		unblockRow?.()
		await blockingTransaction?.catch(() => undefined)
		await lease?.release().catch(() => undefined)
		await database.sql`DELETE FROM networks WHERE chain_id = ${releaseChainId}`
		await blocker.close()
		await database.close()
	}
})

postgresTest('advances the canonical coverage floor when RPC log history is pruned', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
	const database = new ScannerDatabase(postgresUrl)
	const boundaryChainId = chainId + 10 + process.pid
	const network: NetworkConfig = {
		id: `pruned-log-boundary-${boundaryChainId}`,
		name: 'Pruned log boundary',
		chainId: boundaryChainId,
		rpcUrls: ['http://127.0.0.1:8545'],
		startBlock: 1n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 0n,
		contracts: [[address, 'OpenOracle', 'openOracle']],
	}
	try {
		await initializeSchema(database.sql)
		await database.seedNetwork(network)
		const lease = await database.tryAcquireIndexerLock(boundaryChainId)
		if (lease === undefined) throw new Error('pruned-log boundary writer did not acquire its lock')
		try {
			const dynamicContract = {
				address: discoveredAddress,
				label: 'Previously discovered pool',
				kind: 'securityPool',
				provenance: 'Factory.DeploySecurityPool',
				discoveryBlock: 1n,
				discoveryTxHash: transactionHash,
			} satisfies ContractMetadata
			const replayableContract = {
				address: rediscoveredAddress,
				label: 'Discovery at retrievable floor',
				kind: 'truthAuction',
				provenance: 'Factory.DeployTruthAuction',
				discoveryBlock: 2n,
				discoveryTxHash: transactionHash,
			} satisfies ContractMetadata
			const orphanedContract = {
				address: orphanOnlyAddress,
				label: 'Orphaned pre-floor discovery',
				kind: 'securityPool',
				provenance: 'Factory.DeploySecurityPool',
				discoveryBlock: 1n,
				discoveryTxHash: transactionHash,
			} satisfies ContractMetadata
			await database.storeBlock(boundaryChainId, indexedBlock('block-one', blockHash('genesis'), [dynamicContract, orphanedContract]), lease)
			await database.rewind(boundaryChainId, -1n, undefined, lease)
			await database.storeBlock(boundaryChainId, indexedBlock('block-one-replacement', blockHash('genesis'), [dynamicContract]), lease)
			await database.storeBlock(boundaryChainId, indexedBlock('block-two', blockHash('block-one-replacement'), [replayableContract]), lease)
			expect(await database.advanceNetworkStartBlock(boundaryChainId, 2n, lease)).toBe(true)
			const boundaryEvents = await database.sql`
				SELECT event, payload FROM live_events WHERE (payload->>'chainId')::integer = ${boundaryChainId} ORDER BY id DESC LIMIT 1
			`
			expect(boundaryEvents[0]).toMatchObject({
				event: 'reorg',
				payload: { ancestor: '-1', depth: '2', startBlock: '2', reason: 'start-boundary-advanced' },
			})
			const boundaryExportResponse = await handleApi(
				new Request(`http://localhost/api/v1/export?chainId=${boundaryChainId}&dataset=reorgs&fromBlock=100&toBlock=200`),
				database.sql,
			)
			const boundaryExport = (await boundaryExportResponse?.text())?.trim().split('\n').filter(Boolean) ?? []
			expect(boundaryExport).toHaveLength(1)
			expect(JSON.parse(boundaryExport[0] ?? '{}')).toMatchObject({
				chain_id: boundaryChainId.toString(),
				previous_block: '2',
				ancestor_block: '-1',
				reason: 'start-boundary-advanced',
			})
			expect(await database.networkStartBlock(boundaryChainId)).toBe(2n)
			expect(await database.checkpoint(boundaryChainId)).toBeUndefined()
			const retainedContracts = await database.contracts(boundaryChainId, lease)
			expect(retainedContracts.get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect(retainedContracts.has(rediscoveredAddress.toLowerCase())).toBe(false)
			expect(retainedContracts.has(orphanOnlyAddress.toLowerCase())).toBe(false)
			const canonicalRows = await database.sql`SELECT count(*)::integer AS count FROM blocks WHERE chain_id = ${boundaryChainId} AND canonical`
			expect(canonicalRows[0]?.['count']).toBe(0)
			const retrievableBlock = (name: string, timestamp: Date): IndexedBlock => {
				const hash = blockHash(name)
				const forwardLog = { ...log(hash, 'post-boundary activity'), blockHash: hash, blockNumber: 2n }
				return {
					...indexedBlock('block-two', blockHash(`${name}-parent`)),
					number: 2n,
					hash,
					parentHash: blockHash(`${name}-parent`),
					timestamp,
					observedHead: 2n,
					transactions: [
						{
							...transaction(),
							receipt: {
								transactionHash,
								blockHash: hash,
								blockNumber: '2',
								status: 'success',
								logs: [{ ...forwardLog, blockNumber: '2' }],
							},
						},
					],
					logs: [forwardLog],
					logScanCursors: [{ contractAddress: discoveredAddress, startBlock: 2n, lastRetrievedBlock: 2n }],
				}
			}
			const forwardBlock = retrievableBlock('retrievable-boundary', new Date('2026-02-11T00:00:00Z'))
			await database.storeBlock(boundaryChainId, forwardBlock, lease)
			await database.rewind(boundaryChainId, -1n, undefined, lease)
			expect((await database.contracts(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect((await database.contracts(boundaryChainId, lease)).has(orphanOnlyAddress.toLowerCase())).toBe(false)
			await database.storeBlock(boundaryChainId, retrievableBlock('retrievable-replacement', new Date('2026-02-12T00:00:00Z')), lease)
			expect(
				await database.seedNetwork(
					{
						...network,
						startBlock: 2n,
						contracts: [...network.contracts, [promotedAddress, 'Additional manifest source', 'openOracle']],
					},
					{ lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true },
				),
			).toBe(true)
			const contractsAfterReseed = await database.contracts(boundaryChainId, lease)
			expect(contractsAfterReseed.get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect(contractsAfterReseed.has(orphanOnlyAddress.toLowerCase())).toBe(false)
			const finalBlock = retrievableBlock('retrievable-after-manifest-reset', new Date('2026-02-13T00:00:00Z'))
			await database.storeBlock(boundaryChainId, finalBlock, lease)
			const promotedNetwork = {
				...network,
				startBlock: 2n,
				contracts: [
					...network.contracts,
					[discoveredAddress, 'Promoted retained pool', 'securityPool'],
					[orphanOnlyAddress, 'Promoted orphan', 'securityPool'],
				],
			} satisfies NetworkConfig
			expect(await database.seedNetwork(promotedNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(true)
			expect((await database.contracts(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toMatchObject({
				discoveryBlock: 1n,
				provenance: 'manifest',
			})
			expect(await database.seedNetwork(promotedNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(false)
			expect((await database.contracts(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toMatchObject({
				discoveryBlock: 1n,
				provenance: 'manifest',
			})
			await database.storeBlock(boundaryChainId, retrievableBlock('retrievable-during-promotion', new Date('2026-02-14T00:00:00Z')), lease)
			expect(
				await database.seedNetwork({ ...network, startBlock: 2n }, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true }),
			).toBe(true)
			const contractsAfterPromotionRemoval = await database.contracts(boundaryChainId, lease)
			expect(contractsAfterPromotionRemoval.get(discoveredAddress.toLowerCase())).toMatchObject(dynamicContract)
			expect(contractsAfterPromotionRemoval.has(orphanOnlyAddress.toLowerCase())).toBe(false)
			await database.storeBlock(boundaryChainId, retrievableBlock('retrievable-after-promotion-removal', new Date('2026-02-15T00:00:00Z')), lease)
			const retainedLogs = await database.sql`
				SELECT block_number FROM logs WHERE chain_id = ${boundaryChainId} AND emitter_address = ${discoveredAddress.toLowerCase()} AND canonical
			`
			expect(retainedLogs).toEqual([{ block_number: '2' }])
			expect((await database.logScanCursors(boundaryChainId, lease)).get(discoveredAddress.toLowerCase())).toEqual({
				contractAddress: discoveredAddress,
				startBlock: 2n,
				lastRetrievedBlock: 2n,
			})
			const statusRows = await database.sql`
				SELECT phase, consecutive_failures, next_retry_at, last_error FROM networks WHERE chain_id = ${boundaryChainId}
			`
			expect(statusRows[0]).toMatchObject({ phase: 'live', consecutive_failures: 0, next_retry_at: null, last_error: null })
		} finally {
			await lease.release()
		}
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest(
	'preserves direct retained observations across semantic replay and invalidates them on a chain reorg',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const observationChainId = chainId + 90_000 + (process.pid % 100_000)
		const evidenceHash = blockHash(`direct-observation-block-${observationChainId}`)
		const network: NetworkConfig = {
			id: `direct-observation-${observationChainId}`,
			name: 'Direct observation replay fixture',
			chainId: observationChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[discoveredAddress, 'Observed REP', 'reputationToken']],
		}
		const evidence: IndexedBlock = {
			number: 1n,
			hash: evidenceHash,
			parentHash: blockHash(`direct-observation-parent-${observationChainId}`),
			timestamp: new Date('2026-03-31T00:00:00Z'),
			observedHead: 1n,
			finalizedThrough: 1n,
			contracts: [],
			tokenMetadata: [{ address: discoveredAddress, name: 'Observed REP', symbol: 'OREP', decimals: 18, readBlock: 1n }],
			transactions: [{ ...transaction(), receipt: { transactionHash, blockHash: evidenceHash, status: 'success', logs: [] } }],
			logs: [],
			addressActivity: [{ transactionHash, address, role: 'sender' }],
			contractDeploymentObservations: [],
			logScanCursors: [],
		}
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const insertRun = async (suffix: string) => {
				const rows = await database.sql`
					INSERT INTO indexer_runs (
						schema_version, app_version, abi_source_hash, application_source_hash,
						projection_source_hash, indexer_enabled, network_configuration
					) VALUES (
						${CURRENT_SCHEMA_VERSION}, 'test', ${`abi-${suffix}`}, ${`application-${suffix}`},
						${`projection-${suffix}`}, true, '{}'::jsonb
					) RETURNING id::text
				`
				const indexerRunId = rows[0]?.['id']
				if (typeof indexerRunId !== 'string') throw new Error('direct observation indexer run was not returned')
				return {
					indexerRunId,
					abiSourceHash: `abi-${suffix}`,
					applicationSourceHash: `application-${suffix}`,
					projectionSourceHash: `projection-${suffix}`,
				}
			}
			const initialRun = await insertRun('initial')
			const replayRun = await insertRun('replay')
			const initialLease = await database.tryAcquireIndexerLock(observationChainId)
			if (initialLease === undefined) throw new Error('direct observation writer did not acquire its initial lock')
			try {
				await database.storeBlock(observationChainId, evidence, initialLease, initialRun)
				await database.storeRichListBalances(
					observationChainId,
					1n,
					evidenceHash,
					[{ owner: address, assetAddress: discoveredAddress, assetKind: 'rep', balance: 77n }],
					initialLease,
					initialRun,
				)
				await database.storeRichListBalances(
					observationChainId,
					1n,
					evidenceHash,
					[
						{
							owner: address,
							assetAddress: zeroAddress,
							assetKind: 'native',
							readStatus: 'failed',
							readFailureReason: 'HttpRequestError',
						},
						{
							owner: address,
							assetAddress: discoveredAddress,
							assetKind: 'rep',
							readStatus: 'failed',
							readFailureReason: 'ContractFunctionExecutionError',
						},
					],
					initialLease,
					initialRun,
				)
				await database.storeRichListBalances(
					observationChainId,
					1n,
					evidenceHash,
					[{ owner: address, assetAddress: discoveredAddress, assetKind: 'rep', balance: 88n }],
					initialLease,
					replayRun,
				)
			} finally {
				await initialLease.release()
			}
			const balanceAttempts = await database.sql`
				SELECT read_status, balance::text, read_failure_reason FROM address_balance_observations
				WHERE chain_id = ${observationChainId} ORDER BY id
			`
			expect([...balanceAttempts]).toEqual([
				{ read_status: 'success', balance: '77', read_failure_reason: null },
				{ read_status: 'failed', balance: null, read_failure_reason: 'HttpRequestError' },
				{ read_status: 'failed', balance: null, read_failure_reason: 'ContractFunctionExecutionError' },
				{ read_status: 'success', balance: '88', read_failure_reason: null },
			])

			const replayLease = await database.tryAcquireIndexerLock(observationChainId)
			if (replayLease === undefined) throw new Error('direct observation writer did not acquire its replay lock')
			try {
				expect(
					await database.seedNetwork(network, {
						lease: replayLease,
						sourceReplayPlan: { reason: 'projection-rebuild', causes: ['projection-rebuild'] },
					}),
				).toBeTrue()
				const retainedDuringReplay = await database.sql`
					SELECT
						(SELECT canonical FROM address_balance_snapshots WHERE chain_id = ${observationChainId}) AS balance_canonical,
						(SELECT canonical FROM token_metadata WHERE chain_id = ${observationChainId}) AS metadata_canonical
				`
				expect(retainedDuringReplay).toEqual([{ balance_canonical: true, metadata_canonical: true }])
				const directReplayEvidence = await database.sql`
					SELECT
						(SELECT count(*)::integer FROM address_balance_observations
							WHERE chain_id = ${observationChainId} AND canonical) AS canonical_balance_attempts,
						(SELECT count(*)::integer FROM token_metadata_observations
							WHERE chain_id = ${observationChainId} AND canonical) AS canonical_metadata_attempts,
						(SELECT count(*)::integer FROM history_invalidation_occurrences occurrence
							JOIN chain_reorganizations invalidation ON invalidation.id = occurrence.invalidation_id
							WHERE invalidation.chain_id = ${observationChainId} AND invalidation.reason = 'projection-rebuild'
								AND occurrence.occurrence_kind IN ('address-balance', 'token-metadata')) AS direct_replay_associations
				`
				expect(directReplayEvidence).toEqual([{ canonical_balance_attempts: 4, canonical_metadata_attempts: 1, direct_replay_associations: 0 }])
				const unavailableDuringReplay = await handleApi(
					new Request(`http://localhost/api/v1/richlist?chainId=${observationChainId}&address=${address.toLowerCase()}`),
					database.sql,
				)
				expect(await unavailableDuringReplay?.json()).toMatchObject({ items: [], total: 0 })

				await database.storeBlock(
					observationChainId,
					{
						...evidence,
						tokenMetadata: [{ address: discoveredAddress, name: 'Replayed REP', symbol: 'RREP', decimals: 17, readBlock: 1n }],
					},
					replayLease,
					replayRun,
				)
				await database.storeBlock(
					observationChainId,
					{
						number: 2n,
						hash: blockHash(`direct-observation-failed-metadata-${observationChainId}`),
						parentHash: evidenceHash,
						timestamp: new Date('2026-03-31T00:00:12Z'),
						observedHead: 2n,
						finalizedThrough: 2n,
						contracts: [],
						tokenMetadata: [{ address: discoveredAddress, readError: 'HttpRequestError', readBlock: 2n }],
						transactions: [],
						logs: [],
						addressActivity: [],
						contractDeploymentObservations: [],
						logScanCursors: [],
					},
					replayLease,
					replayRun,
				)
			} finally {
				await replayLease.release()
			}
			expect((await database.tokenMetadata(observationChainId)).get(discoveredAddress.toLowerCase())).toMatchObject({
				name: 'Replayed REP',
				symbol: 'RREP',
				decimals: 17,
				readBlock: 1n,
			})
			const replayedResponse = await handleApi(
				new Request(`http://localhost/api/v1/richlist?chainId=${observationChainId}&address=${address.toLowerCase()}`),
				database.sql,
			)
			if (replayedResponse === undefined) throw new Error('direct observation rich-list response was not returned')
			expect(await replayedResponse.json()).toMatchObject({
				total: 1,
				items: [
					expect.objectContaining({
						rep_balances: [
							expect.objectContaining({ address: discoveredAddress.toLowerCase(), balance: '88', name: 'Replayed REP', symbol: 'RREP', decimals: 17 }),
						],
					}),
				],
			})
			const firstObservationResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=all&limit=4`),
				database.sql,
			)
			if (firstObservationResponse === undefined) throw new Error('direct observation audit response was not returned')
			const firstObservationPage = (await firstObservationResponse.json()) as {
				data: { items: Array<Record<string, unknown>>; total: number; nextCursor: string }
			}
			expect(firstObservationPage.data.total).toBe(7)
			expect(firstObservationPage.data.items).toHaveLength(4)
			const observationCursorParts = decodeOpaqueCursor(firstObservationPage.data.nextCursor)
			if (!Array.isArray(observationCursorParts) || observationCursorParts.length !== 14) throw new Error('direct observation cursor is malformed')
			const overflowingObservationCursor = [...observationCursorParts]
			overflowingObservationCursor[10] = firstObservationPage.data.total + 1
			const overflowingObservationResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=all&limit=4&cursor=${encodeURIComponent(btoa(JSON.stringify(overflowingObservationCursor)))}`,
				),
				database.sql,
			)
			expect(overflowingObservationResponse?.status).toBe(400)
			const secondObservationResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=all&limit=4&cursor=${encodeURIComponent(firstObservationPage.data.nextCursor)}`,
				),
				database.sql,
			)
			if (secondObservationResponse === undefined) throw new Error('direct observation continuation was not returned')
			const secondObservationPage = (await secondObservationResponse.json()) as { data: { items: Array<Record<string, unknown>>; hasMore: boolean } }
			const retainedAttempts = [...firstObservationPage.data.items, ...secondObservationPage.data.items]
			expect(secondObservationPage.data.hasMore).toBeFalse()
			expect(new Set(retainedAttempts.map((item) => `${String(item['observation_kind'])}:${String(item['observation_id'])}`)).size).toBe(7)
			expect(retainedAttempts).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						observation_kind: 'address-balance',
						result: { balance: '77' },
						application_source_hash: 'application-initial',
					}),
					expect.objectContaining({
						observation_kind: 'address-balance',
						read_status: 'failed',
						result: { readFailureReason: 'HttpRequestError' },
						application_source_hash: 'application-initial',
					}),
					expect.objectContaining({
						observation_kind: 'address-balance',
						result: { balance: '88' },
						application_source_hash: 'application-replay',
					}),
					expect.objectContaining({
						observation_kind: 'token-metadata',
						result: expect.objectContaining({ name: 'Observed REP', decimals: 18 }),
						application_source_hash: 'application-initial',
					}),
					expect.objectContaining({
						observation_kind: 'token-metadata',
						read_status: 'failed',
						result: { readError: 'HttpRequestError' },
						application_source_hash: 'application-replay',
					}),
					expect.objectContaining({
						observation_kind: 'token-metadata',
						result: expect.objectContaining({ name: 'Replayed REP', decimals: 17 }),
						application_source_hash: 'application-replay',
					}),
				]),
			)

			const reorgLease = await database.tryAcquireIndexerLock(observationChainId)
			if (reorgLease === undefined) throw new Error('direct observation writer did not acquire its reorg lock')
			try {
				await database.rewind(observationChainId, -1n, undefined, reorgLease)
			} finally {
				await reorgLease.release()
			}
			const invalidated = await database.sql`
				SELECT
					(SELECT canonical FROM address_balance_snapshots WHERE chain_id = ${observationChainId}) AS balance_canonical,
					(SELECT canonical FROM token_metadata WHERE chain_id = ${observationChainId}) AS metadata_canonical
			`
			expect(invalidated).toEqual([{ balance_canonical: false, metadata_canonical: false }])
			const directOccurrenceKinds = await database.sql`
				SELECT occurrence.occurrence_kind
				FROM history_invalidation_occurrences occurrence
				JOIN chain_reorganizations invalidation ON invalidation.id = occurrence.invalidation_id
				WHERE invalidation.chain_id = ${observationChainId} AND invalidation.reason = 'chain-reorg'
					AND occurrence.occurrence_kind IN ('address-balance', 'token-metadata')
				ORDER BY occurrence.occurrence_kind
			`
			expect(directOccurrenceKinds).toEqual(expect.arrayContaining([{ occurrence_kind: 'address-balance' }, { occurrence_kind: 'token-metadata' }]))
			expect(directOccurrenceKinds).toHaveLength(7)
			const orphanedObservationResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=orphaned`),
				database.sql,
			)
			if (orphanedObservationResponse === undefined) throw new Error('orphaned direct observation audit response was not returned')
			const orphanedObservations = (await orphanedObservationResponse.json()) as {
				data: { items: Array<Record<string, unknown>>; total: number }
			}
			expect(orphanedObservations.data.total).toBe(7)
			expect(orphanedObservations.data.items).toHaveLength(7)
			expect(orphanedObservations.data.items).toEqual(
				expect.arrayContaining([expect.objectContaining({ evidence_status: 'chain-orphaned', invalidation_reason: 'chain-reorg' })]),
			)

			const manifestSourceLease = await database.tryAcquireIndexerLock(observationChainId)
			if (manifestSourceLease === undefined) throw new Error('direct observation manifest fixture did not acquire its writer lock')
			try {
				await database.storeBlock(
					observationChainId,
					{
						...evidence,
						tokenMetadata: [{ address: discoveredAddress, readError: 'HttpRequestError', readBlock: 1n }],
					},
					manifestSourceLease,
					replayRun,
				)
				await database.storeRichListBalances(
					observationChainId,
					1n,
					evidenceHash,
					[
						{
							owner: address,
							assetAddress: zeroAddress,
							assetKind: 'native',
							readStatus: 'failed',
							readFailureReason: 'HttpRequestError',
						},
					],
					manifestSourceLease,
					replayRun,
				)
			} finally {
				await manifestSourceLease.release()
			}
			const manifestResetLease = await database.tryAcquireIndexerLock(observationChainId)
			if (manifestResetLease === undefined) throw new Error('direct observation manifest reset did not acquire its writer lock')
			try {
				await database.rewind(observationChainId, -1n, undefined, manifestResetLease, 'manifest-reset')
			} finally {
				await manifestResetLease.release()
			}
			const manifestOccurrenceKinds = await database.sql`
				SELECT occurrence.occurrence_kind
				FROM history_invalidation_occurrences occurrence
				JOIN chain_reorganizations invalidation ON invalidation.id = occurrence.invalidation_id
				WHERE invalidation.chain_id = ${observationChainId} AND invalidation.reason = 'manifest-reset'
					AND occurrence.occurrence_kind IN ('address-balance', 'token-metadata')
				ORDER BY occurrence.occurrence_kind
			`
			expect(manifestOccurrenceKinds).toEqual([{ occurrence_kind: 'address-balance' }, { occurrence_kind: 'token-metadata' }])
			const manifestObservationResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/direct-observations?chainId=${observationChainId}&canonical=orphaned`),
				database.sql,
			)
			if (manifestObservationResponse === undefined) throw new Error('manifest-invalidated direct observation audit response was not returned')
			const manifestObservations = (await manifestObservationResponse.json()) as { data: { items: Array<Record<string, unknown>>; total: number } }
			expect(manifestObservations.data.total).toBe(9)
			expect(manifestObservations.data.items).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						observation_kind: 'address-balance',
						read_status: 'failed',
						read_failure_reason: 'HttpRequestError',
						evidence_status: 'manifest-superseded',
						invalidation_reason: 'manifest-reset',
					}),
					expect.objectContaining({
						observation_kind: 'token-metadata',
						read_status: 'failed',
						result: { readError: 'HttpRequestError' },
						evidence_status: 'manifest-superseded',
						invalidation_reason: 'manifest-reset',
					}),
				]),
			)
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			await database.close()
		}
	},
	30_000,
)

postgresTest(
	'preserves immutable state observation outcomes across reorg and coverage invalidation',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const baseChainId = chainId + 95_000 + (process.pid % 100_000)
		try {
			await initializeSchema(database.sql)
			for (const [offset, invalidation] of [
				[0, 'reorg'],
				[1, 'coverage'],
			] as const) {
				const observationChainId = baseChainId + offset
				const evidenceHash = blockHash(`immutable-state-observation-${observationChainId}`)
				const network: NetworkConfig = {
					id: `immutable-state-observation-${observationChainId}`,
					name: 'Immutable state observation fixture',
					chainId: observationChainId,
					rpcUrls: ['https://example.invalid'],
					startBlock: 1n,
					explorerBaseUrl: 'https://example.invalid',
					nativeSymbol: 'ETH',
					confirmationDepth: 0n,
					contracts: [],
				}
				await database.seedNetwork(network)
				const lease = await database.tryAcquireIndexerLock(observationChainId)
				if (lease === undefined) throw new Error('immutable state observation writer did not acquire its lock')
				try {
					const evidence: IndexedBlock = {
						number: 1n,
						hash: evidenceHash,
						parentHash: blockHash(`immutable-state-observation-parent-${observationChainId}`),
						timestamp: new Date('2026-04-01T00:00:00Z'),
						observedHead: 1n,
						finalizedThrough: 1n,
						contracts: [],
						tokenMetadata: [],
						transactions: [],
						logs: [],
						addressActivity: [],
						contractDeploymentObservations: [],
						logScanCursors: [],
					}
					await database.storeBlock(observationChainId, evidence, lease)
					await database.storeEntityStateSnapshots(
						observationChainId,
						1n,
						evidenceHash,
						evidence.timestamp,
						[
							{
								entityType: 'pool',
								entityIdentity: discoveredAddress.toLowerCase(),
								sourceMethod: 'augurscan.immutable-success.v1',
								readStatus: 'success',
								readResult: { observed: 'success-value' },
							},
							{
								entityType: 'pool',
								entityIdentity: address.toLowerCase(),
								sourceMethod: 'augurscan.immutable-failure.v1',
								readStatus: 'failed',
								readFailureReason: 'original failure',
							},
						],
						lease,
					)
					if (invalidation === 'reorg') await database.rewind(observationChainId, -1n, undefined, lease)
					else await database.advanceNetworkStartBlock(observationChainId, 2n, lease)
				} finally {
					await lease.release()
				}
				const observations = await database.sql`
					SELECT source_method, read_status, read_result, read_failure_reason, canonical
					FROM entity_state_observations WHERE chain_id = ${observationChainId}
					ORDER BY id
				`
				expect([...observations]).toEqual([
					{
						source_method: 'augurscan.immutable-success.v1',
						read_status: 'success',
						read_result: { observed: 'success-value' },
						read_failure_reason: null,
						canonical: false,
					},
					{
						source_method: 'augurscan.immutable-failure.v1',
						read_status: 'failed',
						read_result: null,
						read_failure_reason: 'original failure',
						canonical: false,
					},
				])
			}
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			await database.close()
		}
	},
	30_000,
)

postgresTest(
	'retains versioned interpretations and exact invalidation provenance across a projection rebuild',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const provenanceChainId = chainId + 100_000 + (process.pid % 100_000)
		const evidenceBlockHash = blockHash(`projection-provenance-block-${provenanceChainId}`)
		const evidenceTxHash = blockHash(`projection-provenance-transaction-${provenanceChainId}`)
		const network: NetworkConfig = {
			id: `projection-provenance-${provenanceChainId}`,
			name: 'Projection provenance fixture',
			chainId: provenanceChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 1n,
			contracts: [[discoveredAddress, 'OpenOracle', 'openOracle']],
		}
		const insertRun = async (suffix: string, abiSourceHash = `abi-${suffix}`, projectionSourceHash = `projection-${suffix}`) => {
			const rows = await database.sql`
				INSERT INTO indexer_runs
					(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash, indexer_enabled, network_configuration)
				VALUES (${CURRENT_SCHEMA_VERSION}, 'test', ${abiSourceHash}, ${`application-${suffix}`}, ${projectionSourceHash}, true, '{}'::jsonb)
				RETURNING id::text
			`
			const id = rows[0]?.['id']
			if (typeof id !== 'string') throw new Error('test indexer run was not inserted')
			return {
				indexerRunId: id,
				abiSourceHash,
				applicationSourceHash: `application-${suffix}`,
				projectionSourceHash,
			}
		}
		const evidenceRawTopic = blockHash(`projection-provenance-topic-${provenanceChainId}`)
		const evidenceLog: StoredLog = {
			...decodedLog(evidenceBlockHash, 0, discoveredAddress, 'ReportSubmitted', {
				reportId: '7',
				numReports: '1',
				currentReporter: address,
				currentAmount1: '10',
				currentAmount2: '20',
			}),
			topics: [evidenceRawTopic],
			data: '0x1234',
			blockNumber: 1n,
			transactionHash: evidenceTxHash,
		}
		const evidencePaginationLog: StoredLog = {
			...decodedLog(evidenceBlockHash, 1, discoveredAddress, 'FixtureEvidence', { fixture: 'export-page-two' }),
			blockNumber: 1n,
			transactionHash: evidenceTxHash,
		}
		const evidenceBlock: IndexedBlock = {
			number: 1n,
			hash: evidenceBlockHash,
			parentHash: blockHash(`projection-provenance-parent-${provenanceChainId}`),
			timestamp: new Date('2026-04-01T00:00:00Z'),
			observedHead: 1n,
			finalizedThrough: 0n,
			contracts: [],
			tokenMetadata: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: [],
			transactions: [
				{
					hash: evidenceTxHash,
					transactionIndex: 0,
					from: address,
					to: discoveredAddress,
					value: 0n,
					input: '0x',
					status: 'success',
					gasUsed: 21_000n,
					receipt: { transactionHash: evidenceTxHash, blockHash: evidenceBlockHash, status: 'success', logs: [] },
					decoded: { status: 'decoded', name: 'submitReport', summary: 'Submit report', arguments: { reportId: '7' } },
				},
			],
			logs: [evidenceLog, evidencePaginationLog],
		}
		const restorePoolIdentity = async () => {
			await database.sql`
				INSERT INTO pools (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
					universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
					security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
					initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
				) VALUES (
					${provenanceChainId}, ${evidenceBlockHash}, ${evidenceTxHash}, 0, 1, ${discoveredAddress.toLowerCase()},
					${address.toLowerCase()}, 1, 7, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, ${address.toLowerCase()},
					15000, 0, 0, 0, true
				)
				ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true
			`
		}
		const expectHistoricalRisk = async (applicationSourceHash: string) => {
			const response = await handleApi(
				new Request(`http://localhost/api/v1/state/risk/pools/${provenanceChainId}/${discoveredAddress.toLowerCase()}?atBlock=1`),
				database.sql,
			)
			if (response === undefined) throw new Error('historical risk response was not returned')
			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({
				asOf: { blockNumber: '1', historical: true },
				data: {
					block_number: '1',
					abi_source_hash: 'abi-one',
					application_source_hash: applicationSourceHash,
					projection_source_hash: 'projection-one',
					history: {
						stateSnapshots: expect.arrayContaining([expect.objectContaining({ abi_source_hash: 'abi-one', application_source_hash: applicationSourceHash })]),
					},
				},
			})
		}
		try {
			await initializeSchema(database.sql)
			const firstRun = await insertRun('one')
			await expect(database.seedNetwork(network, { appliedSourceHashes: firstRun })).rejects.toThrow('Applied source hashes require the network indexer lease')
			const firstLease = await database.tryAcquireIndexerLock(provenanceChainId)
			if (firstLease === undefined) throw new Error('first provenance writer did not acquire its lock')
			try {
				await database.seedNetwork(network, { lease: firstLease, appliedSourceHashes: firstRun })
				await database.storeBlock(provenanceChainId, evidenceBlock, firstLease, firstRun)
				await database.storeEntityStateSnapshots(
					provenanceChainId,
					1n,
					evidenceBlockHash,
					evidenceBlock.timestamp,
					[
						{
							entityType: 'pool',
							entityIdentity: discoveredAddress.toLowerCase(),
							sourceMethod: 'augurscan.pool-risk.v1',
							readStatus: 'success',
							readResult: {
								settlementCollateralAttoEth: 1n.toString(),
								currentMintingCapacityAttoEth: 2n.toString(),
								totalBadDebtAttoEth: 0n.toString(),
								systemState: '1',
								price: { repPerEth1e18: '100', protocolValid: true },
							},
						},
					],
					firstLease,
					firstRun,
				)
			} finally {
				await firstLease.release()
			}
			await restorePoolIdentity()
			await expectHistoricalRisk('application-one')
			const firstInterpretations =
				await database.sql`SELECT interpretation_kind, interpretation_key FROM log_interpretations WHERE chain_id = ${provenanceChainId} ORDER BY interpretation_kind, interpretation_key`
			expect([...firstInterpretations]).toEqual([
				expect.objectContaining({ interpretation_kind: 'decode', interpretation_key: 'decode' }),
				expect.objectContaining({ interpretation_kind: 'decode', interpretation_key: 'decode' }),
				expect.objectContaining({
					interpretation_kind: 'projection',
					interpretation_key: `domainEvent:open-oracle-report:${discoveredAddress.toLowerCase()}:7`,
				}),
			])
			expect(Number((await database.sql`SELECT count(*) AS count FROM action_interpretations WHERE chain_id = ${provenanceChainId}`)[0]?.['count'])).toBe(1)
			expect(Number((await database.sql`SELECT count(*) AS count FROM protocol_timeline_entries WHERE chain_id = ${provenanceChainId}`)[0]?.['count'])).toBe(1)
			await insertRun('standby')
			const firstExportResponse = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=logs&limit=1`), database.sql)
			if (firstExportResponse === undefined) throw new Error('source-provenance export was not returned')
			expect(firstExportResponse.headers.get('x-augurscan-abi-source-hash')).toBe('abi-one')
			expect(firstExportResponse.headers.get('x-augurscan-application-source-hash')).toBe('application-one')
			expect(firstExportResponse.headers.get('x-augurscan-projection-source-hash')).toBe('projection-one')
			const exportedOccurrence = JSON.parse((await firstExportResponse.text()).trim()) as Record<string, unknown>
			expect(exportedOccurrence).toMatchObject({
				topics: [evidenceRawTopic],
				data: '0x1234',
				interpretations: expect.arrayContaining([
					expect.objectContaining({
						interpretation_kind: 'decode',
						indexer_run_id: firstRun.indexerRunId,
						abi_source_hash: 'abi-one',
						application_source_hash: 'application-one',
						projection_source_hash: 'projection-one',
					}),
				]),
			})
			const firstExportCursor = firstExportResponse.headers.get('x-augurscan-next-cursor')
			if (firstExportCursor === null || firstExportCursor === undefined) throw new Error('source-provenance export did not return a continuation')
			const cursorParts = decodeOpaqueCursor(firstExportCursor)
			if (!Array.isArray(cursorParts)) throw new Error('source-provenance export cursor is malformed')
			for (const [dataset, lastKey] of [
				['logs', ['1', '2147483648', '0', evidenceBlockHash, evidenceTxHash]],
				['logs', ['1', '0', '2147483648', evidenceBlockHash, evidenceTxHash]],
				['timeline', ['1', evidenceBlockHash, evidenceTxHash, '2147483648', 'open-oracle-report', `${discoveredAddress.toLowerCase()}:7`]],
			] as const) {
				const overflowingCursorParts = [...cursorParts]
				overflowingCursorParts[1] = dataset
				overflowingCursorParts[13] = lastKey
				const overflowingCursor = btoa(JSON.stringify(overflowingCursorParts))
				const overflowingResponse = await handleApi(
					new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=${dataset}&limit=1&cursor=${encodeURIComponent(overflowingCursor)}`),
					database.sql,
				)
				expect(overflowingResponse?.status).toBe(400)
			}
			const applicationOnlyRun = await insertRun('application-only', 'abi-one', 'projection-one')
			const applicationOnlyLease = await database.tryAcquireIndexerLock(provenanceChainId)
			if (applicationOnlyLease === undefined) throw new Error('application-only writer did not acquire its lock')
			try {
				const applicationReplayPlan = await database.sourceReplayPlan(provenanceChainId, applicationOnlyRun, applicationOnlyLease)
				expect(applicationReplayPlan).toEqual({ reason: 'projection-rebuild', causes: ['projection-rebuild'] })
				expect(
					await database.seedNetwork(network, {
						lease: applicationOnlyLease,
						sourceReplayPlan: applicationReplayPlan,
						appliedSourceHashes: applicationOnlyRun,
					}),
				).toBeTrue()
			} finally {
				await applicationOnlyLease.release()
			}
			const projectionResetEvents = await database.sql`
				SELECT payload FROM live_events
				WHERE (payload->>'chainId')::integer = ${provenanceChainId} AND event = 'reorg'
				ORDER BY id DESC LIMIT 1
			`
			expect(projectionResetEvents[0]?.['payload']).toMatchObject({ reason: 'projection-rebuild' })
			const materializedStateAfterProjectionReset = await database.sql`
				SELECT read_status, canonical, application_source_hash FROM entity_state_snapshots
				WHERE chain_id = ${provenanceChainId}
			`
			expect(materializedStateAfterProjectionReset).toEqual([{ read_status: 'success', canonical: true, application_source_hash: 'application-one' }])
			const observationsAfterProjectionReset = await database.sql`
				SELECT read_status, canonical, application_source_hash FROM entity_state_observations
				WHERE chain_id = ${provenanceChainId}
			`
			expect(observationsAfterProjectionReset).toEqual([{ read_status: 'success', canonical: true, application_source_hash: 'application-one' }])
			expect(await database.sourceReplayPlan(provenanceChainId, applicationOnlyRun)).toBeUndefined()
			const staleExportResponse = await handleApi(
				new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=logs&limit=1&cursor=${encodeURIComponent(firstExportCursor)}`),
				database.sql,
			)
			expect(staleExportResponse?.status).toBe(409)

			const invalidations = await database.sql`
				SELECT replacement.id::text, replacement.reason, occurrence.occurrence_kind
				FROM chain_reorganizations replacement
				JOIN history_invalidation_occurrences occurrence ON occurrence.invalidation_id = replacement.id
				WHERE replacement.chain_id = ${provenanceChainId}
				ORDER BY occurrence.occurrence_kind
			`
			expect(new Set(invalidations.map((row: Record<string, unknown>) => row['occurrence_kind']))).toEqual(
				new Set(['block', 'entity-state', 'log', 'transaction']),
			)
			expect(invalidations.every((row: Record<string, unknown>) => row['reason'] === 'projection-rebuild')).toBeTrue()
			expect(Number((await database.sql`SELECT count(*) AS count FROM protocol_timeline_entries WHERE chain_id = ${provenanceChainId}`)[0]?.['count'])).toBe(0)
			expect(Number((await database.sql`SELECT count(*) AS count FROM log_interpretations WHERE chain_id = ${provenanceChainId}`)[0]?.['count'])).toBe(3)
			const supersededResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs/${provenanceChainId}/${evidenceBlockHash}/${evidenceTxHash}/0?canonical=all`),
				database.sql,
			)
			if (supersededResponse === undefined) throw new Error('superseded log detail was not returned')
			expect(await supersededResponse.json()).toMatchObject({
				evidence_status: 'projection-superseded',
				invalidation_reason: 'projection-rebuild',
				interpretations: { log: expect.arrayContaining([expect.objectContaining({ projection_source_hash: 'projection-one' })]) },
			})

			const secondLease = await database.tryAcquireIndexerLock(provenanceChainId)
			if (secondLease === undefined) throw new Error('second provenance writer did not acquire its lock')
			await database.storeBlock(provenanceChainId, evidenceBlock, secondLease, applicationOnlyRun)
			await database.storeEntityStateSnapshots(
				provenanceChainId,
				1n,
				evidenceBlockHash,
				evidenceBlock.timestamp,
				[
					{
						entityType: 'pool',
						entityIdentity: discoveredAddress.toLowerCase(),
						sourceMethod: 'augurscan.pool-risk.v1',
						readStatus: 'success',
						readResult: {
							settlementCollateralAttoEth: 2n.toString(),
							currentMintingCapacityAttoEth: 3n.toString(),
							totalBadDebtAttoEth: 0n.toString(),
							systemState: '1',
							price: { repPerEth1e18: '100', protocolValid: true },
						},
					},
				],
				secondLease,
				applicationOnlyRun,
			)
			await secondLease.release()
			await restorePoolIdentity()
			await expectHistoricalRisk('application-application-only')
			const retainedObservations = await database.sql`
				SELECT application_source_hash, canonical FROM entity_state_observations
				WHERE chain_id = ${provenanceChainId} ORDER BY id
			`
			expect(retainedObservations).toEqual([
				{ application_source_hash: 'application-one', canonical: true },
				{ application_source_hash: 'application-application-only', canonical: true },
			])
			expect(Number((await database.sql`SELECT count(*) AS count FROM action_interpretations WHERE chain_id = ${provenanceChainId}`)[0]?.['count'])).toBe(2)
			expect(Number((await database.sql`SELECT count(*) AS count FROM log_interpretations WHERE chain_id = ${provenanceChainId}`)[0]?.['count'])).toBe(6)
			expect(
				Number((await database.sql`SELECT count(*) AS count FROM protocol_timeline_entries WHERE chain_id = ${provenanceChainId} AND canonical`)[0]?.['count']),
			).toBe(1)
			const combinedRun = await insertRun('combined', 'abi-two', 'projection-two')
			const combinedReplayPlan = await database.sourceReplayPlan(provenanceChainId, combinedRun)
			expect(combinedReplayPlan).toEqual({ reason: 'abi-redecode', causes: ['abi-redecode', 'projection-rebuild'] })
			const abiResetLease = await database.tryAcquireIndexerLock(provenanceChainId)
			if (abiResetLease === undefined) throw new Error('ABI reset writer did not acquire its lock')
			const combinedResetNetwork = {
				...network,
				contracts: [...network.contracts, [address, 'Combined reset fixture', 'priceCoordinator']],
			} satisfies NetworkConfig
			try {
				expect(
					await database.seedNetwork(combinedResetNetwork, {
						lease: abiResetLease,
						resetCanonicalHistoryOnManifestChange: true,
						sourceReplayPlan: combinedReplayPlan,
						appliedSourceHashes: combinedRun,
					}),
				).toBeTrue()
			} finally {
				await abiResetLease.release()
			}
			const abiResetEvents = await database.sql`
				SELECT payload FROM live_events
				WHERE (payload->>'chainId')::integer = ${provenanceChainId} AND event = 'reorg'
				ORDER BY id DESC LIMIT 1
			`
			expect(abiResetEvents[0]?.['payload']).toMatchObject({
				reason: 'abi-redecode',
				reasons: expect.arrayContaining(['abi-redecode', 'manifest-reset', 'projection-rebuild']),
			})
			const combinedCauses = await database.sql`
				SELECT cause.reason FROM history_invalidation_causes cause
				JOIN chain_reorganizations invalidation ON invalidation.id = cause.invalidation_id
				WHERE invalidation.chain_id = ${provenanceChainId}
					AND invalidation.id = (SELECT max(id) FROM chain_reorganizations WHERE chain_id = ${provenanceChainId})
				ORDER BY cause.reason
			`
			expect(combinedCauses.map((row: Record<string, unknown>) => row['reason'])).toEqual(['abi-redecode', 'manifest-reset', 'projection-rebuild'])
			const combinedInvalidationRows = await database.sql`
				SELECT invalidation.id::text, invalidation.indexer_run_id::text,
					invalidation.abi_source_hash, invalidation.application_source_hash, invalidation.projection_source_hash,
					COALESCE((SELECT jsonb_object_agg(counts.occurrence_kind, counts.occurrence_count ORDER BY counts.occurrence_kind)
						FROM (SELECT occurrence.occurrence_kind, count(*)::text AS occurrence_count
							FROM history_invalidation_occurrences occurrence WHERE occurrence.invalidation_id = invalidation.id
							GROUP BY occurrence.occurrence_kind) counts), '{}'::jsonb) AS occurrence_counts
				FROM chain_reorganizations invalidation
				WHERE invalidation.chain_id = ${provenanceChainId}
				ORDER BY invalidation.id DESC LIMIT 1
			`
			expect(combinedInvalidationRows[0]).toEqual({
				id: expect.any(String),
				indexer_run_id: combinedRun.indexerRunId,
				abi_source_hash: combinedRun.abiSourceHash,
				application_source_hash: combinedRun.applicationSourceHash,
				projection_source_hash: combinedRun.projectionSourceHash,
				occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
			})
			await insertRun('after-combined-reset')
			const reorganizationResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${provenanceChainId}`), database.sql)
			if (reorganizationResponse === undefined) throw new Error('multi-cause reorganization response was not returned')
			expect(await reorganizationResponse.json()).toMatchObject({
				items: expect.arrayContaining([
					expect.objectContaining({
						indexer_run_id: combinedRun.indexerRunId,
						abi_source_hash: combinedRun.abiSourceHash,
						application_source_hash: combinedRun.applicationSourceHash,
						projection_source_hash: combinedRun.projectionSourceHash,
						causes: ['abi-redecode', 'manifest-reset', 'projection-rebuild'],
						occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
					}),
				]),
			})
			const integrityResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${provenanceChainId}`), database.sql)
			if (integrityResponse === undefined) throw new Error('multi-cause integrity response was not returned')
			expect(await integrityResponse.json()).toMatchObject({
				data: {
					items: expect.arrayContaining([
						expect.objectContaining({
							indexer_run_id: combinedRun.indexerRunId,
							abi_source_hash: combinedRun.abiSourceHash,
							application_source_hash: combinedRun.applicationSourceHash,
							projection_source_hash: combinedRun.projectionSourceHash,
							causes: ['abi-redecode', 'manifest-reset', 'projection-rebuild'],
							occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
						}),
					]),
				},
			})
			const invalidationExport = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=reorgs`), database.sql)
			if (invalidationExport === undefined) throw new Error('invalidation export was not returned')
			const exportedInvalidations = (await invalidationExport.text())
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line) as Record<string, unknown>)
			expect(exportedInvalidations).toContainEqual(
				expect.objectContaining({
					reason: 'abi-redecode',
					indexer_run_id: combinedRun.indexerRunId,
					abi_source_hash: combinedRun.abiSourceHash,
					application_source_hash: combinedRun.applicationSourceHash,
					projection_source_hash: combinedRun.projectionSourceHash,
					causes: ['abi-redecode', 'manifest-reset', 'projection-rebuild'],
					occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
				}),
			)
			const finalReplayLease = await database.tryAcquireIndexerLock(provenanceChainId)
			if (finalReplayLease === undefined) throw new Error('final provenance replay writer did not acquire its lock')
			try {
				await database.storeBlock(provenanceChainId, evidenceBlock, finalReplayLease, applicationOnlyRun)
			} finally {
				await finalReplayLease.release()
			}
			await restorePoolIdentity()
			await database.sql`UPDATE protocol_timeline_entries SET canonical = false WHERE chain_id = ${provenanceChainId}`
			const multiCauseTimelineResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/timeline?chainId=${provenanceChainId}&canonical=orphaned`),
				database.sql,
			)
			if (multiCauseTimelineResponse === undefined) throw new Error('multi-cause timeline response was not returned')
			expect(await multiCauseTimelineResponse.json()).toMatchObject({
				data: {
					items: [expect.objectContaining({ invalidation_causes: ['abi-redecode', 'manifest-reset', 'projection-rebuild'] })],
				},
			})
			await database.sql`UPDATE protocol_timeline_entries SET canonical = true WHERE chain_id = ${provenanceChainId}`
			await expectHistoricalRisk('application-application-only')
			const finalObservations = await database.sql`
				SELECT application_source_hash, canonical FROM entity_state_observations
				WHERE chain_id = ${provenanceChainId} ORDER BY id
			`
			expect(finalObservations).toEqual([
				{ application_source_hash: 'application-one', canonical: true },
				{ application_source_hash: 'application-application-only', canonical: true },
			])
		} finally {
			await database.sql`DELETE FROM entity_state_observations WHERE chain_id = ${provenanceChainId}`
			await database.sql`DELETE FROM log_interpretations WHERE chain_id = ${provenanceChainId}`
			await database.sql`DELETE FROM action_interpretations WHERE chain_id = ${provenanceChainId}`
			await database.sql`
				DELETE FROM history_invalidation_occurrences occurrence USING chain_reorganizations invalidation
				WHERE occurrence.invalidation_id = invalidation.id AND invalidation.chain_id = ${provenanceChainId}
			`
			await database.sql`
				DELETE FROM history_invalidation_causes cause USING chain_reorganizations invalidation
				WHERE cause.invalidation_id = invalidation.id AND invalidation.chain_id = ${provenanceChainId}
			`
			await database.sql`DELETE FROM chain_reorganizations WHERE chain_id = ${provenanceChainId}`
			await database.sql`DELETE FROM indexer_runs WHERE app_version = 'test' AND network_configuration = '{}'::jsonb`
			await database.close()
		}
	},
	30_000,
)

postgresTest(
	'clears stale derived rows before replaying a manifest-reset occurrence',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const manifestChainId = chainId + 200_000 + (process.pid % 100_000)
		const evidenceBlockHash = blockHash(`manifest-replay-block-${manifestChainId}`)
		const evidenceTxHash = blockHash(`manifest-replay-transaction-${manifestChainId}`)
		const network: NetworkConfig = {
			id: `manifest-replay-${manifestChainId}`,
			name: 'Manifest replay fixture',
			chainId: manifestChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[discoveredAddress, 'Original OpenOracle', 'openOracle']],
		}
		const evidenceBlock = (eventName: 'ReportSubmitted' | 'ReportDisputed', numReports: string): IndexedBlock => ({
			number: 1n,
			hash: evidenceBlockHash,
			parentHash: blockHash(`manifest-replay-parent-${manifestChainId}`),
			timestamp: new Date('2026-04-02T00:00:00Z'),
			observedHead: 1n,
			finalizedThrough: 1n,
			contracts: [],
			tokenMetadata: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: [],
			transactions: [
				{
					hash: evidenceTxHash,
					transactionIndex: 0,
					from: address,
					to: discoveredAddress,
					value: 0n,
					input: '0x',
					status: 'success',
					gasUsed: 21_000n,
					receipt: { transactionHash: evidenceTxHash, blockHash: evidenceBlockHash, status: 'success', logs: [] },
					decoded: { status: 'unknown', summary: 'Manifest replay fixture' },
				},
			],
			logs: [
				{
					...decodedLog(evidenceBlockHash, 0, discoveredAddress, eventName, {
						reportId: '7',
						numReports,
						marker: eventName,
					}),
					blockNumber: 1n,
					transactionHash: evidenceTxHash,
				},
			],
		})
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const firstLease = await database.tryAcquireIndexerLock(manifestChainId)
			if (firstLease === undefined) throw new Error('manifest replay writer did not acquire its first lock')
			await database.storeBlock(manifestChainId, evidenceBlock('ReportSubmitted', '1'), firstLease)
			await firstLease.release()
			const submittedEvents =
				await database.sql`SELECT event_name, round_number::text, report_data, canonical FROM open_oracle_report_events WHERE chain_id = ${manifestChainId}`
			expect(submittedEvents).toEqual([
				{ event_name: 'ReportSubmitted', round_number: '1', report_data: { marker: 'ReportSubmitted', numReports: '1', reportId: '7' }, canonical: true },
			])

			const resetLease = await database.tryAcquireIndexerLock(manifestChainId)
			if (resetLease === undefined) throw new Error('manifest replay writer did not acquire its reset lock')
			expect(
				await database.seedNetwork(
					{ ...network, contracts: [[discoveredAddress, 'Reclassified contract', 'zoltar']] },
					{ lease: resetLease, resetCanonicalHistoryOnManifestChange: true },
				),
			).toBeTrue()
			await resetLease.release()
			const manifestResetEvents = await database.sql`
				SELECT payload FROM live_events
				WHERE (payload->>'chainId')::integer = ${manifestChainId} AND event = 'reorg'
				ORDER BY id DESC LIMIT 1
			`
			expect(manifestResetEvents[0]?.['payload']).toMatchObject({ reason: 'manifest-reset' })
			expect(Number((await database.sql`SELECT count(*) AS count FROM open_oracle_report_events WHERE chain_id = ${manifestChainId}`)[0]?.['count'])).toBe(0)

			const replayLease = await database.tryAcquireIndexerLock(manifestChainId)
			if (replayLease === undefined) throw new Error('manifest replay writer did not acquire its replay lock')
			await database.storeBlock(manifestChainId, evidenceBlock('ReportDisputed', '2'), replayLease)
			await replayLease.release()
			const disputedEvents =
				await database.sql`SELECT event_name, round_number::text, report_data, canonical FROM open_oracle_report_events WHERE chain_id = ${manifestChainId}`
			expect(disputedEvents).toEqual([
				{ event_name: 'ReportDisputed', round_number: '2', report_data: { marker: 'ReportDisputed', numReports: '2', reportId: '7' }, canonical: true },
			])
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)

postgresTest(
	'labels an earlier manifest deployment backfill and replays its first missing block',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const manifestChainId = chainId + 210_000 + (process.pid % 100_000)
		const firstHash = blockHash(`manifest-boundary-first-${manifestChainId}`)
		const secondHash = blockHash(`manifest-boundary-second-${manifestChainId}`)
		const network: NetworkConfig = {
			id: `manifest-boundary-${manifestChainId}`,
			name: 'Manifest boundary fixture',
			chainId: manifestChainId,
			rpcUrls: ['https://example.invalid'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[discoveredAddress, 'OpenOracle', 'openOracle', 2n]],
		}
		const block = (number: 1n | 2n, hash: ReturnType<typeof blockHash>, parentHash: ReturnType<typeof blockHash>, includeEvidence: boolean): IndexedBlock => ({
			number,
			hash,
			parentHash,
			timestamp: new Date(`2026-04-0${number}T00:00:00Z`),
			observedHead: 2n,
			finalizedThrough: 2n,
			contracts: [],
			tokenMetadata: [],
			addressActivity: [],
			contractDeploymentObservations: [],
			logScanCursors: includeEvidence ? [{ contractAddress: discoveredAddress, startBlock: number, lastRetrievedBlock: number }] : [],
			transactions: includeEvidence ? [{ ...transaction(), receipt: { transactionHash, blockHash: hash, status: 'success', logs: [] } }] : [],
			logs: includeEvidence ? [{ ...log(hash, `manifest boundary evidence at ${number}`), blockNumber: number }] : [],
		})
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const lease = await database.tryAcquireIndexerLock(manifestChainId)
			if (lease === undefined) throw new Error('manifest boundary writer did not acquire its lock')
			try {
				await database.storeBlock(manifestChainId, block(1n, firstHash, blockHash(`manifest-boundary-parent-${manifestChainId}`), false), lease)
				await database.storeBlock(manifestChainId, block(2n, secondHash, firstHash, true), lease)
				const earlierBoundaryNetwork = {
					...network,
					contracts: [[discoveredAddress, 'OpenOracle', 'openOracle', 1n]],
				} satisfies NetworkConfig
				expect(await database.seedNetwork(earlierBoundaryNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(true)
				expect(await database.seedNetwork(earlierBoundaryNetwork, { lease, resetCanonicalHistoryOnManifestChange: true, preserveStoredStart: true })).toBe(
					false,
				)

				const invalidation = await database.sql`
					SELECT id::text, reason FROM chain_reorganizations WHERE chain_id = ${manifestChainId} ORDER BY id DESC LIMIT 1
				`
				expect(invalidation[0]?.['reason']).toBe('manifest-reset')
				const invalidationId = String(invalidation[0]?.['id'])
				const occurrences = await database.sql`
					SELECT occurrence_kind, block_hash, occurrence_id, sub_index
					FROM history_invalidation_occurrences WHERE invalidation_id = ${invalidationId}
					ORDER BY occurrence_kind, block_hash
				`
				expect(occurrences).toContainEqual({
					occurrence_kind: 'log',
					block_hash: secondHash,
					occurrence_id: transactionHash,
					sub_index: 0,
				})

				await database.storeBlock(manifestChainId, block(1n, firstHash, blockHash(`manifest-boundary-parent-${manifestChainId}`), true), lease)
				const replayed = await database.sql`
					SELECT block_number::text, block_hash, tx_hash, log_index, canonical
					FROM logs WHERE chain_id = ${manifestChainId} AND block_hash = ${firstHash}
				`
				expect(replayed).toEqual([{ block_number: '1', block_hash: firstHash, tx_hash: transactionHash, log_index: 0, canonical: true }])
			} finally {
				await lease.release()
			}
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)

postgresTest(
	'initializes, resumes, retains an orphan, and serves only its canonical replacement',
	async () => {
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
			await expect(database.seedNetwork({ ...network, startBlock: 3n }, { preserveStoredStart: true })).rejects.toThrow(
				'while an effective index start is retained',
			)
			expect(await database.networkStartBlock(chainId)).toBe(1n)
			const zeroBoundaryNetwork = { ...network, id: 'zero-boundary', chainId: chainId + 1, startBlock: 0n }
			expect(await database.seedNetwork(zeroBoundaryNetwork)).toBe(false)
			await expect(database.seedNetwork({ ...zeroBoundaryNetwork, startBlock: 100n }, { preserveStoredStart: true })).rejects.toThrow(
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
			expect(() => assertStartBlockCompatible(3n, 1n, 1n, true)).toThrow(
				'Cannot change the configured start block from 1 to 3 while checkpoint 1 exists; rebuild the augurScan database from the new start block',
			)
			expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
			const unchangedBoundary = await database.sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
			expect(unchangedBoundary[0]?.['start_block']).toBe('1')
			await database.sql`UPDATE networks SET start_block = 3 WHERE chain_id = ${chainId}`
			expect(() => assertStartBlockCompatible(3n, 3n, 1n, true)).toThrow(
				'Stored checkpoint 1 is below configured start block 3; rebuild the augurScan database from the configured start block',
			)
			expect(await database.checkpoint(chainId)).toEqual({ number: 1n, hash: first.hash })
			const inconsistentBoundary = await database.sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
			expect(inconsistentBoundary[0]?.['start_block']).toBe('3')
			await database.sql`UPDATE networks SET start_block = 1 WHERE chain_id = ${chainId}`
			const invalidParent = indexedBlock('block-two-invalid-parent', genesisHash)
			expect(() => assertBlockAppend(invalidParent, { startBlock: 1n, indexedBlock: 1n, indexedHash: first.hash })).toThrow(
				'does not extend the current database checkpoint',
			)
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
					{ lease: writeLease },
				),
			).toBe(true)
			const seededContracts = await database.contracts(chainId)
			expect(seededContracts.get(address.toLowerCase())).toMatchObject({ label: 'Corrected manifest contract', kind: 'openOracle', provenance: 'manifest' })
			expect(seededContracts.get(promotedAddress.toLowerCase())).toMatchObject({
				address: promotedAddress,
				label: 'Promoted manifest helper',
				kind: 'securityPool',
				provenance: 'manifest',
				discoveryBlock: 2n,
				discoveryTxHash: transactionHash,
			})
			expect((await database.contracts(chainId)).get(address.toLowerCase())).toMatchObject({ deploymentBlock: 2n, deploymentCheckedBlock: 2n })
			await database.rewind(chainId, 1n, first.hash, writeLease)
			const recordedReorganizations = await database.sql`
			SELECT previous_block::text, previous_hash, ancestor_block::text, ancestor_hash, depth::text, reason
			FROM chain_reorganizations WHERE chain_id = ${chainId} ORDER BY id DESC LIMIT 1
		`
			expect(recordedReorganizations[0]).toEqual({
				previous_block: '2',
				previous_hash: orphan.hash,
				ancestor_block: '1',
				ancestor_hash: first.hash,
				depth: '1',
				reason: 'chain-reorg',
			})
			const chainReorganizationEvents = await database.sql`
				SELECT payload FROM live_events
				WHERE (payload->>'chainId')::integer = ${chainId} AND event = 'reorg'
				ORDER BY id DESC LIMIT 1
			`
			expect(chainReorganizationEvents[0]?.['payload']).toMatchObject({ reason: 'chain-reorg' })
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
			const poolHistoryResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/pools/${chainId}/${discoveredAddress.toLowerCase()}`),
				database.sql,
			)
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
			expect(poolHistory.coverage).toMatchObject({
				requestedFromBlock: '1',
				requestedToBlock: '2',
				indexedFromBlock: '1',
				indexedThroughBlock: '2',
				complete: true,
			})
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
					liquidity_value: '180000000000000000000000000000000000000000',
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
					liquidity_value: '240000000000000000000000000000000000000000',
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
			await database.seedNetwork({ ...network, contracts: [[discoveredAddress, 'Temporarily promoted pool', 'securityPool']] }, { lease: writeLease })
			await database.seedNetwork({ ...network, contracts: [] }, { lease: writeLease })
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
			const thirdTransactionHash = blockHash('block-three-transaction')
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
				transactionHash: thirdTransactionHash,
			})
			const thirdLogs = [v4Initialize(1, standardV4MarketId, '3000', '60'), v4Initialize(2, nonstandardV4MarketId, '250', '5')]
			const third: IndexedBlock = {
				...indexedBlock(
					'block-three',
					replacement.hash,
					[{ ...uniswapV4PoolManagerDiscovery, discoveryTxHash: thirdTransactionHash }],
					'batched V4 initializations',
				),
				number: 3n,
				timestamp: new Date('2026-01-03T00:00:00Z'),
				observedHead: 3n,
				transactions: [
					{
						...transaction(),
						hash: thirdTransactionHash,
						receipt: {
							transactionHash: thirdTransactionHash,
							blockHash: blockHash('block-three'),
							status: 'success',
							logs: [],
						},
					},
				],
				logs: thirdLogs,
			}
			const thirdWriteLease = await database.tryAcquireIndexerLock(chainId)
			if (thirdWriteLease === undefined) throw new Error('writer did not reacquire for the third canonical block')
			await database.storeBlock(chainId, third, thirdWriteLease)
			expect(await database.checkpoint(chainId)).toEqual({ number: 3n, hash: third.hash })
			await thirdWriteLease.release()
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
			expect(payload.items.length).toBeGreaterThanOrEqual(2)
			expect(payload.items).toContainEqual(expect.objectContaining({ summary: 'replacement event', block_hash: replacement.hash }))
			expect(payload.items[0]?.origin_address).toBe(address.toLowerCase())
			const orphanDetailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${orphan.hash}/${transactionHash}/0`), database.sql)
			expect(orphanDetailResponse?.status).toBe(404)
			expect(await orphanDetailResponse?.json()).toEqual({ error: 'Log not found' })
			const orphanHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&canonical=orphaned`), database.sql)
			const orphanHistory = (await orphanHistoryResponse?.json()) as { items: unknown[]; canonical: string }
			expect(orphanHistory.canonical).toBe('orphaned')
			expect(orphanHistory.items).toContainEqual(expect.objectContaining({ block_hash: orphan.hash, canonical: false, summary: 'orphan event' }))
			const orphanHistoryDetailResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs/${chainId}/${orphan.hash}/${transactionHash}/0?canonical=all`),
				database.sql,
			)
			expect(orphanHistoryDetailResponse?.status).toBe(200)
			expect(await orphanHistoryDetailResponse?.json()).toMatchObject({ block_hash: orphan.hash, canonical: false, summary: 'orphan event' })
			const firstLogPageResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1`), database.sql)
			const firstLogPage = (await firstLogPageResponse?.json()) as { items: Array<Record<string, unknown>>; nextCursor?: string }
			expect(firstLogPage.items).toHaveLength(1)
			expect(firstLogPage.nextCursor).toBeString()
			const mismatchedLogFilterResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs?chainId=${chainId}&event=replacement&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`),
				database.sql,
			)
			expect(mismatchedLogFilterResponse?.status).toBe(400)
			const advancedHeadHash = blockHash('cursor-head-advance')
			await database.sql`
				INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical)
				VALUES (${chainId}, 4, ${advancedHeadHash}, ${third.hash}, '2026-01-04T00:00:00Z', true)
			`
			await database.sql`
				UPDATE networks SET indexed_block = 4, indexed_hash = ${advancedHeadHash},
					indexed_timestamp = '2026-01-04T00:00:00Z', observed_block = 4
				WHERE chain_id = ${chainId}
			`
			const secondLogPageResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`),
				database.sql,
			)
			const secondLogPage = (await secondLogPageResponse?.json()) as {
				items: Array<Record<string, unknown>>
				asOf: { blockNumber: string; blockHash: string; indexedHead: string; historical: boolean }
			}
			expect(secondLogPage.items).toHaveLength(1)
			expect(secondLogPage.asOf).toMatchObject({ blockNumber: '3', blockHash: third.hash, indexedHead: '4', historical: true })
			expect(secondLogPage.items[0]).not.toMatchObject({
				block_hash: firstLogPage.items[0]?.['block_hash'],
				log_index: firstLogPage.items[0]?.['log_index'],
			})
			await database.sql`UPDATE blocks SET canonical = false WHERE chain_id = ${chainId} AND hash = ${third.hash}`
			const displacedSnapshotResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`),
				database.sql,
			)
			expect(displacedSnapshotResponse?.status).toBe(409)
			await database.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${chainId} AND hash = ${third.hash}`
			await database.sql`
				UPDATE networks SET indexed_block = 3, indexed_hash = ${third.hash},
					indexed_timestamp = '2026-01-03T00:00:00Z', observed_block = 3
				WHERE chain_id = ${chainId}
			`
			await database.sql`DELETE FROM blocks WHERE chain_id = ${chainId} AND hash = ${advancedHeadHash}`
			const reorganizationResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${chainId}`), database.sql)
			expect(await reorganizationResponse?.json()).toMatchObject({
				items: [expect.objectContaining({ previous_hash: orphan.hash, ancestor_hash: first.hash, depth: '1', reason: 'chain-reorg' })],
				total: 1,
			})
			await database.sql`
			INSERT INTO chain_reorganizations
				(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
			VALUES (${chainId}, 2, ${replacement.hash}, 1, ${first.hash}, 1, 'manifest-reset')
		`
			const staleLogPageResponse = await handleApi(
				new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`),
				database.sql,
			)
			expect(staleLogPageResponse?.status).toBe(409)
			const firstReorganizationPageResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${chainId}&limit=1`), database.sql)
			const firstReorganizationPage = (await firstReorganizationPageResponse?.json()) as { items: Array<{ id: string }>; nextCursor?: string }
			expect(firstReorganizationPage.items).toHaveLength(1)
			expect(firstReorganizationPage.nextCursor).toBeString()
			const mismatchedReorganizationChainResponse = await handleApi(
				new Request(`http://localhost/api/v1/reorgs?chainId=${chainId + 1}&limit=1&cursor=${encodeURIComponent(firstReorganizationPage.nextCursor ?? '')}`),
				database.sql,
			)
			expect(mismatchedReorganizationChainResponse?.status).toBe(400)
			const transientReorganization = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${chainId}, 2, ${replacement.hash}, 1, ${first.hash}, 1, 'projection-rebuild')
				RETURNING id::text
			`
			const staleReorganizationPageResponse = await handleApi(
				new Request(`http://localhost/api/v1/reorgs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstReorganizationPage.nextCursor ?? '')}`),
				database.sql,
			)
			expect(staleReorganizationPageResponse?.status).toBe(409)
			await database.sql`DELETE FROM chain_reorganizations WHERE id = ${transientReorganization[0]?.['id']}`
			const firstIntegrityPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1`), database.sql)
			const firstIntegrityPage = (await firstIntegrityPageResponse?.json()) as {
				data: { items: Array<{ id: string }>; total: number; offset: number; hasMore: boolean; nextCursor?: string }
			}
			expect(firstIntegrityPage.data).toMatchObject({ total: 2, offset: 0, hasMore: true })
			expect(firstIntegrityPage.data.items).toHaveLength(1)
			expect(firstIntegrityPage.data.nextCursor).toBeString()
			const firstTradingPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}`), database.sql)
			const firstTradingPage = (await firstTradingPageResponse?.json()) as {
				asOf: {
					blockNumber: string
					blockHash: string
					invalidationId: string
					abiSourceHash: string
					applicationSourceHash: string
					projectionSourceHash: string
				}
			}
			const firstTradingCursor = btoa(
				JSON.stringify([
					chainId,
					'trading-catalog',
					'',
					firstTradingPage.asOf.blockNumber,
					firstTradingPage.asOf.blockHash,
					firstTradingPage.asOf.invalidationId,
					firstTradingPage.asOf.abiSourceHash,
					firstTradingPage.asOf.applicationSourceHash,
					firstTradingPage.asOf.projectionSourceHash,
					1,
				]),
			)
			const insertedReorganization = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${chainId}, 3, ${third.hash}, -1, NULL, 3, 'projection-rebuild')
				RETURNING id::text
			`
			const secondIntegrityPageResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstIntegrityPage.data.nextCursor ?? '')}`,
				),
				database.sql,
			)
			expect(secondIntegrityPageResponse?.status).toBe(409)
			const staleTradingPageResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}&cursor=${encodeURIComponent(firstTradingCursor)}`),
				database.sql,
			)
			expect(staleTradingPageResponse?.status).toBe(409)
			const refreshedIntegrityPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1`), database.sql)
			const refreshedIntegrityPage = (await refreshedIntegrityPageResponse?.json()) as {
				data: { nextCursor?: string }
			}
			expect(refreshedIntegrityPage).toMatchObject({
				chainId,
				data: { total: 3, offset: 0, hasMore: true, items: [{ id: insertedReorganization[0]?.['id'] }] },
			})
			const integrityCursor = refreshedIntegrityPage.data.nextCursor
			if (integrityCursor === undefined) throw new Error('integrity catalog did not return a continuation')
			const integrityCursorParts = decodeOpaqueCursor(integrityCursor)
			if (!Array.isArray(integrityCursorParts) || integrityCursorParts.length !== 14) throw new Error('integrity cursor is malformed')
			const continuedIntegrityResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(integrityCursor)}`),
				database.sql,
			)
			expect(continuedIntegrityResponse?.status).toBe(200)
			const continuedIntegrity = (await continuedIntegrityResponse?.json()) as { data: { items: Array<{ id: string }>; offset: number } }
			expect(continuedIntegrity.data.offset).toBe(1)
			expect(continuedIntegrity.data.items).toHaveLength(1)
			expect(continuedIntegrity.data.items[0]?.id).not.toBe(insertedReorganization[0]?.['id'])
			const overflowingIntegrityCursor = [...integrityCursorParts]
			overflowingIntegrityCursor[11] = Number(integrityCursorParts[4]) + 1
			const overflowingIntegrityResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=250&cursor=${encodeURIComponent(btoa(JSON.stringify(overflowingIntegrityCursor)))}`,
				),
				database.sql,
			)
			expect(overflowingIntegrityResponse?.status).toBe(400)
			const tradingCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}`), database.sql)
			const tradingCatalog = (await tradingCatalogResponse?.json()) as {
				asOf: {
					blockNumber: string
					blockHash: string
					invalidationId: string
					abiSourceHash: string
					applicationSourceHash: string
					projectionSourceHash: string
				}
			}
			for (const offset of [100_000, 100_250]) {
				const cursor = btoa(
					JSON.stringify([
						chainId,
						'trading-catalog',
						'',
						tradingCatalog.asOf.blockNumber,
						tradingCatalog.asOf.blockHash,
						tradingCatalog.asOf.invalidationId,
						tradingCatalog.asOf.abiSourceHash,
						tradingCatalog.asOf.applicationSourceHash,
						tradingCatalog.asOf.projectionSourceHash,
						offset,
					]),
				)
				const boundaryResponse = await handleApi(
					new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}&cursor=${encodeURIComponent(cursor)}`),
					database.sql,
				)
				expect(boundaryResponse?.status).toBe(200)
				expect(await boundaryResponse?.json()).toMatchObject({ data: { items: [], offset, hasMore: false } })
			}
			await database.sql`
			INSERT INTO log_scan_cursors (chain_id, contract_address, start_block, last_retrieved_block)
			VALUES (${chainId}, ${rediscoveredAddress.toLowerCase()}, 1, 4)
		`
			expect(await database.auditIntegrity()).toContainEqual({
				chainId,
				code: 'log_cursor_ahead',
				detail: `Log cursor for ${rediscoveredAddress.toLowerCase()} is ahead of the network checkpoint`,
			})
			await database.sql`DELETE FROM log_scan_cursors WHERE chain_id = ${chainId} AND contract_address = ${rediscoveredAddress.toLowerCase()}`
			for (const runCount of [99, 100, 101]) {
				await database.sql`DELETE FROM indexer_runs`
				await database.sql`
				INSERT INTO indexer_runs
					(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash,
						indexer_enabled, network_configuration, started_at)
				SELECT ${CURRENT_SCHEMA_VERSION}, 'fixture-' || run_number::text, 'fixture-hash', 'fixture-application-hash',
					'fixture-projection-hash', true, '[]'::jsonb,
					'2026-01-01T00:00:00Z'::timestamptz + run_number * interval '1 second'
				FROM generate_series(1, ${runCount}) AS generated(run_number)
			`
				const runProvenanceResponse = await handleApi(new Request('http://localhost/api/v1/provenance'), database.sql)
				const runProvenance = (await runProvenanceResponse?.json()) as {
					runs: unknown[]
					runLimit: number
					runsTruncated: boolean
					remainingTotal: number
					nextCursor?: string
				}
				expect(runProvenance.runs).toHaveLength(Math.min(runCount, 100))
				expect(runProvenance).toMatchObject({
					runLimit: 100,
					runsTruncated: runCount > 100,
					remainingTotal: runCount,
				})
				if (runCount === 101) {
					const continuationResponse = await handleApi(
						new Request(`http://localhost/api/v1/provenance?cursor=${encodeURIComponent(runProvenance.nextCursor ?? '')}`),
						database.sql,
					)
					expect(await continuationResponse?.json()).toMatchObject({
						runs: [expect.any(Object)],
						runsTruncated: false,
						remainingTotal: 1,
					})
				}
			}
			await database.sql`DELETE FROM indexer_runs`
			const provenanceResponse = await handleApi(new Request('http://localhost/api/v1/provenance'), database.sql)
			const provenance = await provenanceResponse?.json()
			if (!isRecord(provenance) || !Array.isArray(provenance['migrations'])) throw new Error('Provenance migrations are malformed')
			expect(provenance['migrations'].some((migration) => isRecord(migration) && migration['schema_version'] === CURRENT_SCHEMA_VERSION)).toBe(true)
			const orphanExportResponse = await handleApi(
				new Request(`http://localhost/api/v1/export?chainId=${chainId}&dataset=logs&canonical=orphaned&fromBlock=2&toBlock=2`),
				database.sql,
			)
			expect(orphanExportResponse?.headers.get('content-type')).toContain('application/x-ndjson')
			expect((await orphanExportResponse?.text())?.trim()).toContain(orphan.hash)
			const readSingleRowExport = async (dataset: 'logs' | 'timeline'): Promise<readonly Record<string, unknown>[]> => {
				const rows: Record<string, unknown>[] = []
				let cursor: string | undefined
				for (;;) {
					const exportUrl = new URL(`http://localhost/api/v1/export?chainId=${chainId}&dataset=${dataset}&canonical=all&fromBlock=2&toBlock=2&limit=1`)
					if (cursor !== undefined) exportUrl.searchParams.set('cursor', cursor)
					const exportResponse = await handleApi(new Request(exportUrl), database.sql)
					if (exportResponse === undefined) throw new Error(`${dataset} export did not return a response`)
					expect(exportResponse.status).toBe(200)
					const body = (await exportResponse.text()).trim()
					if (body !== '') rows.push(JSON.parse(body) as Record<string, unknown>)
					const nextCursor = exportResponse.headers.get('x-augurscan-next-cursor')
					if (nextCursor === null) return rows
					cursor = nextCursor
				}
			}
			for (const dataset of ['logs', 'timeline'] as const) {
				const firstRead = await readSingleRowExport(dataset)
				const secondRead = await readSingleRowExport(dataset)
				expect(firstRead.length).toBeGreaterThan(1)
				expect(secondRead).toEqual(firstRead)
				const identities = firstRead.map((row) => [row['block_hash'], row['tx_hash'], row['log_index'], row['entity_type'], row['entity_identity']].join(':'))
				expect(new Set(identities).size).toBe(firstRead.length)
			}
			const senderLogsResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&address=${address.toLowerCase()}`), database.sql)
			if (senderLogsResponse === undefined) throw new Error('sender-filtered logs API did not return a response')
			const senderLogs = (await senderLogsResponse.json()) as { items: Array<{ origin_address: string; arguments: Record<string, unknown> }> }
			expect(senderLogs.items.length).toBeGreaterThanOrEqual(2)
			expect(senderLogs.items.every((item) => item.origin_address === address.toLowerCase())).toBe(true)
			expect(senderLogs.items.some((item) => !JSON.stringify(item.arguments).toLowerCase().includes(address.toLowerCase()))).toBe(true)
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
				expect(
					identitylessList.items.find((item) => item['block_hash'] === replacement.hash && item['emitter_address'] === discoveredAddress.toLowerCase()),
				).toMatchObject({
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
			await database.sql`
			INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
			VALUES (${chainId}, ${replacement.hash}, 2, ${transactionHash}, ${referencedOnlyAddress.toLowerCase()},
				'0x0000000000000000000000000000000000000000', 'referenced', true)
		`
			const interactionsResponse = await handleApi(
				new Request(`http://localhost/api/v1/address-interactions?chainId=${chainId}&address=${referencedOnlyAddress}&limit=1`),
				database.sql,
			)
			if (interactionsResponse === undefined) throw new Error('address interactions API did not return a response')
			if (!interactionsResponse.ok) throw new Error(`address interactions API failed: ${await interactionsResponse.text()}`)
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
				total: 2,
				limit: 1,
			})
			if (!isRecord(interactionsPayload) || !Array.isArray(interactionsPayload['items'])) throw new Error('address interactions API returned malformed items')
			expect(interactionsPayload['items'].every(isAccountTransactionValue)).toBeTrue()
			const interactionCursor = interactionsPayload['nextCursor']
			if (typeof interactionCursor !== 'string') throw new Error('address interactions API omitted its continuation')
			const olderInteractionsResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/address-interactions?chainId=${chainId}&address=${referencedOnlyAddress}&limit=1&cursor=${encodeURIComponent(interactionCursor)}`,
				),
				database.sql,
			)
			expect(await olderInteractionsResponse?.json()).toMatchObject({
				items: [expect.objectContaining({ tx_hash: transactionHash })],
				total: 2,
			})
			const firstActionsResponse = await handleApi(new Request(`http://localhost/api/v1/actions?chainId=${chainId}&limit=1`), database.sql)
			const firstActions = (await firstActionsResponse?.json()) as { items: Array<{ tx_hash: string }>; nextCursor?: string }
			expect(firstActions.items).toHaveLength(1)
			expect(firstActions.nextCursor).toBeString()
			const mismatchedActionChainResponse = await handleApi(
				new Request(`http://localhost/api/v1/actions?chainId=${chainId + 1}&limit=1&cursor=${encodeURIComponent(firstActions.nextCursor ?? '')}`),
				database.sql,
			)
			expect(mismatchedActionChainResponse?.status).toBe(400)
			const secondActionsResponse = await handleApi(
				new Request(`http://localhost/api/v1/actions?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstActions.nextCursor ?? '')}`),
				database.sql,
			)
			const secondActions = (await secondActionsResponse?.json()) as { items: Array<{ tx_hash: string }> }
			expect(secondActions.items).toHaveLength(1)
			expect(secondActions.items[0]?.tx_hash).not.toBe(firstActions.items[0]?.tx_hash)
			const originalProjectionSource = await database.sql`SELECT applied_projection_source_hash FROM networks WHERE chain_id = ${chainId}`
			await database.sql`UPDATE networks SET applied_projection_source_hash = 'changed-projection-source' WHERE chain_id = ${chainId}`
			const staleActionsResponse = await handleApi(
				new Request(`http://localhost/api/v1/actions?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstActions.nextCursor ?? '')}`),
				database.sql,
			)
			expect(staleActionsResponse?.status).toBe(409)
			await database.sql`
				UPDATE networks SET applied_projection_source_hash = ${originalProjectionSource[0]?.['applied_projection_source_hash']}
				WHERE chain_id = ${chainId}
			`
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
			expect(transactions).toMatchObject({ total: 62, snapshotBlock: '3' })
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
			const alteredCursorParts = decodeOpaqueCursor(transactions.nextCursor) as unknown[]
			alteredCursorParts[10] = Number(alteredCursorParts[10]) + 1
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
			expect(secondPage).toMatchObject({ total: 62 })
			expect(secondPage.nextCursor).toBeUndefined()
			expect(snapshotItems).toHaveLength(62)
			expect(new Set(snapshotItems.map((item) => item['tx_hash'])).size).toBe(62)
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
			expect(await currentTransactionsResponse.json()).toMatchObject({ total: 63, snapshotBlock: '4' })
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
			expect(richList.total).toBe(2)
			const addressRichList = richList.items.find((item) => item['address'] === address.toLowerCase())
			expect(addressRichList).toMatchObject({
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
			expect(addressRichList?.rep_balances).toEqual([
				expect.objectContaining({
					address: rediscoveredAddress.toLowerCase(),
					balance: '3000000000000000000',
					symbol: 'OLD',
					contractLabel: 'Original discovery',
				}),
			])
			expect(addressRichList?.weth_balances).toEqual([
				expect.objectContaining({ address: wethAddress.toLowerCase(), balance: '1234567890123456789', symbol: 'WETH' }),
				expect.objectContaining({ address: secondWethAddress.toLowerCase(), balance: '222222222222222222', symbol: 'WETH2' }),
			])
			expect(addressRichList?.native_balance_detail).toEqual({ balance: '2000000000456789123', blockNumber: '2' })
			expect(addressRichList?.pool_associations).toEqual([expect.objectContaining({ address: discoveredAddress.toLowerCase() })])
			expect(addressRichList?.vault_positions).toEqual([
				expect.objectContaining({
					poolAddress: discoveredAddress.toLowerCase(),
					repBackingUnits: '120000000000000000000',
					capacityOwnershipAttoRep: 85_000_000_000_000_000_000n.toString(),
					claimableFeesAttoEth: 30_000_000_000_000_000n.toString(),
					blockNumber: '2',
				}),
			])
			const beyondEndResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&offset=2`), database.sql)
			if (beyondEndResponse === undefined) throw new Error('offset rich-list API did not return a response')
			const beyondEnd = (await beyondEndResponse.json()) as { items: unknown[]; total: number }
			expect(beyondEnd).toMatchObject({ items: [], total: 2 })
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
			const refreshedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&address=${address}`), database.sql)
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
			const cappedResponse = await handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&address=${address}`), database.sql)
			if (cappedResponse === undefined) throw new Error('capped rich-list API did not return a response')
			const capped = (await cappedResponse.json()) as { items: Array<Record<string, unknown> & { rep_balances: Array<{ address: string }> }> }
			expect(capped.items[0]).toMatchObject({ sampled_rep_token_count: '102', returned_rep_token_count: '100', rep_balances_truncated: true })
			expect(capped.items[0]?.rep_balances).toHaveLength(100)
			expect(capped.items[0]?.rep_balances.map((balance) => balance.address)).toEqual(
				[rediscoveredAddress, ...extraRepTokens]
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
			const largePage = (await largePageResponse.json()) as { items: Array<{ address: string }>; total: number }
			expect(largePage).toMatchObject({ total: 5002 })
			expect(largePage.items).toHaveLength(10)
			const secondLargePageResponse = await database.read(
				(sql) => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10&offset=10`), sql),
				8_000,
			)
			if (secondLargePageResponse === undefined) throw new Error('second large rich-list page did not return a response')
			const secondLargePage = (await secondLargePageResponse.json()) as { items: Array<{ address: string }>; total: number; offset: number }
			expect(secondLargePage).toMatchObject({ total: 5002, offset: 10 })
			expect(secondLargePage.items).toHaveLength(10)
			expect(new Set([...largePage.items.map((item) => item.address), ...secondLargePage.items.map((item) => item.address)]).size).toBe(20)
			const largeBeyondEndResponse = await database.read(
				(sql) => handleApi(new Request(`http://localhost/api/v1/richlist?chainId=${chainId}&limit=10&offset=100000`), sql),
				8_000,
			)
			if (largeBeyondEndResponse === undefined) throw new Error('large beyond-end rich-list page did not return a response')
			const largeBeyondEnd = (await largeBeyondEndResponse.json()) as { items: unknown[]; total: number }
			expect(largeBeyondEnd).toMatchObject({ items: [], total: 5002 })

			const manifestResetLease = await database.tryAcquireIndexerLock(chainId)
			if (manifestResetLease === undefined) throw new Error('manifest reset did not acquire its lock')
			expect(
				await database.seedNetwork(
					{ ...network, contracts: [[address, 'Final manifest', 'zoltar']] },
					{ lease: manifestResetLease, resetCanonicalHistoryOnManifestChange: true },
				),
			).toBe(true)
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
			expect(() => assertStartBlockCompatible(100n, 1n, undefined, true)).toThrow('while an effective index start is retained')
			expect(await database.networkStartBlock(chainId)).toBe(1n)
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			await database.sql.unsafe('TRUNCATE TABLE live_events RESTART IDENTITY')
			await database.sql`UPDATE live_event_state SET pruned_through_id = 0, updated_at = now() WHERE singleton`
			void database.close(0)
		}
	},
	60_000,
)

postgresTest(
	'reports a historical Operations boundary relative to the current indexed head',
	async () => {
		if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL disappeared')
		const database = new ScannerDatabase(postgresUrl)
		const historicalChainId = chainId + 10 + process.pid
		const firstHash = blockHash('historical-operations-first')
		const secondHash = blockHash('historical-operations-second')
		const network: NetworkConfig = {
			id: `historical-operations-${historicalChainId}`,
			name: 'Historical Operations integration chain',
			chainId: historicalChainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [],
		}
		try {
			await initializeSchema(database.sql)
			await database.seedNetwork(network)
			const lease = await database.tryAcquireIndexerLock(historicalChainId)
			if (lease === undefined) throw new Error('historical Operations integration writer did not acquire its lock')
			try {
				for (const block of [
					{ number: 1n, hash: firstHash, parentHash: blockHash('historical-operations-parent') },
					{ number: 2n, hash: secondHash, parentHash: firstHash },
				])
					await database.storeBlock(
						historicalChainId,
						{
							...block,
							timestamp: new Date(`2026-01-01T00:00:2${block.number}Z`),
							observedHead: 2n,
							finalizedThrough: 2n,
							contracts: [],
							tokenMetadata: [],
							transactions: [],
							logs: [],
							addressActivity: [],
							contractDeploymentObservations: [],
							logScanCursors: [],
						},
						lease,
					)
			} finally {
				await lease.release()
			}
			const firstTransactionHash = blockHash(`historical-operations-transaction-one-${historicalChainId}`)
			const secondTransactionHash = blockHash(`historical-operations-transaction-two-${historicalChainId}`)
			const reportAddress = discoveredAddress.toLowerCase()
			const escalationAddress = promotedAddress.toLowerCase()
			const auctionAddress = rediscoveredAddress.toLowerCase()
			await database.sql`
					INSERT INTO transactions (
						chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address,
						value, input, status, gas_used, receipt, canonical
					) VALUES
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, ${address.toLowerCase()}, ${reportAddress},
							0, '0x', 'success', 21000, '{}'::jsonb, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, ${address.toLowerCase()}, ${reportAddress},
							0, '0x', 'success', 21000, '{}'::jsonb, true)
				`
			await database.sql`
					INSERT INTO logs (
						chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
						topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
					) VALUES
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 0, ${reportAddress}, '[]'::jsonb, '0x',
							'ReportSubmitted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical report', true, true),
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 1, ${escalationAddress}, '[]'::jsonb, '0x',
							'DepositOnOutcome', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical deposit', true, true),
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 2, ${auctionAddress}, '[]'::jsonb, '0x',
							'AuctionStarted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical auction', true, true),
						(${historicalChainId}, ${firstTransactionHash}, ${firstHash}, 1, 0, 3, ${auctionAddress}, '[]'::jsonb, '0x',
							'BidSubmitted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'historical bid', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 0, ${reportAddress}, '[]'::jsonb, '0x',
							'ReportDisputed', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current report', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 1, ${escalationAddress}, '[]'::jsonb, '0x',
							'DepositOnOutcome', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current deposit', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 2, ${auctionAddress}, '[]'::jsonb, '0x',
							'BidSubmitted', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current bid', true, true),
						(${historicalChainId}, ${secondTransactionHash}, ${secondHash}, 2, 0, 3, ${auctionAddress}, '[]'::jsonb, '0x',
							'AuctionFinalized', '{}'::jsonb, '[]'::jsonb, 'decoded', 'current finalization', true, true)
				`
			await database.sql`
					INSERT INTO open_oracle_report_events (
						chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
						report_id, event_name, round_number, report_data, canonical
					) VALUES
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 0, 1, ${reportAddress}, 7, 'ReportSubmitted', 1,
							'{"reportId":"7","numReports":"1","marker":"historical"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 0, 2, ${reportAddress}, 7, 'ReportDisputed', 2,
							'{"reportId":"7","numReports":"2","marker":"current"}'::jsonb, true)
				`
			await database.sql`
					INSERT INTO escalation_game_events (
						chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical
					) VALUES
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 1, 1, ${escalationAddress}, 'DepositOnOutcome',
							'{"outcome":"0","attoRepAmount":"10"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 1, 2, ${escalationAddress}, 'DepositOnOutcome',
							'{"outcome":"0","attoRepAmount":"90"}'::jsonb, true)
				`
			await database.sql`
					INSERT INTO truth_auction_events (
						chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical
					) VALUES
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 2, 1, ${auctionAddress}, 'AuctionStarted',
							'{"startTimestamp":"1767225600","endTimestamp":"1767229200"}'::jsonb, true),
						(${historicalChainId}, ${firstHash}, ${firstTransactionHash}, 3, 1, ${auctionAddress}, 'BidSubmitted',
							'{"bidder":"0x1000000000000000000000000000000000000001"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 2, 2, ${auctionAddress}, 'BidSubmitted',
							'{"bidder":"0x2000000000000000000000000000000000000002"}'::jsonb, true),
						(${historicalChainId}, ${secondHash}, ${secondTransactionHash}, 3, 2, ${auctionAddress}, 'AuctionFinalized',
							'{"winningTick":"1"}'::jsonb, true)
				`
			const response = await handleApi(new Request(`http://localhost/api/v1/state/risk?chainId=${historicalChainId}&atBlock=1&limit=1`), database.sql)
			if (response === undefined) throw new Error('historical risk catalog did not return a response')
			expect(await response.json()).toMatchObject({
				asOf: {
					blockNumber: '1',
					indexedHead: '2',
					observedHead: '2',
					historyDepthBlocks: '1',
					lagBlocks: '1',
					historical: true,
				},
			})
			await database.sql`
					INSERT INTO chain_reorganizations
						(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
					VALUES (${historicalChainId}, 2, ${secondHash}, 1, ${firstHash}, 1, 'projection-rebuild')
				`
			const operationsResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${historicalChainId}&atBlock=1`), database.sql)
			if (operationsResponse === undefined) throw new Error('historical Operations endpoint did not return a response')
			const operations = (await operationsResponse.json()) as {
				asOf: {
					blockNumber: string
					blockHash: string
					invalidationId: string
					abiSourceHash: string
					applicationSourceHash: string
					projectionSourceHash: string
				}
				data: {
					reports: Array<Record<string, unknown>>
					escalations: Array<Record<string, unknown>>
					auctions: Array<Record<string, unknown>>
					totals: Record<string, unknown>
				}
			}
			expect(operations.data.reports).toHaveLength(1)
			expect(operations.data.reports[0]).toMatchObject({
				block_number: '1',
				event_name: 'ReportSubmitted',
				round_number: '1',
				observed_rounds: 1,
				report_data: { marker: 'historical' },
			})
			expect(operations.data.escalations).toEqual([
				expect.objectContaining({ block_number: '1', event_name: 'DepositOnOutcome', invalid_stake_atto_rep: '10' }),
			])
			expect(operations.data.auctions).toEqual([
				expect.objectContaining({ block_number: '1', event_name: 'BidSubmitted', bid_count: 1, bidder_count: 1, settlement_count: 0 }),
			])
			expect(operations.data.totals).toMatchObject({ reports: 1, escalations: 1, auctions: 1, reorganizations: 1 })
			const reportCursor = btoa(
				JSON.stringify([
					historicalChainId,
					'reports-catalog',
					'catalog',
					operations.asOf.blockNumber,
					operations.asOf.blockHash,
					operations.asOf.invalidationId,
					operations.asOf.abiSourceHash,
					operations.asOf.applicationSourceHash,
					operations.asOf.projectionSourceHash,
					'1',
					firstTransactionHash,
					0,
				]),
			)
			const crossScopeResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/escalations?chainId=${historicalChainId}&cursor=${encodeURIComponent(reportCursor)}`),
				database.sql,
			)
			expect(crossScopeResponse?.status).toBe(400)
			expect(await crossScopeResponse?.json()).toEqual({ error: 'cursor does not match the requested entity' })
			await database.sql`
					INSERT INTO chain_reorganizations
						(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
					VALUES (${historicalChainId}, 2, ${secondHash}, 1, ${firstHash}, 1, 'projection-rebuild')
				`
			const staleGenerationResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/reports?chainId=${historicalChainId}&cursor=${encodeURIComponent(reportCursor)}`),
				database.sql,
			)
			expect(staleGenerationResponse?.status).toBe(409)
		} finally {
			await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
			void database.close(0)
		}
	},
	30_000,
)

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
				INSERT INTO protocol_timeline_entries
					(chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
						semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical)
				VALUES
					(${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, 'audit-link', 'a', 'AuditTwin', '{"side":"a","query":"🔮"}'::jsonb,
						'[]'::jsonb, ${oracle.toLowerCase()}, 'ReportSubmitted', true),
					(${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, 'audit-link', 'b', 'AuditTwin', '{"side":"b","query":"🔮"}'::jsonb,
						'[]'::jsonb, ${oracle.toLowerCase()}, 'ReportSubmitted', true)
			`
			const firstTimelinePageResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=AuditTwin&q=${encodeURIComponent('🔮')}&limit=1`),
				database.sql,
			)
			const firstTimelinePage = (await firstTimelinePageResponse?.json()) as {
				data: { items: Array<{ entity_identity: string }>; total: string; hasMore: boolean; nextCursor?: string }
			}
			expect(firstTimelinePage.data).toMatchObject({ items: [expect.objectContaining({ entity_identity: 'b' })], total: '2', hasMore: true })
			const timelineCursor = firstTimelinePage.data.nextCursor
			if (typeof timelineCursor !== 'string') throw new Error('global timeline omitted its continuation')
			const mismatchedTimelineFilterResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=AuditTwin&q=${encodeURIComponent('🪐')}&limit=1&cursor=${encodeURIComponent(timelineCursor)}`,
				),
				database.sql,
			)
			expect(mismatchedTimelineFilterResponse?.status).toBe(400)
			const secondTimelinePageResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=AuditTwin&q=${encodeURIComponent('🔮')}&limit=1&cursor=${encodeURIComponent(timelineCursor)}`,
				),
				database.sql,
			)
			expect(await secondTimelinePageResponse?.json()).toMatchObject({
				data: { items: [expect.objectContaining({ entity_identity: 'a' })], total: '2', hasMore: false },
			})

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
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index,
					emitter_address, topics, data, event_name, arguments, argument_schema,
					decode_status, summary, canonical, finalized
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'),
					'0x' || lpad(to_hex(item), 64, '0'), item, 0, 10,
					${oracle.toLowerCase()}, '[]'::jsonb, '0x', 'Sync',
					jsonb_build_object('yesReserve', item::text, 'noReserve', (item * 2)::text),
					'[]'::jsonb, 'decoded', 'Sync', true, true
				FROM generate_series(2, 10003) item
			`
			await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'),
					'0x' || lpad(to_hex(item + 20000), 64, '0'), 10, item, ${oracle.toLowerCase()}, 'Sync',
					jsonb_build_object('yesReserve', item::text, 'noReserve', (item * 2)::text), true
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
			await database.sql`
				INSERT INTO entity_state_observations (
					chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					source_method, read_status, read_result, read_failure_reason, observed_at, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				)
				SELECT chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					source_method, read_status, read_result, read_failure_reason, observed_at, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				FROM entity_state_snapshots
				WHERE chain_id = ${operationsChainId} AND entity_type IN ('pool', 'vault')
			`
			await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
					topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'), '0x' || lpad(to_hex(item), 64, '0'),
					item, 0, evidence.log_index, ${oracle.toLowerCase()}, '[]'::jsonb, '0x', evidence.event_name,
					CASE evidence.log_index
						WHEN 1 THEN jsonb_build_object('pair', '0x' || lpad(to_hex(item + 1000000), 40, '0'))
						WHEN 2 THEN jsonb_build_object('from', '0x0000000000000000000000000000000000000000', 'to', ${address.toLowerCase()}::text, 'amount', item::text)
						WHEN 4 THEN jsonb_build_object('universeId', item::text, 'migrator', ${address.toLowerCase()}::text)
						WHEN 5 THEN jsonb_build_object('reportId', item::text, 'currentReporter', ${address.toLowerCase()}::text)
						ELSE jsonb_build_object('universeId', (item + 1000)::text)
					END,
					'[]'::jsonb, 'decoded', evidence.event_name, true, true
				FROM generate_series(2, 261) item
				CROSS JOIN (VALUES (1, 'PairCreated'), (2, 'Transfer'), (6, 'UniverseForked')) evidence(log_index, event_name)
				UNION ALL
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'), '0x' || lpad(to_hex(item), 64, '0'),
					item, 0, evidence.log_index, ${oracle.toLowerCase()}, '[]'::jsonb, '0x', evidence.event_name,
					CASE evidence.log_index
						WHEN 4 THEN jsonb_build_object('universeId', item::text, 'migrator', ${address.toLowerCase()}::text)
						ELSE jsonb_build_object('reportId', item::text, 'currentReporter', ${address.toLowerCase()}::text)
					END,
					'[]'::jsonb, 'decoded', evidence.event_name, true, true
				FROM generate_series(2, 103) item
				CROSS JOIN (VALUES (4, 'MigrationRepAdded'), (5, 'ReportSubmitted')) evidence(log_index, event_name)
			`
			await database.sql`
				INSERT INTO amm_markets (
					chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address,
					share_token_address, universe_id, fee_bps, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					1, item, '0x' || lpad(to_hex(item + 1000000), 40, '0'),
					'0x' || lpad(to_hex(item + 2000000), 40, '0'), ${address.toLowerCase()}, 1, 30, true
				FROM generate_series(2, 103) item
			`
			await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					2, item, '0x' || lpad(to_hex(item + 1000000), 40, '0'), 'Transfer',
					jsonb_build_object('from', '0x0000000000000000000000000000000000000000', 'to', ${address.toLowerCase()}::text, 'amount', item::text), true
				FROM generate_series(2, 103) item
			`
			await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
					topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
				) VALUES (
					${operationsChainId}, ${`0x${(20002).toString(16).padStart(64, '0')}`}, ${`0x${(2).toString(16).padStart(64, '0')}`},
					2, 0, 3, ${`0x${(1000002).toString(16).padStart(40, '0')}`}, '[]'::jsonb, '0x', 'Transfer',
					jsonb_build_object('from', ${address.toLowerCase()}::text, 'to', ${address.toLowerCase()}::text, 'amount', '999'),
					'[]'::jsonb, 'decoded', 'Transfer', true, true
				)
			`
			await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				) VALUES (
					${operationsChainId}, ${`0x${(2).toString(16).padStart(64, '0')}`}, ${`0x${(20002).toString(16).padStart(64, '0')}`},
					3, 2, ${`0x${(1000002).toString(16).padStart(40, '0')}`}, 'Transfer',
					jsonb_build_object('from', ${address.toLowerCase()}::text, 'to', ${address.toLowerCase()}::text, 'amount', '999'), true
				)
			`
			await database.sql`
				INSERT INTO fork_migration_events (
					chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					4, item, item::text, 'MigrationRepAdded', jsonb_build_object('universeId', item::text, 'migrator', ${address.toLowerCase()}::text), true
				FROM generate_series(2, 103) item
				UNION ALL
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					6, item, (item + 1000)::text, 'UniverseForked', jsonb_build_object('universeId', (item + 1000)::text), true
				FROM generate_series(2, 261) item
			`
			await database.sql`
				INSERT INTO open_oracle_report_events (
					chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
					report_id, event_name, round_number, report_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					5, item, ${oracle.toLowerCase()}, item, 'ReportSubmitted', 1,
					jsonb_build_object('reportId', item::text, 'currentReporter', ${address.toLowerCase()}::text), true
				FROM generate_series(2, 103) item
			`
			await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
					topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
				) VALUES
					(${operationsChainId}, ${transactionHash}, ${hash}, 1, 0, 20, ${promotedAddress.toLowerCase()},
						'[]'::jsonb, '0x', 'PriceRequested', jsonb_build_object('reportId', '7'), '[]'::jsonb,
						'decoded', 'Price requested', true, true),
					(${operationsChainId}, ${transactionHash}, ${hash}, 1, 0, 21, ${promotedAddress.toLowerCase()},
						'[]'::jsonb, '0x', 'PriceReportRejected', jsonb_build_object('reportId', '7', 'reason', 'first rejection'),
						'[]'::jsonb, 'decoded', 'Price report rejected', true, true),
					(${operationsChainId}, ${transactionHash}, ${hash}, 1, 0, 22, ${promotedAddress.toLowerCase()},
						'[]'::jsonb, '0x', 'PendingReportRecovered', jsonb_build_object('reportId', '7'), '[]'::jsonb,
						'decoded', 'Pending report recovered', true, true)
			`
			await database.sql`
				INSERT INTO pools (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
					universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
					security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
					initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					1, item, '0x' || lpad(to_hex(item + 2000000), 40, '0'), ${address.toLowerCase()}, 1, 1,
					${address.toLowerCase()}, ${oracle.toLowerCase()}, ${address.toLowerCase()}, 15000, 0, 0, 0, true
				FROM generate_series(2, 261) item
			`
			await database.sql`
				INSERT INTO questions (
					chain_id, block_hash, tx_hash, log_index, block_number, question_id, created_timestamp,
					title, description, start_time, end_time, num_ticks, display_value_min,
					display_value_max, answer_unit, outcome_options, canonical
				) VALUES (
					${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, 1,
					timestamptz '2026-01-01 00:00:20+00', 'Will the 🔮 forecast resolve?', 'Unicode cursor fixture',
					timestamptz '2026-01-01 00:00:20+00', timestamptz '2026-01-02 00:00:20+00',
					1000, 0, 1, 'probability', '["No","Yes"]'::jsonb, true
				)
			`
			await database.sql`
				INSERT INTO vault_snapshots (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address,
					rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index,
					vault_fee_remainder, resulting_total_rep_backing_units,
					resulting_fee_eligible_capacity_ownership_atto_rep, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					2, item, '0x' || lpad(to_hex(item + 2000000), 40, '0'), '0x' || lpad(to_hex(item + 3000000), 40, '0'),
					100, 100, 0, 0, 0, 100, 100, true
				FROM generate_series(2, 261) item
			`

			const unicodeTradingQuery = encodeURIComponent('🔮')
			const firstUnicodeTradingPageResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/trading?chainId=${operationsChainId}&q=${unicodeTradingQuery}&limit=1`),
				database.sql,
			)
			const firstUnicodeTradingPage = (await firstUnicodeTradingPageResponse?.json()) as {
				data: { items: Array<{ question_title: string }>; total: number; hasMore: boolean; nextCursor?: string }
			}
			expect(firstUnicodeTradingPage.data).toMatchObject({
				items: [expect.objectContaining({ question_title: 'Will the 🔮 forecast resolve?' })],
				total: 102,
				hasMore: true,
			})
			const unicodeTradingCursor = firstUnicodeTradingPage.data.nextCursor
			if (typeof unicodeTradingCursor !== 'string') throw new Error('Unicode trading catalog omitted its continuation')
			const mismatchedUnicodeTradingFilterResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/trading?chainId=${operationsChainId}&q=${encodeURIComponent('🪐')}&limit=1&cursor=${encodeURIComponent(unicodeTradingCursor)}`,
				),
				database.sql,
			)
			expect(mismatchedUnicodeTradingFilterResponse?.status).toBe(400)
			const secondUnicodeTradingPageResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/trading?chainId=${operationsChainId}&q=${unicodeTradingQuery}&limit=1&cursor=${encodeURIComponent(unicodeTradingCursor)}`,
				),
				database.sql,
			)
			expect(await secondUnicodeTradingPageResponse?.json()).toMatchObject({
				data: {
					items: [expect.objectContaining({ question_title: 'Will the 🔮 forecast resolve?' })],
					total: 102,
					offset: 1,
					hasMore: true,
				},
			})

			const firstResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&decisionLimit=1`),
				database.sql,
			)
			if (firstResponse === undefined) throw new Error('report detail endpoint did not return a response')
			const first = (await firstResponse.json()) as {
				data: {
					rounds: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string }
					coordinatorDecisions: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor: string }
				}
			}
			expect(first.data.rounds).toMatchObject({ hasMore: true })
			expect(first.data.rounds.items).toHaveLength(1)
			expect(first.data.rounds.items[0]?.['comparison']).toMatchObject({
				state: 'compared',
				changes: expect.arrayContaining([expect.objectContaining({ field: 'currentAmount1', kind: 'removed', before: '100' })]),
			})
			expect(first.data.coordinatorDecisions).toMatchObject({ hasMore: true })
			expect(first.data.coordinatorDecisions.items).toHaveLength(1)
			const decisionItems = [...first.data.coordinatorDecisions.items]
			let decisionCursor: string | undefined = first.data.coordinatorDecisions.nextCursor
			while (decisionCursor !== undefined) {
				const decisionResponse = await handleApi(
					new Request(
						`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&decisionLimit=1&decisionCursor=${encodeURIComponent(decisionCursor)}`,
					),
					database.sql,
				)
				if (decisionResponse === undefined) throw new Error('coordinator decision continuation did not return a response')
				const decisionPage = (await decisionResponse.json()) as {
					data: { coordinatorDecisions: { items: Array<Record<string, unknown>>; hasMore: boolean; nextCursor?: string } }
				}
				decisionItems.push(...decisionPage.data.coordinatorDecisions.items)
				decisionCursor = decisionPage.data.coordinatorDecisions.nextCursor
			}
			expect(decisionItems).toHaveLength(3)
			expect(new Set(decisionItems.map((item) => `${String(item['tx_hash'])}:${String(item['log_index'])}`)).size).toBe(3)
			await database.sql`
				UPDATE networks SET applied_application_source_hash = 'changed-during-decision-pagination'
				WHERE chain_id = ${operationsChainId}
			`
			const staleDecisionResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?decisionLimit=1&decisionCursor=${encodeURIComponent(first.data.coordinatorDecisions.nextCursor)}`,
				),
				database.sql,
			)
			expect(staleDecisionResponse?.status).toBe(409)
			await database.sql`
				UPDATE networks SET applied_application_source_hash = NULL WHERE chain_id = ${operationsChainId}
			`
			const secondResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&cursor=${encodeURIComponent(first.data.rounds.nextCursor)}`,
				),
				database.sql,
			)
			if (secondResponse === undefined) throw new Error('report detail continuation did not return a response')
			const second = (await secondResponse.json()) as { data: { rounds: { items: unknown[]; hasMore: boolean; nextCursor: string } } }
			expect(second.data.rounds).toMatchObject({ hasMore: true })
			expect(second.data.rounds.items).toHaveLength(1)
			const thirdResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/reports/${operationsChainId}/${oracle.toLowerCase()}/7?limit=1&cursor=${encodeURIComponent(second.data.rounds.nextCursor)}`,
				),
				database.sql,
			)
			if (thirdResponse === undefined) throw new Error('report detail final continuation did not return a response')
			const third = (await thirdResponse.json()) as { data: { rounds: { items: unknown[]; hasMore: boolean } } }
			expect(third.data.rounds).toMatchObject({ hasMore: false })
			expect(third.data.rounds.items).toHaveLength(1)

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
			expect(firstCatalog.data.items[0]).toMatchObject({ report_id: '103', tx_hash: `0x${(20103).toString(16).padStart(64, '0')}` })
			const secondCatalogResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1&cursor=${encodeURIComponent(firstCatalog.data.nextCursor)}`),
				database.sql,
			)
			if (secondCatalogResponse === undefined) throw new Error('report catalog continuation did not return a response')
			const secondCatalog = (await secondCatalogResponse.json()) as { data: { items: Array<{ report_id: string }> } }
			expect(secondCatalog.data.items.map((item) => item.report_id)).toEqual(['102'])
			const generationRows = await database.sql`
					INSERT INTO chain_reorganizations
						(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
					VALUES (${operationsChainId}, 1, ${hash}, 1, ${hash}, 0, 'projection-rebuild')
					RETURNING id::text
				`
			const generationId = generationRows[0]?.['id']
			if (typeof generationId !== 'string') throw new Error('same-head projection generation was not recorded')
			const staleCatalogResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/reports?chainId=${operationsChainId}&limit=1&cursor=${encodeURIComponent(firstCatalog.data.nextCursor)}`),
				database.sql,
			)
			expect(staleCatalogResponse?.status).toBe(409)
			await database.sql`DELETE FROM chain_reorganizations WHERE id = ${generationId}`

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

			const selfTransferMarket = `0x${(1000002).toString(16).padStart(40, '0')}`
			const selfTransferResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${selfTransferMarket}`),
				database.sql,
			)
			if (selfTransferResponse === undefined) throw new Error('self-transfer trading endpoint did not return a response')
			const selfTransfer = (await selfTransferResponse.json()) as {
				data: { lpPositions: Array<{ address: string; received_liquidity: string; sent_liquidity: string; balance: string }> }
			}
			expect(selfTransfer.data.lpPositions).toContainEqual({
				address: address.toLowerCase(),
				received_liquidity: '1001',
				sent_liquidity: '999',
				balance: '2',
			})

			const portfolioResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/address-portfolio?chainId=${operationsChainId}&address=${address.toLowerCase()}`),
				database.sql,
			)
			if (portfolioResponse === undefined) throw new Error('portfolio endpoint did not return a response')
			const portfolio = (await portfolioResponse.json()) as {
				data: {
					lp_positions: Array<{ market_address: string; balance: string }>
					fork_participation: Array<{ universe_identity: string }>
					report_participation: Array<{ report_id: string }>
					portfolioPagination: Record<'lp' | 'forks' | 'reports', { total: number; hasMore: boolean; nextCursor: string }>
				}
			}
			expect(portfolio.data.lp_positions).toHaveLength(100)
			expect(portfolio.data.fork_participation).toHaveLength(100)
			expect(portfolio.data.report_participation).toHaveLength(100)
			for (const kind of ['lp', 'forks', 'reports'] as const) expect(portfolio.data.portfolioPagination[kind]).toMatchObject({ total: 102, hasMore: true })

			const portfolioContinuationUrl = new URL('http://localhost/api/v1/state/address-portfolio')
			portfolioContinuationUrl.search = new URLSearchParams({
				chainId: String(operationsChainId),
				address: address.toLowerCase(),
				lpCursor: portfolio.data.portfolioPagination.lp.nextCursor,
				forkCursor: portfolio.data.portfolioPagination.forks.nextCursor,
				reportCursor: portfolio.data.portfolioPagination.reports.nextCursor,
			}).toString()
			const portfolioContinuationResponse = await handleApi(new Request(portfolioContinuationUrl), database.sql)
			if (portfolioContinuationResponse === undefined) throw new Error('portfolio continuation did not return a response')
			const portfolioContinuation = (await portfolioContinuationResponse.json()) as typeof portfolio
			expect(portfolioContinuation.data.lp_positions).toHaveLength(2)
			expect(portfolioContinuation.data.fork_participation).toHaveLength(2)
			expect(portfolioContinuation.data.report_participation).toHaveLength(2)
			for (const kind of ['lp', 'forks', 'reports'] as const)
				expect(portfolioContinuation.data.portfolioPagination[kind]).toMatchObject({ total: 102, hasMore: false })
			expect(new Set([...portfolio.data.lp_positions, ...portfolioContinuation.data.lp_positions].map((item) => item.market_address)).size).toBe(102)
			expect(portfolioContinuation.data.lp_positions.find((item) => item.market_address === selfTransferMarket)).toMatchObject({ balance: '2' })

			const changedPortfolioCursor = decodeOpaqueCursor(portfolio.data.portfolioPagination.lp.nextCursor) as unknown[]
			changedPortfolioCursor[9] = 103
			const changedPortfolioResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/address-portfolio?chainId=${operationsChainId}&address=${address.toLowerCase()}&lpCursor=${encodeURIComponent(btoa(JSON.stringify(changedPortfolioCursor)))}`,
				),
				database.sql,
			)
			expect(changedPortfolioResponse?.status).toBe(409)

			const riskCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk?chainId=${operationsChainId}&limit=250`), database.sql)
			if (riskCatalogResponse === undefined) throw new Error('risk catalog did not return a response')
			const riskCatalog = (await riskCatalogResponse.json()) as {
				data: {
					pools: unknown[]
					vaults: unknown[]
					pagination: {
						poolTotal: number
						poolHasMore: boolean
						poolNextCursor: string
						vaultTotal: number
						vaultHasMore: boolean
						vaultNextCursor: string
					}
				}
			}
			expect(riskCatalog.data.pools).toHaveLength(250)
			expect(riskCatalog.data.vaults).toHaveLength(250)
			expect(riskCatalog.data.pagination).toMatchObject({
				poolTotal: 261,
				poolHasMore: true,
				vaultTotal: 261,
				vaultHasMore: true,
			})
			const riskContinuationResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/risk?chainId=${operationsChainId}&limit=250&poolCursor=${encodeURIComponent(riskCatalog.data.pagination.poolNextCursor)}&vaultCursor=${encodeURIComponent(riskCatalog.data.pagination.vaultNextCursor)}`,
				),
				database.sql,
			)
			if (riskContinuationResponse === undefined) throw new Error('risk catalog continuation did not return a response')
			const riskContinuation = (await riskContinuationResponse.json()) as typeof riskCatalog
			expect(riskContinuation.data.pools).toHaveLength(11)
			expect(riskContinuation.data.vaults).toHaveLength(11)
			expect(riskContinuation.data.pagination).toMatchObject({
				poolTotal: 261,
				poolHasMore: false,
				vaultTotal: 261,
				vaultHasMore: false,
			})

			const forkCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/forks?chainId=${operationsChainId}&limit=250`), database.sql)
			if (forkCatalogResponse === undefined) throw new Error('fork catalog did not return a response')
			const forkCatalog = (await forkCatalogResponse.json()) as {
				data: { items: Array<{ universe_identity: string }>; total: number; hasMore: boolean; nextCursor: string }
			}
			expect(forkCatalog.data).toMatchObject({ total: 260, hasMore: true })
			expect(forkCatalog.data.items).toHaveLength(250)
			const forkContinuationResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/forks?chainId=${operationsChainId}&limit=250&cursor=${encodeURIComponent(forkCatalog.data.nextCursor)}`),
				database.sql,
			)
			if (forkContinuationResponse === undefined) throw new Error('fork catalog continuation did not return a response')
			const forkContinuation = (await forkContinuationResponse.json()) as typeof forkCatalog
			expect(forkContinuation.data).toMatchObject({ total: 260, hasMore: false })
			expect(forkContinuation.data.items).toHaveLength(10)
			expect(new Set([...forkCatalog.data.items, ...forkContinuation.data.items].map((item) => item.universe_identity)).size).toBe(260)

			const sameBlockPool = `0x${(4000002).toString(16).padStart(40, '0')}`
			await database.sql`
				INSERT INTO pools (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
					universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
					security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
					initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
				) VALUES (
					${operationsChainId}, ${`0x${(2).toString(16).padStart(64, '0')}`}, ${`0x${(20002).toString(16).padStart(64, '0')}`},
					6, 2, ${sameBlockPool}, ${address.toLowerCase()}, 1, 1, ${address.toLowerCase()},
					${oracle.toLowerCase()}, ${address.toLowerCase()}, 15000, 0, 0, 0, true
				)
			`
			const firstQuestionHistoryResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=2&toBlock=2&limit=1`),
				database.sql,
			)
			if (firstQuestionHistoryResponse === undefined) throw new Error('question history did not return a response')
			const firstQuestionHistory = (await firstQuestionHistoryResponse.json()) as {
				pools: Array<{ pool_address: string }>
				coverage: { nextCursor: string }
			}
			expect(firstQuestionHistory.pools).toHaveLength(1)
			expect(firstQuestionHistory.coverage.nextCursor).toBeString()
			const secondQuestionHistoryResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=2&toBlock=2&limit=1&cursor=${encodeURIComponent(firstQuestionHistory.coverage.nextCursor)}`,
				),
				database.sql,
			)
			if (secondQuestionHistoryResponse === undefined) throw new Error('question history continuation did not return a response')
			const secondQuestionHistory = (await secondQuestionHistoryResponse.json()) as { pools: Array<{ pool_address: string }> }
			expect(secondQuestionHistory.pools).toHaveLength(1)
			expect(secondQuestionHistory.pools[0]?.pool_address).not.toBe(firstQuestionHistory.pools[0]?.pool_address)
			const mismatchedQuestionHistoryResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=1&toBlock=2&limit=1&cursor=${encodeURIComponent(firstQuestionHistory.coverage.nextCursor)}`,
				),
				database.sql,
			)
			expect(mismatchedQuestionHistoryResponse?.status).toBe(400)
			const stateHistoryGeneration = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${operationsChainId}, 10003, ${`0x${(10003).toString(16).padStart(64, '0')}`}, 10003,
					${`0x${(10003).toString(16).padStart(64, '0')}`}, 0, 'projection-rebuild')
				RETURNING id::text
			`
			const staleQuestionHistoryResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/questions/${operationsChainId}/1?fromBlock=2&toBlock=2&limit=1&cursor=${encodeURIComponent(firstQuestionHistory.coverage.nextCursor)}`,
				),
				database.sql,
			)
			expect(staleQuestionHistoryResponse?.status).toBe(409)
			await database.sql`DELETE FROM chain_reorganizations WHERE id = ${stateHistoryGeneration[0]?.['id']}`

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
				observationsTruncated: false,
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
				INSERT INTO entity_state_observations (
					chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					source_method, read_status, read_result, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				)
				SELECT chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					'augurscan.vault-risk.cursor-test', read_status, read_result, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				FROM entity_state_observations
				WHERE chain_id = ${operationsChainId} AND entity_type = 'vault'
				LIMIT 1
			`
			const firstRiskHistoryResponse = await handleApi(
				new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}?limit=1`),
				database.sql,
			)
			if (firstRiskHistoryResponse === undefined) throw new Error('vault risk history did not return a response')
			const firstRiskHistory = (await firstRiskHistoryResponse.json()) as {
				data: { history: { stateSnapshots: Array<{ id: string }>; nextCursor: string } }
			}
			expect(firstRiskHistory.data.history.stateSnapshots).toHaveLength(1)
			expect(firstRiskHistory.data.history.nextCursor).toBeString()
			const secondRiskHistoryResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}?limit=1&cursor=${encodeURIComponent(firstRiskHistory.data.history.nextCursor)}`,
				),
				database.sql,
			)
			expect(secondRiskHistoryResponse?.status).toBe(200)
			const secondRiskHistory = (await secondRiskHistoryResponse?.json()) as {
				data: { history: { stateSnapshots: Array<{ id: string }> } }
			}
			expect(secondRiskHistory.data.history.stateSnapshots).toHaveLength(1)
			expect(secondRiskHistory.data.history.stateSnapshots[0]?.id).not.toBe(firstRiskHistory.data.history.stateSnapshots[0]?.id)
			const riskHistoryGeneration = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${operationsChainId}, 10003, ${`0x${(10003).toString(16).padStart(64, '0')}`}, 10003,
					${`0x${(10003).toString(16).padStart(64, '0')}`}, 0, 'projection-rebuild')
				RETURNING id::text
			`
			const staleRiskHistoryResponse = await handleApi(
				new Request(
					`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}?limit=1&cursor=${encodeURIComponent(firstRiskHistory.data.history.nextCursor)}`,
				),
				database.sql,
			)
			expect(staleRiskHistoryResponse?.status).toBe(409)
			await database.sql`DELETE FROM chain_reorganizations WHERE id = ${riskHistoryGeneration[0]?.['id']}`

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
			const paginationPlans = await database.sql.begin(async (transaction) => {
				await transaction.unsafe('SET LOCAL enable_seqscan = off')
				return {
					balance: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM address_balance_observations
						WHERE chain_id = ${operationsChainId} ORDER BY observed_at DESC, id DESC LIMIT 100`,
					metadata: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM token_metadata_observations
						WHERE chain_id = ${operationsChainId} ORDER BY observed_at DESC, id DESC LIMIT 100`,
					pool: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM pool_snapshots
						WHERE chain_id = ${operationsChainId} AND pool_address = ${oracle.toLowerCase()} AND canonical
						ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 100`,
					vault: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM vault_snapshots
						WHERE chain_id = ${operationsChainId} AND pool_address = ${oracle.toLowerCase()}
							AND vault_address = ${address.toLowerCase()} AND canonical
						ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 100`,
					timeline: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM protocol_timeline_entries
						WHERE chain_id = ${operationsChainId} AND entity_type = 'vault'
							AND entity_identity = ${`${oracle.toLowerCase()}:${address.toLowerCase()}`} AND canonical
						ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 100`,
				}
			})
			expect(JSON.stringify(paginationPlans.balance)).toContain('address_balance_observation_page')
			expect(JSON.stringify(paginationPlans.metadata)).toContain('token_metadata_observation_page')
			expect(JSON.stringify(paginationPlans.pool)).toContain('pool_snapshots_detail_page')
			expect(JSON.stringify(paginationPlans.vault)).toContain('vault_snapshots_detail_page')
			expect(JSON.stringify(paginationPlans.timeline)).toMatch(/protocol_timeline_(entity_)?history_page/)

			const resetLease = await database.tryAcquireIndexerLock(operationsChainId)
			if (resetLease === undefined) throw new Error('operations manifest-reset writer did not acquire its lock')
			expect(
				await database.seedNetwork(
					{ ...network, contracts: [[address, 'Replacement manifest contract', 'openOracle']] },
					{ lease: resetLease, resetCanonicalHistoryOnManifestChange: true },
				),
			).toBe(true)
			await resetLease.release()
			const retainedSnapshots = await database.sql`
				SELECT DISTINCT read_status, canonical FROM entity_state_snapshots WHERE chain_id = ${operationsChainId}
			`
			expect(retainedSnapshots).toEqual([{ read_status: 'success', canonical: true }])
			const retainedStateObservations = await database.sql`
				SELECT DISTINCT read_status, canonical FROM entity_state_observations WHERE chain_id = ${operationsChainId}
			`
			expect(retainedStateObservations).toEqual([{ read_status: 'success', canonical: true }])

			const clearedDerivedRows = await database.sql`
					SELECT
						(SELECT count(*) FROM pools WHERE chain_id = ${operationsChainId})::integer AS pools,
						(SELECT count(*) FROM pool_state_events WHERE chain_id = ${operationsChainId})::integer AS pool_events,
						(SELECT count(*) FROM vault_snapshots WHERE chain_id = ${operationsChainId})::integer AS vaults,
						(SELECT count(*) FROM escalation_game_events WHERE chain_id = ${operationsChainId})::integer AS escalations,
						(SELECT count(*) FROM truth_auction_events WHERE chain_id = ${operationsChainId})::integer AS auctions
				`
			expect(clearedDerivedRows[0]).toEqual({ pools: 0, pool_events: 0, vaults: 0, escalations: 0, auctions: 0 })
			const resampleTargets = await database.stateSnapshotTargets(operationsChainId, 1n, 1_000)
			expect(resampleTargets).toEqual([])
		} finally {
			await database.close()
		}
	},
	60_000,
)
