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

export const schemaInitializationAction = (markerVersion: string | undefined, publicObjects: readonly string[]): 'initialize' | 'current' => {
	if (markerVersion === CURRENT_SCHEMA_VERSION) return 'current'
	if (markerVersion !== undefined || publicObjects.length > 0) throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
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
			const markerShape = await connection`
				SELECT
					class.relkind,
					EXISTS (
						SELECT FROM pg_catalog.pg_attribute attribute
						WHERE attribute.attrelid = class.oid AND attribute.attname = 'singleton'
							AND attribute.atttypid = 'boolean'::regtype AND attribute.attnum > 0 AND NOT attribute.attisdropped
					) AS has_singleton,
					EXISTS (
						SELECT FROM pg_catalog.pg_attribute attribute
						WHERE attribute.attrelid = class.oid AND attribute.attname = 'schema_version'
							AND attribute.atttypid = 'text'::regtype AND attribute.attnum > 0 AND NOT attribute.attisdropped
					) AS has_schema_version
				FROM pg_catalog.pg_class class
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public' AND class.relname = 'augurscan_schema'
			`
			if (markerShape.length !== 1 || markerShape[0]?.relkind !== 'r' || markerShape[0]?.has_singleton !== true || markerShape[0]?.has_schema_version !== true)
				throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
			const markers = await connection`SELECT schema_version FROM public.augurscan_schema WHERE singleton`
			if (markers.length !== 1 || typeof markers[0]?.schema_version !== 'string') throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
			markerVersion = markers[0].schema_version
		}
		const objects = await connection`
			SELECT object_name FROM (
				SELECT 'relation:' || class.relname AS object_name
				FROM pg_catalog.pg_class class
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public' AND class.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
				UNION ALL
				SELECT 'type:' || type_entry.typname AS object_name
				FROM pg_catalog.pg_type type_entry
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type_entry.typnamespace
				WHERE namespace.nspname = 'public'
				UNION ALL
				SELECT 'routine:' || procedure_entry.proname AS object_name
				FROM pg_catalog.pg_proc procedure_entry
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure_entry.pronamespace
				WHERE namespace.nspname = 'public'
			) public_objects
			ORDER BY object_name
		`
		const publicObjects = objects.flatMap((row: { object_name?: unknown }) => (typeof row.object_name === 'string' ? [row.object_name] : []))
		if (schemaInitializationAction(markerVersion, publicObjects) === 'current') return

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
