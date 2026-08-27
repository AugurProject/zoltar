import { expect, test } from 'bun:test'
import {
	CURRENT_SCHEMA_VERSION,
	expectedSchemaLayout,
	runSchemaTransaction,
	schemaInitializationAction,
	schemaLayoutsMatch,
	UNSUPPORTED_SCHEMA_MESSAGE,
} from '../src/schema.ts'

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

test('fingerprints every supported table, column, constraint, index, and sequence', async () => {
	const schema = await Bun.file(new URL('../schema.sql', import.meta.url)).text()
	const current = expectedSchemaLayout(schema, CURRENT_SCHEMA_VERSION)
	const previous = expectedSchemaLayout(schema, '1')
	expect(current.relations).toContain('table:chain_reorganizations')
	expect(current.relations).toContain('sequence:chain_reorganizations_id_seq')
	expect(current.columns.some((signature) => signature.startsWith('chain_reorganizations.reason|'))).toBe(true)
	expect(current.constraints.some((signature) => signature.startsWith('chain_reorganizations.chain_reorganizations_reason_check|'))).toBe(true)
	expect(current.indexes.some((signature) => signature.startsWith('chain_reorganizations_history|'))).toBe(true)
	expect(previous.relations).not.toContain('table:chain_reorganizations')
	expect(previous.relations).not.toContain('sequence:chain_reorganizations_id_seq')
	expect(previous.constraints.some((signature) => signature.startsWith('chain_reorganizations.'))).toBe(false)
	expect(previous.indexes.some((signature) => signature.startsWith('chain_reorganizations_history|'))).toBe(false)
	expect(schemaLayoutsMatch(current, current)).toBe(true)
	expect(schemaLayoutsMatch(current, { ...current, columns: current.columns.slice(1) })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, constraints: [...current.constraints, 'unknown.constraint|CHECK (false)'].sort() })).toBe(false)
	expect(schemaLayoutsMatch(current, { ...current, unsupportedObjects: ['operator:##'] })).toBe(false)
})

test('keeps the supported migration additive and backfills retained evidence', async () => {
	const migration = await Bun.file(new URL('../migrations/002-historical-integrity.sql', import.meta.url)).text()
	expect(migration).toContain('CREATE TABLE public.chain_reorganizations')
	expect(migration).toContain('CREATE TABLE public.indexer_runs')
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
