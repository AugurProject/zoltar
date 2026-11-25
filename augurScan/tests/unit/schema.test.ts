import { expect, test } from 'bun:test'
import { expectedSchemaLayout, schemaLayoutDifferences } from '../../src/schema-layout.ts'
import { assertSupportedPostgresVersion, CURRENT_SCHEMA_VERSION, runSchemaTransaction, schemaInitializationAction, UNSUPPORTED_SCHEMA_MESSAGE } from '../../src/schema-policy.ts'

// The PostgreSQL release that produced schema.sql; the policy module pins it as the only supported server.
const SUPPORTED_POSTGRES_VERSION = '17.11'
const UNSUPPORTED_POSTGRES_VERSION_MESSAGE = 'Unsupported PostgreSQL server version'

test('accepts the PostgreSQL release used to generate the schema fingerprint across official image distributions', () => {
	expect(() => assertSupportedPostgresVersion('170011')).not.toThrow()
	expect(() => assertSupportedPostgresVersion('170006')).toThrow(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
	expect(() => assertSupportedPostgresVersion('170006')).toThrow(SUPPORTED_POSTGRES_VERSION)
	expect(() => assertSupportedPostgresVersion('180006')).toThrow(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
	expect(() => assertSupportedPostgresVersion('unknown')).toThrow(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
})

test('initializes only an empty database and accepts the current marker', () => {
	expect(schemaInitializationAction(undefined, [])).toBe('initialize')
	expect(schemaInitializationAction(CURRENT_SCHEMA_VERSION, ['augurscan_schema', 'networks'])).toBe('current')
	for (let version = 1; version < Number(CURRENT_SCHEMA_VERSION); version++) expect(() => schemaInitializationAction(version.toString(), ['augurscan_schema', 'networks'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
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
	const schema = await Bun.file(new URL('../../schema.sql', import.meta.url)).text()
	expect(schema).toContain(`Dumped from database version ${SUPPORTED_POSTGRES_VERSION}`)
	const current = expectedSchemaLayout(schema)
	expect(current.relations).toContain('table:indexer_ownership')
	expect(current.indexes.some(signature => signature.startsWith('indexer_ownership_heartbeat|'))).toBe(true)
	expect(current.relations).toContain('table:chain_reorganizations')
	expect(current.relations).toContain('table:address_balance_observations')
	expect(current.relations).toContain('table:entity_state_observations')
	expect(current.relations).toContain('table:token_metadata_observations')
	expect(current.relations).toContain('table:history_invalidation_causes')
	expect(current.relations).toContain('sequence:chain_reorganizations_id_seq')
	expect(current.relations).toContain('sequence:address_balance_observations_id_seq')
	expect(current.relations).toContain('sequence:entity_state_observations_id_seq')
	expect(current.relations).toContain('sequence:token_metadata_observations_id_seq')
	expect(current.columns.some(signature => signature.startsWith('chain_reorganizations.reason|'))).toBe(true)
	expect(current.columns.some(signature => signature.startsWith('chain_reorganizations.indexer_run_id|'))).toBe(true)
	expect(current.columns.some(signature => signature.startsWith('chain_reorganizations.projection_source_hash|'))).toBe(true)
	expect(current.constraints.some(signature => signature.startsWith('chain_reorganizations.chain_reorganizations_reason_check|'))).toBe(true)
	expect(current.constraints.some(signature => signature.startsWith('chain_reorganizations.chain_reorganizations_indexer_run_fkey|'))).toBe(true)
	expect(current.indexes.some(signature => signature.startsWith('chain_reorganizations_history|'))).toBe(true)
	expect(current.columns.some(signature => signature.startsWith('networks.applied_abi_source_hash|'))).toBe(true)
	expect(current.columns.some(signature => signature.startsWith('networks.applied_application_source_hash|'))).toBe(true)
	expect(current.columns.some(signature => signature.startsWith('networks.applied_projection_source_hash|'))).toBe(true)
	expect(current.columns.some(signature => signature.startsWith('entity_state_snapshots.indexer_run_id|'))).toBe(true)
	expect(current.indexes.some(signature => signature.startsWith('entity_state_observation_canonical_history|'))).toBe(true)
	expect(current.constraints.find(signature => signature.startsWith('history_invalidation_occurrences.history_invalidation_occurrences_kind_check|'))).toContain("'address-balance'")
	expect(current.constraints.find(signature => signature.startsWith('history_invalidation_occurrences.history_invalidation_occurrences_kind_check|'))).toContain("'token-metadata'")
	const schemaLayoutsMatch = (expected: typeof current, actual: typeof current) => Object.keys(schemaLayoutDifferences(expected, actual)).length === 0
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
	const schema = await Bun.file(new URL('../../schema.sql', import.meta.url)).text()
	expect(expectedSchemaLayout(schema.replaceAll('\n', '\r\n'))).toEqual(expectedSchemaLayout(schema))
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
