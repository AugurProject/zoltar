import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { canonicalTablePolicies, ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import { CURRENT_SCHEMA_VERSION, UNSUPPORTED_SCHEMA_MESSAGE } from '../../src/schema-policy.ts'
import { rewindAccountingStorageToV6, rewindAuctionNamingToV5, rewindStaleContractValuesToV7 } from '../support/schema-fixtures.ts'
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
	await rewindAuctionNamingToV5(database)
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
	expect(appliedMigrations).toEqual([{ schema_version: '2' }, { schema_version: '3' }, { schema_version: '4' }, { schema_version: '5' }, { schema_version: '6' }, { schema_version: '7' }, { schema_version: '8' }])
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
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
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

postgresTest('renames v5 auction storage without losing canonical or orphan history and pools', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	const migrationChainId = chainId + 60 + process.pid
	try {
		await initializeSchema(database.sql)
		await database.sql`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block) VALUES (${migrationChainId}, ${`auction-rename-${migrationChainId}`}, 'Auction rename fixture', 'https://example.invalid', 0)`
		for (const canonical of [true, false]) {
			const number = canonical ? 1 : 2
			const hash = blockHash(`auction-rename-block-${number}`)
			const txHash = blockHash(`auction-rename-transaction-${number}`)
			await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES (${migrationChainId}, ${number}, ${hash}, ${blockHash('auction-rename-parent')}, now(), ${canonical})`
			await database.sql`INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, receipt, canonical) VALUES (${migrationChainId}, ${txHash}, ${hash}, ${number}, 0, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 0, '0x', 'success', '{}'::jsonb, ${canonical})`
			// These are historical v5 decoded arguments; schema migration must not rewrite their provenance.
			const deploymentArgs = JSON.stringify({ securityPool: address, truthAuction: discoveredAddress })
			const auctionArgs = JSON.stringify({ raisedAttoEth: 7n.toString(), soldAttoRep: 11n.toString() })
			await database.sql`
				INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, event_name, arguments, decode_status, summary, canonical)
				VALUES (${migrationChainId}, ${txHash}, ${hash}, ${number}, 0, 0, ${address.toLowerCase()}, '[]'::jsonb, '0x', 'DeploySecurityPool', (${deploymentArgs}::text)::jsonb, 'decoded', 'DeploySecurityPool', ${canonical}),
				(${migrationChainId}, ${txHash}, ${hash}, ${number}, 0, 1, ${discoveredAddress.toLowerCase()}, '[]'::jsonb, '0x', 'AuctionFinalized', (${auctionArgs}::text)::jsonb, 'decoded', 'AuctionFinalized', ${canonical})
			`
			await database.sql`
				INSERT INTO pools (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address, universe_id, question_id, coordinator_address, share_token_address, security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, canonical)
				VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, ${number}, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 1, 2, ${address.toLowerCase()}, ${rediscoveredAddress.toLowerCase()}, 10500, 1, ${canonical})
			`
			await database.sql`INSERT INTO collateral_repair_auction_events (chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical) VALUES (${migrationChainId}, ${hash}, ${txHash}, 1, ${number}, ${discoveredAddress.toLowerCase()}, 'AuctionFinalized', (${auctionArgs}::text)::jsonb, ${canonical})`
		}
		const historyBefore = await database.sql`SELECT block_number, auction_address, event_name, event_data, canonical, observed_at FROM collateral_repair_auction_events WHERE chain_id = ${migrationChainId} ORDER BY block_number`
		const poolsBefore = await database.sql`SELECT pool_address, coordinator_address, canonical FROM pools WHERE chain_id = ${migrationChainId} ORDER BY block_number`
		const logsBefore = await database.sql`SELECT arguments FROM logs WHERE chain_id = ${migrationChainId} ORDER BY block_number, log_index`
		await rewindAuctionNamingToV5(database)
		await database.sql`UPDATE augurscan_schema SET schema_version = '5' WHERE singleton`
		await database.sql`DELETE FROM augurscan_schema_migrations WHERE schema_version::integer > 5`
		await initializeSchema(database.sql)
		expect(await database.sql`SELECT block_number, auction_address, event_name, event_data, canonical, observed_at FROM collateral_repair_auction_events WHERE chain_id = ${migrationChainId} ORDER BY block_number`).toEqual(historyBefore)
		expect(await database.sql`SELECT pool_address, coordinator_address, canonical FROM pools WHERE chain_id = ${migrationChainId} ORDER BY block_number`).toEqual(poolsBefore)
		expect(await database.sql`SELECT arguments FROM logs WHERE chain_id = ${migrationChainId} ORDER BY block_number, log_index`).toEqual(logsBefore)
		const migratedMarker = await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`
		expect(migratedMarker).toEqual([{ schema_version: CURRENT_SCHEMA_VERSION }])
		const oldRelation = await database.sql`SELECT to_regclass('public.truth_auction_events') AS old_name`
		expect(oldRelation).toEqual([{ old_name: null }])
		// A second startup must accept the migrated layout without replaying DDL or changing history.
		await initializeSchema(database.sql)
		const historyAfterSecondStartup = await database.sql`SELECT count(*)::integer AS count FROM collateral_repair_auction_events WHERE chain_id = ${migrationChainId}`
		expect(historyAfterSecondStartup).toEqual([{ count: 2 }])
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest('replaces v6 accounting storage and keeps the logs a projection rebuild reads', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	const migrationChainId = chainId + 70 + process.pid
	try {
		await initializeSchema(database.sql)
		await database.sql`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block) VALUES (${migrationChainId}, ${`accounting-storage-${migrationChainId}`}, 'Accounting storage fixture', 'https://example.invalid', 0)`
		const hash = blockHash('accounting-storage-block')
		const txHash = blockHash('accounting-storage-transaction')
		await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES (${migrationChainId}, 1, ${hash}, ${blockHash('accounting-storage-parent')}, now(), true)`
		await database.sql`INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, receipt, canonical) VALUES (${migrationChainId}, ${txHash}, ${hash}, 1, 0, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 0, '0x', 'success', '{}'::jsonb, true)`
		const checkpoint = JSON.stringify({ reason: 5, settlementCollateralAttoEth: '7', shareTokenSupplyAttoShares: '9', lastSettlementPortfolioTime: '100' })
		await database.sql`
			INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, event_name, arguments, decode_status, summary, canonical)
			VALUES (${migrationChainId}, ${txHash}, ${hash}, 1, 0, 0, ${address.toLowerCase()}, '[]'::jsonb, '0x', 'QuestionAccountingCheckpoint', (${checkpoint}::text)::jsonb, 'decoded', 'QuestionAccountingCheckpoint', true)
		`
		const logsBefore = await database.sql`SELECT event_name, arguments FROM logs WHERE chain_id = ${migrationChainId}`
		await rewindAccountingStorageToV6(database)
		// Rows projected from the removed events: the upgrade must discard them instead of failing on their shape.
		await database.sql`
			INSERT INTO pool_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, reason, vault_address, settlement_collateral_atto_eth, total_capacity_ownership_atto_rep, fee_eligible_capacity_ownership_atto_rep, total_claimable_vault_fees_atto_eth, unallocated_accrued_fees_atto_eth, fee_index, fee_index_remainder, total_fees_owed_remainder, uncheckpointed_fee_eligible_capacity_ownership_atto_rep, last_updated_fee_accumulator, current_retention_rate, canonical)
			VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, 1, ${address.toLowerCase()}, 0, ${discoveredAddress.toLowerCase()}, 1, 2, 3, 4, 5, 6, 7, 8, 9, now(), 10, true)
		`
		await database.sql`
			INSERT INTO vault_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address, rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index, vault_fee_remainder, resulting_total_rep_backing_units, resulting_fee_eligible_capacity_ownership_atto_rep, canonical)
			VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, 1, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, 1, 2, 3, 4, 5, 6, 7, true)
		`
		await database.sql`
			INSERT INTO liquidation_approval_events (chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address, approval_identity, event_name, event_data, canonical)
			VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, 0, 1, ${address.toLowerCase()}, 'approval', 'LiquidationApprovalSet', '{}'::jsonb, true)
		`
		await database.sql`UPDATE augurscan_schema SET schema_version = '6' WHERE singleton`
		await database.sql`DELETE FROM augurscan_schema_migrations WHERE schema_version::integer > 6`
		await initializeSchema(database.sql)
		expect(await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`).toEqual([{ schema_version: CURRENT_SCHEMA_VERSION }])
		expect(await database.sql`SELECT description FROM augurscan_schema_migrations WHERE schema_version = '7'`).toEqual([{ description: 'Storage for events the current contracts emit' }])
		expect(await database.sql`SELECT to_regclass('public.vault_snapshots') AS vaults, to_regclass('public.liquidation_approval_events') AS approvals`).toEqual([{ vaults: null, approvals: null }])
		expect(await database.sql`SELECT count(*)::integer AS count FROM pool_snapshots`).toEqual([{ count: 0 }])
		expect(await database.sql`SELECT event_name, arguments FROM logs WHERE chain_id = ${migrationChainId}`).toEqual(logsBefore)
		// The replaced table accepts the projection of the retained checkpoint log.
		await database.sql`
			INSERT INTO pool_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, reason, settlement_collateral_atto_eth, share_token_supply_atto_shares, last_settlement_portfolio_time, canonical)
			VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, 1, ${address.toLowerCase()}, 5, 7, 9, to_timestamp(100), true)
		`
		// A second startup must accept the migrated layout without replaying DDL.
		await initializeSchema(database.sql)
		expect(await database.sql`SELECT settlement_collateral_atto_eth::text, share_token_supply_atto_shares::text FROM pool_snapshots WHERE chain_id = ${migrationChainId}`).toEqual([{ settlement_collateral_atto_eth: '7', share_token_supply_atto_shares: '9' }])
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})

postgresTest('removes v7 seed prices and constant pool columns while keeping accepted settlements and pools', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	const migrationChainId = chainId + 80 + process.pid
	try {
		await initializeSchema(database.sql)
		await database.sql`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block) VALUES (${migrationChainId}, ${`stale-values-${migrationChainId}`}, 'Stale values fixture', 'https://example.invalid', 0)`
		const hash = blockHash('stale-values-block')
		const txHash = blockHash('stale-values-transaction')
		const coordinator = discoveredAddress.toLowerCase()
		await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES (${migrationChainId}, 1, ${hash}, ${blockHash('stale-values-parent')}, now(), true)`
		await database.sql`INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, receipt, canonical) VALUES (${migrationChainId}, ${txHash}, ${hash}, 1, 0, ${address.toLowerCase()}, ${coordinator}, 0, '0x', 'success', '{}'::jsonb, true)`
		for (const [logIndex, eventName] of [
			[0, 'DeploySecurityPool'],
			[1, 'RepEthPriceSet'],
			[2, 'PriceReported'],
		] as const) {
			await database.sql`
				INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, event_name, arguments, decode_status, summary, canonical)
				VALUES (${migrationChainId}, ${txHash}, ${hash}, 1, 0, ${logIndex}, ${coordinator}, '[]'::jsonb, '0x', ${eventName}, '{}'::jsonb, 'decoded', ${eventName}, true)
			`
		}
		await rewindStaleContractValuesToV7(database)
		await database.sql`
			INSERT INTO pools (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address, universe_id, question_id, collateral_repair_auction_address, coordinator_address, share_token_address, security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, initial_retention_rate, initial_settlement_collateral_atto_eth, canonical)
			VALUES (${migrationChainId}, ${hash}, ${txHash}, 0, 1, ${address.toLowerCase()}, ${rediscoveredAddress.toLowerCase()}, 1, 2, '0x0000000000000000000000000000000000000000', ${coordinator}, ${wethAddress.toLowerCase()}, 10500, 3, 0, 0, true)
		`
		// A row projected from the seed event no contract emits: the upgrade must discard it instead of failing on its missing report.
		await database.sql`
			INSERT INTO rep_eth_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address, event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical)
			VALUES (${migrationChainId}, ${hash}, ${txHash}, 1, 1, ${coordinator}, 'RepEthPriceSet', NULL, 18, NULL, true),
				(${migrationChainId}, ${hash}, ${txHash}, 2, 1, ${coordinator}, 'PriceReported', 42, 19, to_timestamp(2000), true)
		`
		await database.sql`UPDATE augurscan_schema SET schema_version = '7' WHERE singleton`
		await database.sql`DELETE FROM augurscan_schema_migrations WHERE schema_version = '8'`
		await initializeSchema(database.sql)
		expect(await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`).toEqual([{ schema_version: CURRENT_SCHEMA_VERSION }])
		expect(await database.sql`SELECT description FROM augurscan_schema_migrations WHERE schema_version = '8'`).toEqual([{ description: 'Removal of values no current contract supplies' }])
		expect(await database.sql`SELECT event_name, report_id::text, rep_per_eth_1e18::text, extract(epoch FROM settlement_timestamp)::integer AS settled FROM rep_eth_price_snapshots WHERE chain_id = ${migrationChainId}`).toEqual([{ event_name: 'PriceReported', report_id: '42', rep_per_eth_1e18: '19', settled: 2000 }])
		const pools = await database.sql`SELECT * FROM pools WHERE chain_id = ${migrationChainId}`
		expect(pools).toHaveLength(1)
		expect(pools[0]).toMatchObject({ pool_address: address.toLowerCase(), coordinator_address: coordinator, share_token_address: wethAddress.toLowerCase(), canonical: true })
		for (const column of ['collateral_repair_auction_address', 'initial_retention_rate', 'initial_settlement_collateral_atto_eth']) expect(pools[0]).not.toHaveProperty(column)
		expect(await database.sql`SELECT count(*)::integer AS count FROM logs WHERE chain_id = ${migrationChainId}`).toEqual([{ count: 3 }])
		// The tightened storage rejects the removed seed event and a settlement without its report.
		await expect(
			database.sql`
				INSERT INTO rep_eth_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address, event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical)
				VALUES (${migrationChainId}, ${hash}, ${txHash}, 1, 1, ${coordinator}, 'RepEthPriceSet', 1, 18, now(), true)
			`,
		).rejects.toThrow('rep_eth_price_snapshots_event_name_check')
		await expect(
			database.sql`
				INSERT INTO rep_eth_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address, event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical)
				VALUES (${migrationChainId}, ${hash}, ${txHash}, 1, 1, ${coordinator}, 'PriceReported', NULL, 18, now(), true)
			`,
		).rejects.toThrow('report_id')
		// A second startup must accept the migrated layout without replaying DDL.
		await initializeSchema(database.sql)
		expect(await database.sql`SELECT count(*)::integer AS count FROM rep_eth_price_snapshots WHERE chain_id = ${migrationChainId}`).toEqual([{ count: 1 }])
	} finally {
		await database.sql.unsafe('TRUNCATE TABLE networks CASCADE')
		await database.close()
	}
})
