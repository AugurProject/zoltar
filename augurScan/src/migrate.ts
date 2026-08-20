import path from 'node:path'
import { SQL } from 'bun'
import { runtimeConfig } from './config.ts'

export const runMigrationTransaction = async <T>(
	begin: () => Promise<unknown>,
	commit: () => Promise<unknown>,
	rollback: () => Promise<unknown>,
	operation: () => Promise<T>,
): Promise<T> => {
	await begin()
	try {
		const result = await operation()
		await commit()
		return result
	} catch (error) {
		try {
			await rollback()
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError], 'Migration failed and its transaction could not be rolled back')
		}
		throw error
	}
}

export const migrate = async (sql: SQL): Promise<void> => {
	const connection = await sql.reserve()
	try {
		await connection`SELECT pg_advisory_lock(92138471)`
		await connection`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
		const directory = path.resolve(import.meta.dir, '../migrations')
		for (const filename of (await Array.fromAsync(new Bun.Glob('*.sql').scan({ cwd: directory }))).sort()) {
			const existing = await connection`SELECT name FROM schema_migrations WHERE name = ${filename}`
			if (existing.length > 0) continue
			const migration = await Bun.file(path.join(directory, filename)).text()
			// Keep the reserved advisory-lock connection on one explicit transaction
			// boundary. Nesting the transaction helper around a multi-statement unsafe
			// query made PostgreSQL receive duplicate BEGIN/COMMIT commands on startup.
			await runMigrationTransaction(
				async () => await connection.unsafe('BEGIN'),
				async () => await connection.unsafe('COMMIT'),
				async () => await connection.unsafe('ROLLBACK'),
				async () => {
					await connection.unsafe(migration)
					await connection`INSERT INTO schema_migrations (name) VALUES (${filename})`
				},
			)
		}
	} finally {
		try {
			await connection`SELECT pg_advisory_unlock(92138471)`
		} finally {
			await connection.release()
		}
	}
}

if (import.meta.main) {
	const sql = new SQL(runtimeConfig.postgresUrl)
	await migrate(sql)
	await sql.close()
}
