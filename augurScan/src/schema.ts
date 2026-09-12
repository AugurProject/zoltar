import path from 'node:path'
import { SQL } from 'bun'
import { runtimeConfig } from './config.ts'
import { actualSchemaLayout, expectedSchemaLayout, schemaLayoutDifferences } from './schema-layout.ts'
import { assertSupportedPostgresVersion, CURRENT_SCHEMA_VERSION, INITIAL_MIGRATABLE_SCHEMA_VERSION, PREVIOUS_SCHEMA_VERSION, runSchemaTransaction, type SupportedSchemaVersion, schemaInitializationAction, UNSUPPORTED_SCHEMA_MESSAGE } from './schema-policy.ts'

const assertSchemaLayout = async (connection: Awaited<ReturnType<SQL['reserve']>>, schema: string, version: SupportedSchemaVersion): Promise<void> => {
	const differences = schemaLayoutDifferences(expectedSchemaLayout(schema, version), await actualSchemaLayout(connection))
	if (Object.keys(differences).length > 0) throw new Error(`${UNSUPPORTED_SCHEMA_MESSAGE} Differences: ${JSON.stringify(differences)}`)
}

export const initializeSchema = async (sql: SQL): Promise<void> => {
	const connection = await sql.reserve()
	let advisoryLockAcquired = false
	try {
		const serverVersions = await connection`SELECT current_setting('server_version_num') AS version_number`
		assertSupportedPostgresVersion(serverVersions[0]?.version_number)
		await connection`SELECT pg_advisory_lock(92138471)`
		advisoryLockAcquired = true
		const schema = await Bun.file(path.resolve(import.meta.dir, '../schema.sql')).text()
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
			if (markerShape.length !== 1 || markerShape[0]?.relkind !== 'r' || markerShape[0]?.has_singleton !== true || markerShape[0]?.has_schema_version !== true) throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
			const markers = await connection`SELECT schema_version FROM public.augurscan_schema WHERE singleton`
			if (markers.length !== 1 || typeof markers[0]?.schema_version !== 'string') throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
			markerVersion = markers[0].schema_version
		}
		const objects = await connection`
			SELECT dependency.classid::regclass::text || ':' || dependency.objid::text AS object_name
			FROM pg_catalog.pg_depend dependency
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = dependency.refobjid
			WHERE dependency.refclassid = 'pg_catalog.pg_namespace'::regclass
				AND dependency.deptype = 'n'
				AND namespace.nspname = 'public'
			ORDER BY dependency.classid, dependency.objid
		`
		const publicObjects = objects.flatMap((row: { object_name?: unknown }) => (typeof row.object_name === 'string' ? [row.object_name] : []))
		const action = schemaInitializationAction(markerVersion, publicObjects)
		if (action === 'current') {
			await assertSchemaLayout(connection, schema, CURRENT_SCHEMA_VERSION)
			return
		}
		if (action === 'migrate-from-1' || action === 'migrate-from-2') {
			const startingVersion = action === 'migrate-from-1' ? INITIAL_MIGRATABLE_SCHEMA_VERSION : PREVIOUS_SCHEMA_VERSION
			await assertSchemaLayout(connection, schema, startingVersion)
			const migrations = [...(action === 'migrate-from-1' ? [await Bun.file(path.resolve(import.meta.dir, '../migrations/002-historical-integrity.sql')).text()] : []), await Bun.file(path.resolve(import.meta.dir, '../migrations/003-indexer-ownership.sql')).text()]
			await runSchemaTransaction(
				async () => await connection.unsafe('BEGIN'),
				async () => await connection.unsafe('COMMIT'),
				async () => await connection.unsafe('ROLLBACK'),
				async () => {
					for (const migration of migrations) await connection.unsafe(migration)
					await assertSchemaLayout(connection, schema, CURRENT_SCHEMA_VERSION)
					await connection`
						INSERT INTO public.augurscan_schema_migrations (schema_version, description)
						VALUES (${CURRENT_SCHEMA_VERSION}, ${'Durable, reconciled indexer ownership diagnostics'})
					`
					await connection`UPDATE public.augurscan_schema SET schema_version = ${CURRENT_SCHEMA_VERSION} WHERE singleton`
				},
			)
			return
		}

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
				await connection`
					INSERT INTO public.augurscan_schema_migrations (schema_version, description)
					VALUES (${CURRENT_SCHEMA_VERSION}, ${'Current schema initialization'})
				`
				await assertSchemaLayout(connection, schema, CURRENT_SCHEMA_VERSION)
			},
		)
	} finally {
		try {
			if (advisoryLockAcquired) await connection`SELECT pg_advisory_unlock(92138471)`
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
