import path from 'node:path'
import { SQL } from 'bun'
import { runtimeConfig } from './config.ts'

export const CURRENT_SCHEMA_VERSION = '1'
export const UNSUPPORTED_SCHEMA_MESSAGE =
	'Unsupported augurScan database schema. Delete the PostgreSQL database or volume, recreate it empty, and restart augurScan.'

export const runSchemaTransaction = async <T>(
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
			throw new AggregateError([error, rollbackError], 'Schema initialization failed and its transaction could not be rolled back')
		}
		throw error
	}
}

export const schemaInitializationAction = (markerVersion: string | undefined, publicTables: readonly string[]): 'initialize' | 'current' => {
	if (markerVersion === CURRENT_SCHEMA_VERSION) return 'current'
	if (markerVersion !== undefined || publicTables.length > 0) throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
	return 'initialize'
}

export const initializeSchema = async (sql: SQL): Promise<void> => {
	const connection = await sql.reserve()
	try {
		await connection`SELECT pg_advisory_lock(92138471)`
		const markerExists = await connection`
			SELECT to_regclass('public.augurscan_schema') IS NOT NULL AS exists
		`
		let markerVersion: string | undefined
		if (markerExists[0]?.exists === true) {
			const markers = await connection`SELECT schema_version FROM public.augurscan_schema WHERE singleton`
			if (markers.length !== 1 || typeof markers[0]?.schema_version !== 'string') throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
			markerVersion = markers[0].schema_version
		}
		const tables = await connection`
			SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename
		`
		const publicTables = tables.flatMap((row: { tablename?: unknown }) => (typeof row.tablename === 'string' ? [row.tablename] : []))
		if (schemaInitializationAction(markerVersion, publicTables) === 'current') return

		const schema = await Bun.file(path.resolve(import.meta.dir, '../schema.sql')).text()
		await runSchemaTransaction(
			async () => await connection.unsafe('BEGIN'),
			async () => await connection.unsafe('COMMIT'),
			async () => await connection.unsafe('ROLLBACK'),
			async () => {
				await connection.unsafe(schema)
				await connection.unsafe(`
					CREATE TABLE public.augurscan_schema (
						singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
						schema_version text NOT NULL,
						initialized_at timestamptz NOT NULL DEFAULT now()
					)
				`)
				await connection`
					INSERT INTO public.augurscan_schema (singleton, schema_version)
					VALUES (true, ${CURRENT_SCHEMA_VERSION})
				`
			},
		)
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
	await initializeSchema(sql)
	await sql.close()
}
