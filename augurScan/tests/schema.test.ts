import { expect, test } from 'bun:test'
import {
	assertSupportedPostgresVersion,
	CURRENT_SCHEMA_VERSION,
	expectedSchemaLayout,
	runSchemaTransaction,
	SUPPORTED_POSTGRES_BUILD,
	SUPPORTED_POSTGRES_VERSION,
	SUPPORTED_POSTGRES_VERSION_NUM,
	schemaInitializationAction,
	schemaLayoutDifferences,
	schemaLayoutsMatch,
	UNSUPPORTED_POSTGRES_VERSION_MESSAGE,
	UNSUPPORTED_SCHEMA_MESSAGE,
} from '../src/schema.ts'

test('accepts only the PostgreSQL release used to generate the schema fingerprint', () => {
	expect(SUPPORTED_POSTGRES_VERSION_NUM).toBe('170011')
	expect(UNSUPPORTED_POSTGRES_VERSION_MESSAGE).toContain(SUPPORTED_POSTGRES_BUILD)
	expect(() =>
		assertSupportedPostgresVersion(SUPPORTED_POSTGRES_VERSION_NUM, 'PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86_64-pc-linux-gnu'),
	).not.toThrow()
	expect(() => assertSupportedPostgresVersion(SUPPORTED_POSTGRES_VERSION_NUM, 'PostgreSQL 17.11 on x86_64-pc-linux-musl')).toThrow(
		UNSUPPORTED_POSTGRES_VERSION_MESSAGE,
	)
	expect(() => assertSupportedPostgresVersion('170006', `PostgreSQL 17.6 (${SUPPORTED_POSTGRES_BUILD})`)).toThrow(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
	expect(() => assertSupportedPostgresVersion('180006', `PostgreSQL 18.6 (${SUPPORTED_POSTGRES_BUILD})`)).toThrow(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
	expect(() => assertSupportedPostgresVersion('unknown', 'unknown')).toThrow(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
})

test('initializes an empty database, migrates the preceding schema, and accepts the current marker', () => {
	expect(schemaInitializationAction(undefined, [])).toBe('initialize')
	expect(schemaInitializationAction(CURRENT_SCHEMA_VERSION, ['augurscan_schema', 'networks'])).toBe('current')
	expect(schemaInitializationAction('1', ['augurscan_schema', 'networks'])).toBe('migrate')
})

test('rejects legacy, unknown, and incomplete database schemas', () => {
	expect(() => schemaInitializationAction(undefined, ['schema_migrations', 'networks'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['legacy_view'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['legacy_sequence'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['type:legacy_enum'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['routine:legacy_function'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['collation:legacy_collation'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['operator:legacy_operator'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction('0', ['augurscan_schema'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction('99', ['augurscan_schema'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
})

test('fingerprints every supported table, column, constraint, index, and sequence and rejects behavior-changing objects', async () => {
	const schema = await Bun.file(new URL('../schema.sql', import.meta.url)).text()
	expect(schema).toContain(`Dumped from database version ${SUPPORTED_POSTGRES_VERSION} (${SUPPORTED_POSTGRES_BUILD})`)
	const current = expectedSchemaLayout(schema, CURRENT_SCHEMA_VERSION)
	const previous = expectedSchemaLayout(schema, '1')
	expect(current.relations).toContain('table:chain_reorganizations')
	expect(current.relations).toContain('table:address_balance_observations')
	expect(current.relations).toContain('table:entity_state_observations')
	expect(current.relations).toContain('table:token_metadata_observations')
	expect(current.relations).toContain('table:history_invalidation_causes')
	expect(current.relations).toContain('sequence:chain_reorganizations_id_seq')
	expect(current.relations).toContain('sequence:address_balance_observations_id_seq')
	expect(current.relations).toContain('sequence:entity_state_observations_id_seq')
	expect(current.relations).toContain('sequence:token_metadata_observations_id_seq')
	expect(current.columns.some((signature) => signature.startsWith('chain_reorganizations.reason|'))).toBe(true)
	expect(current.columns.some((signature) => signature.startsWith('chain_reorganizations.indexer_run_id|'))).toBe(true)
	expect(current.columns.some((signature) => signature.startsWith('chain_reorganizations.projection_source_hash|'))).toBe(true)
	expect(current.constraints.some((signature) => signature.startsWith('chain_reorganizations.chain_reorganizations_reason_check|'))).toBe(true)
	expect(current.constraints.some((signature) => signature.startsWith('chain_reorganizations.chain_reorganizations_indexer_run_fkey|'))).toBe(true)
	expect(current.indexes.some((signature) => signature.startsWith('chain_reorganizations_history|'))).toBe(true)
	expect(current.columns.some((signature) => signature.startsWith('networks.applied_abi_source_hash|'))).toBe(true)
	expect(current.columns.some((signature) => signature.startsWith('networks.applied_application_source_hash|'))).toBe(true)
	expect(current.columns.some((signature) => signature.startsWith('networks.applied_projection_source_hash|'))).toBe(true)
	expect(current.columns.some((signature) => signature.startsWith('entity_state_snapshots.indexer_run_id|'))).toBe(true)
	expect(current.indexes.some((signature) => signature.startsWith('entity_state_observation_canonical_history|'))).toBe(true)
	expect(
		current.constraints.find((signature) => signature.startsWith('history_invalidation_occurrences.history_invalidation_occurrences_kind_check|')),
	).toContain("'address-balance'")
	expect(
		current.constraints.find((signature) => signature.startsWith('history_invalidation_occurrences.history_invalidation_occurrences_kind_check|')),
	).toContain("'token-metadata'")
	expect(previous.relations).not.toContain('table:chain_reorganizations')
	expect(previous.relations).not.toContain('table:address_balance_observations')
	expect(previous.relations).not.toContain('table:entity_state_observations')
	expect(previous.relations).not.toContain('table:token_metadata_observations')
	expect(previous.relations).not.toContain('table:history_invalidation_causes')
	expect(previous.relations).not.toContain('sequence:chain_reorganizations_id_seq')
	expect(previous.constraints.some((signature) => signature.startsWith('chain_reorganizations.'))).toBe(false)
	expect(previous.indexes.some((signature) => signature.startsWith('chain_reorganizations_history|'))).toBe(false)
	expect(previous.columns.some((signature) => signature.startsWith('networks.applied_abi_source_hash|'))).toBe(false)
	expect(previous.columns.some((signature) => signature.startsWith('networks.applied_application_source_hash|'))).toBe(false)
	expect(previous.columns.some((signature) => signature.startsWith('networks.applied_projection_source_hash|'))).toBe(false)
	expect(previous.columns.some((signature) => signature.startsWith('entity_state_snapshots.indexer_run_id|'))).toBe(false)
	expect(schemaLayoutsMatch(current, current)).toBe(true)
	expect(schemaLayoutsMatch(current, { ...current, columns: current.columns.slice(1) })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, constraints: [...current.constraints, 'unknown.constraint|CHECK (false)'].sort() })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, unsupportedObjects: ['operator:##'] })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, unsupportedObjects: ['trigger:actions.unexpected_trigger'] })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, unsupportedObjects: ['rule:actions.unexpected_rule'] })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, unsupportedObjects: ['policy:actions.unexpected_policy'] })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, unsupportedObjects: ['table-security:actions:row=true:force=false'] })).toBe(false)
})

test('fingerprints schema files checked out with Windows line endings', async () => {
	const schema = await Bun.file(new URL('../schema.sql', import.meta.url)).text()
	expect(expectedSchemaLayout(schema.replaceAll('\n', '\r\n'), CURRENT_SCHEMA_VERSION)).toEqual(expectedSchemaLayout(schema, CURRENT_SCHEMA_VERSION))
})

test('reports the exact schema fingerprint differences without database contents', () => {
	const expected = {
		relations: ['table:expected'],
		columns: ['expected.id|bigint|not-null||'],
		constraints: [],
		indexes: ['expected_id|CREATE INDEX expected_id ON expected USING btree (id)'],
		unsupportedObjects: [],
	}
	const actual = {
		relations: ['table:unexpected'],
		columns: ['expected.id|integer|not-null||'],
		constraints: [],
		indexes: ['expected_id|CREATE INDEX expected_id ON expected USING btree (id)'],
		unsupportedObjects: ['trigger:expected.unexpected_trigger'],
	}
	expect(schemaLayoutDifferences(expected, actual)).toEqual({
		relations: { missing: ['table:expected'], unexpected: ['table:unexpected'] },
		columns: { missing: ['expected.id|bigint|not-null||'], unexpected: ['expected.id|integer|not-null||'] },
		unsupportedObjects: { missing: [], unexpected: ['trigger:expected.unexpected_trigger'] },
	})
})

test('keeps the supported migration additive and backfills retained evidence', async () => {
	const migration = await Bun.file(new URL('../migrations/002-historical-integrity.sql', import.meta.url)).text()
	expect(migration).toContain('CREATE TABLE public.chain_reorganizations')
	expect(migration).toContain('ADD COLUMN applied_abi_source_hash')
	expect(migration).toContain('ADD COLUMN applied_application_source_hash')
	expect(migration).toContain('ADD COLUMN configured_deployment_block')
	expect(migration).toContain('CREATE TABLE public.indexer_runs')
	expect(migration).toContain('chain_reorganizations_indexer_run_fkey')
	expect(migration).toContain('CREATE TABLE public.entity_state_observations')
	expect(migration).toContain('CREATE TABLE public.address_balance_observations')
	expect(migration).toContain('CREATE TABLE public.token_metadata_observations')
	expect(migration).toContain('CREATE TABLE public.history_invalidation_causes')
	expect(migration).toContain("'address-balance'::text")
	expect(migration).toContain("'token-metadata'::text")
	expect(migration).toContain('FROM public.entity_state_snapshots')
	expect(migration).toContain('FROM public.address_balance_snapshots')
	expect(migration).toContain('FROM public.token_metadata')
	expect(migration).toContain('INSERT INTO public.protocol_timeline_entries')
	expect(migration).toContain('INSERT INTO public.amm_trade_events')
	expect(migration).toContain('log.emitter_address, log.event_name, log.canonical')
	expect(migration).toContain("WHERE entity_type = 'fork' AND source_event <> 'Migrate'")
	expect(migration).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)/i)
	expect(migration).not.toMatch(/TRUNCATE/i)
})

test('uses one explicit transaction boundary for successful schema initialization', async () => {
	const calls: string[] = []
	const result = await runSchemaTransaction(
		async () => calls.push('BEGIN'),
		async () => calls.push('COMMIT'),
		async () => calls.push('ROLLBACK'),
		async () => {
			calls.push('schema')
			return 'initialized'
		},
	)
	expect(result).toBe('initialized')
	expect(calls).toEqual(['BEGIN', 'schema', 'COMMIT'])
})

test('rolls back once and preserves the schema failure', async () => {
	const calls: string[] = []
	const failure = new Error('schema failed')
	await expect(
		runSchemaTransaction(
			async () => calls.push('BEGIN'),
			async () => calls.push('COMMIT'),
			async () => calls.push('ROLLBACK'),
			async () => {
				calls.push('schema')
				throw failure
			},
		),
	).rejects.toBe(failure)
	expect(calls).toEqual(['BEGIN', 'schema', 'ROLLBACK'])
})

test('reports both failures when PostgreSQL also rejects the rollback', async () => {
	const schemaFailure = new Error('schema failed')
	const rollbackFailure = new Error('rollback failed')
	try {
		await runSchemaTransaction(
			async () => undefined,
			async () => undefined,
			async () => {
				throw rollbackFailure
			},
			async () => {
				throw schemaFailure
			},
		)
		throw new Error('Expected schema initialization to fail')
	} catch (error) {
		expect(error).toBeInstanceOf(AggregateError)
		if (!(error instanceof AggregateError)) throw error
		expect(error.errors).toEqual([schemaFailure, rollbackFailure])
	}
})
