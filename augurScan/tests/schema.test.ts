import { expect, test } from 'bun:test'
import { CURRENT_SCHEMA_VERSION, runSchemaTransaction, schemaInitializationAction, UNSUPPORTED_SCHEMA_MESSAGE } from '../src/schema.ts'

test('initializes only an empty database and accepts the current schema marker', () => {
	expect(schemaInitializationAction(undefined, [])).toBe('initialize')
	expect(schemaInitializationAction(CURRENT_SCHEMA_VERSION, ['augurscan_schema', 'networks'])).toBe('current')
})

test('rejects legacy, unknown, and incomplete database schemas', () => {
	expect(() => schemaInitializationAction(undefined, ['schema_migrations', 'networks'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['legacy_view'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction(undefined, ['legacy_sequence'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
	expect(() => schemaInitializationAction('0', ['augurscan_schema'])).toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
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
