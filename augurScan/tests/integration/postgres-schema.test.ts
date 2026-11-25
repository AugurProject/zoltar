import { expect } from 'bun:test'
import { canonicalTablePolicies, ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import { CURRENT_SCHEMA_VERSION, UNSUPPORTED_SCHEMA_MESSAGE } from '../../src/schema-policy.ts'
import { expectBehaviorChangingSchemaObjectsRejected, postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

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

postgresTest('rejects historical schema versions without modifying stored evidence', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	try {
		await initializeSchema(database.sql)
		for (let version = 1; version < Number(CURRENT_SCHEMA_VERSION); version++) {
			await database.sql`UPDATE augurscan_schema SET schema_version = ${version.toString()} WHERE singleton`
			await expect(initializeSchema(database.sql)).rejects.toThrow(UNSUPPORTED_SCHEMA_MESSAGE)
			expect((await database.sql`SELECT schema_version FROM augurscan_schema WHERE singleton`)[0]?.schema_version).toBe(version.toString())
		}
	} finally {
		await database.sql`UPDATE augurscan_schema SET schema_version = ${CURRENT_SCHEMA_VERSION} WHERE singleton`
		await database.close()
	}
})
