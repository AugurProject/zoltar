import { expect, test } from 'bun:test'
import { runMigrationTransaction } from '../src/migrate.ts'

test('uses one explicit transaction boundary for a successful migration', async () => {
	const calls: string[] = []
	const result = await runMigrationTransaction(
		async () => calls.push('BEGIN'),
		async () => calls.push('COMMIT'),
		async () => calls.push('ROLLBACK'),
		async () => {
			calls.push('migration')
			return 'applied'
		},
	)
	expect(result).toBe('applied')
	expect(calls).toEqual(['BEGIN', 'migration', 'COMMIT'])
})

test('rolls back once and preserves the migration failure', async () => {
	const calls: string[] = []
	const failure = new Error('migration failed')
	await expect(
		runMigrationTransaction(
			async () => calls.push('BEGIN'),
			async () => calls.push('COMMIT'),
			async () => calls.push('ROLLBACK'),
			async () => {
				calls.push('migration')
				throw failure
			},
		),
	).rejects.toBe(failure)
	expect(calls).toEqual(['BEGIN', 'migration', 'ROLLBACK'])
})

test('reports both failures when PostgreSQL also rejects the rollback', async () => {
	const migrationFailure = new Error('migration failed')
	const rollbackFailure = new Error('rollback failed')
	try {
		await runMigrationTransaction(
			async () => undefined,
			async () => undefined,
			async () => {
				throw rollbackFailure
			},
			async () => {
				throw migrationFailure
			},
		)
		throw new Error('Expected the migration transaction to fail')
	} catch (error) {
		expect(error).toBeInstanceOf(AggregateError)
		if (!(error instanceof AggregateError)) throw error
		expect(error.errors).toEqual([migrationFailure, rollbackFailure])
	}
})
