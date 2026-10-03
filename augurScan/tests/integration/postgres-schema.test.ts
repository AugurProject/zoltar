import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { canonicalTablePolicies, ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import { CURRENT_SCHEMA_VERSION, UNSUPPORTED_SCHEMA_MESSAGE } from '../../src/schema-policy.ts'
import { address, blockHash, chainId, discoveredAddress, expectBehaviorChangingSchemaObjectsRejected, inverseUniswapPairAddress, pairAddress, postgresTest, rediscoveredAddress, requirePostgresUrl, wethAddress } from '../support/postgres-fixtures.ts'

const v1ForkLogs = [
	{ block: 100n, parentUniverseId: '10', childUniverseId: '11', canonical: true },
	{ block: 101n, parentUniverseId: '20', childUniverseId: '21', canonical: false },
] as const
const v1PairLogs = [
	{ block: 102n, pair: pairAddress.toLowerCase(), canonical: true, augur: true },
	{ block: 103n, pair: inverseUniswapPairAddress.toLowerCase(), canonical: false, augur: false },
] as const
const survivingStateBlock = v1ForkLogs[0]
const survivingStateBlockHash = blockHash(`v1-migration-block-${survivingStateBlock.block}`)
const survivingStateTransactionHash = blockHash(`v1-migration-transaction-${survivingStateBlock.block}`)
const survivingStateReadResult = {
	settlementCollateralAttoEth: 1n.toString(),
	currentMintingCapacityAttoEth: 2n.toString(),
	totalBadDebtAttoEth: 0n.toString(),
	systemState: '1',
	price: { repPerEth1e18: '100', protocolValid: true },
}

// Removes every table, column, and index introduced after schema version 1 and marks the database as v1.
const rewindSchemaToV1Layout = async (database: ScannerDatabase): Promise<void> => {
	await database.sql.unsafe(
		'DROP TABLE public.indexer_ownership, public.address_balance_observations, public.token_metadata_observations, public.entity_state_observations, public.history_invalidation_causes, public.action_interpretations, public.log_interpretations, public.history_invalidation_occurrences, public.chain_reorganizations, public.indexer_runs, public.augurscan_schema_migrations',
	)
	await database.sql.unsafe('ALTER TABLE public.entity_state_snapshots DROP COLUMN indexer_run_id, DROP COLUMN abi_source_hash, DROP COLUMN application_source_hash, DROP COLUMN projection_source_hash')
	await database.sql.unsafe('ALTER TABLE public.networks DROP COLUMN applied_abi_source_hash, DROP COLUMN applied_application_source_hash, DROP COLUMN applied_projection_source_hash')
	await database.sql.unsafe('ALTER TABLE public.contracts DROP COLUMN configured_deployment_block')
	await database.sql.unsafe('DROP INDEX public.pool_snapshots_detail_page, public.protocol_timeline_entity_history_page, public.protocol_timeline_history_page, public.vault_snapshots_detail_page')
	await database.sql.unsafe('ALTER TABLE questions ALTER COLUMN start_time TYPE timestamptz USING to_timestamp(start_time), ALTER COLUMN end_time TYPE timestamptz USING to_timestamp(end_time)')
	await database.sql`UPDATE augurscan_schema SET schema_version = '1' WHERE singleton`
}

// A v1 marker must not excuse a missing index, an unexpected table, or behavior-changing objects.
const expectAlteredV1LayoutsRejected = async (database: ScannerDatabase): Promise<void> => {
	await database.sql.unsafe('DROP INDEX public.protocol_timeline_recent')
	try {
		await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	} finally {
		await database.sql.unsafe('CREATE INDEX protocol_timeline_recent ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC) WHERE canonical')
	}
	await database.sql.unsafe('CREATE TABLE public.augurscan_v1_layout_intruder (id integer)')
	try {
		await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	} finally {
		await database.sql.unsafe('DROP TABLE public.augurscan_v1_layout_intruder')
	}
	await expectBehaviorChangingSchemaObjectsRejected(database)
}

// Writes canonical and orphaned v1 fork and pair evidence with their blocks and transactions.
const seedV1TimelineEvidence = async (database: ScannerDatabase, migrationChainId: number): Promise<void> => {
	await database.sql`
		INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block)
		VALUES (${migrationChainId}, ${`migration-${migrationChainId}`}, 'Migration fixture', 'https://example.invalid', 0)
	`
	for (const item of [...v1ForkLogs, ...v1PairLogs]) {
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
	for (const item of v1ForkLogs) {
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
	for (const item of v1PairLogs) {
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
}

// Writes the v1 pool identity, state snapshot, balance, and token metadata that must survive the migration.
const seedV1SurvivingState = async (database: ScannerDatabase, migrationChainId: number): Promise<void> => {
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
}

const expectMigratedTimelineEvidence = async (database: ScannerDatabase, migrationChainId: number): Promise<void> => {
	expect((await database.sql`SELECT to_regclass('public.indexer_ownership')::text AS relation`)[0]?.['relation']).toBe('indexer_ownership')
	const migratedMarker = await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`
	expect(migratedMarker).toEqual([{ schema_version: CURRENT_SCHEMA_VERSION }])
	const appliedMigrations = await database.sql`SELECT schema_version FROM augurscan_schema_migrations ORDER BY schema_version`
	expect(appliedMigrations).toEqual([{ schema_version: '2' }, { schema_version: '3' }, { schema_version: '4' }, { schema_version: '5' }])
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
}

const expectMigratedObservations = async (database: ScannerDatabase, migrationChainId: number): Promise<void> => {
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
	expect(migratedBalanceObservations).toEqual([{ read_status: 'success', balance: '77', read_failure_reason: null, canonical: true, indexer_run_id: null, application_source_hash: null }])
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
}

const expectMigratedRiskWithoutProvenance = async (database: ScannerDatabase, migrationChainId: number): Promise<void> => {
	const migratedRiskResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/pools/${migrationChainId}/${discoveredAddress.toLowerCase()}`), database.sql)
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
}
postgresTest('rejects every public namespace object before fresh schema initialization', async () => {
	const postgresUrl = requirePostgresUrl()
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
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	try {
		await initializeSchema(database.sql)

		await database.sql.unsafe('DROP INDEX public.protocol_timeline_recent')
		try {
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
		} finally {
			await database.sql.unsafe('CREATE INDEX protocol_timeline_recent ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC) WHERE canonical')
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

postgresTest('migrates v1 canonical and orphan timeline evidence through current identities, provenance, and ownership state', async () => {
	const postgresUrl = requirePostgresUrl()
	const database = new ScannerDatabase(postgresUrl)
	const migrationChainId = chainId + 20 + process.pid
	try {
		await initializeSchema(database.sql)
		await database.sql`DELETE FROM networks WHERE chain_id = ${migrationChainId}`
		await rewindSchemaToV1Layout(database)
		await expectAlteredV1LayoutsRejected(database)
		await seedV1TimelineEvidence(database, migrationChainId)
		await seedV1SurvivingState(database, migrationChainId)

		await initializeSchema(database.sql)
		await expectMigratedTimelineEvidence(database, migrationChainId)
		await expectMigratedObservations(database, migrationChainId)
		await expectMigratedRiskWithoutProvenance(database, migrationChainId)
	} finally {
		await initializeSchema(database.sql)
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest('classifies every chain-scoped canonical table', async () => {
	const postgresUrl = requirePostgresUrl()
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
