import path from 'node:path'
import { SQL } from 'bun'
import { runtimeConfig } from './config.ts'

export const CURRENT_SCHEMA_VERSION = '2'
export const SUPPORTED_POSTGRES_VERSION = '17.11'
export const UNSUPPORTED_POSTGRES_VERSION_MESSAGE = `Unsupported PostgreSQL server version. augurScan requires PostgreSQL ${SUPPORTED_POSTGRES_VERSION} because schema fingerprints are version-specific; the database was not modified.`
export const UNSUPPORTED_SCHEMA_MESSAGE =
	'Unsupported augurScan database schema. Restore a compatible backup or upgrade through a supported augurScan release; the database was not modified.'

const PREVIOUS_SCHEMA_VERSION = '1'
const postgresVersionNumber = (release: string): string => {
	const match = /^(\d+)\.(\d+)$/u.exec(release)
	if (match?.[1] === undefined || match[2] === undefined) throw new Error(`Invalid supported PostgreSQL release: ${release}`)
	return `${match[1]}${match[2].padStart(4, '0')}`
}
export const SUPPORTED_POSTGRES_VERSION_NUM = postgresVersionNumber(SUPPORTED_POSTGRES_VERSION)

type SupportedSchemaVersion = typeof PREVIOUS_SCHEMA_VERSION | typeof CURRENT_SCHEMA_VERSION

export interface SchemaLayout {
	readonly relations: readonly string[]
	readonly columns: readonly string[]
	readonly constraints: readonly string[]
	readonly indexes: readonly string[]
	readonly unsupportedObjects: readonly string[]
}

export type SchemaLayoutDifferences = Partial<Record<keyof SchemaLayout, { readonly missing: readonly string[]; readonly unexpected: readonly string[] }>>

const schemaLayoutKeys = ['relations', 'columns', 'constraints', 'indexes', 'unsupportedObjects'] as const

export const schemaLayoutDifferences = (expected: SchemaLayout, actual: SchemaLayout): SchemaLayoutDifferences => {
	const differences: SchemaLayoutDifferences = {}
	for (const key of schemaLayoutKeys) {
		const expectedValues = new Set(expected[key])
		const actualValues = new Set(actual[key])
		const missing = expected[key].filter((value) => !actualValues.has(value))
		const unexpected = actual[key].filter((value) => !expectedValues.has(value))
		if (missing.length > 0 || unexpected.length > 0) differences[key] = { missing, unexpected }
	}
	return differences
}

const historicalIntegrityTables = new Set([
	'action_interpretations',
	'address_balance_observations',
	'augurscan_schema_migrations',
	'chain_reorganizations',
	'entity_state_observations',
	'history_invalidation_causes',
	'history_invalidation_occurrences',
	'indexer_runs',
	'log_interpretations',
	'token_metadata_observations',
])
const historicalIntegrityColumns = new Set([
	'contracts.configured_deployment_block',
	'networks.applied_abi_source_hash',
	'networks.applied_application_source_hash',
	'networks.applied_projection_source_hash',
	'entity_state_snapshots.indexer_run_id',
	'entity_state_snapshots.abi_source_hash',
	'entity_state_snapshots.application_source_hash',
	'entity_state_snapshots.projection_source_hash',
])
const historicalIntegrityIndexes = new Set([
	'pool_snapshots_detail_page',
	'protocol_timeline_entity_history_page',
	'protocol_timeline_history_page',
	'vault_snapshots_detail_page',
])
const normalizeDefinition = (value: string): string => value.replaceAll('public.', '').replace(/\s+/g, ' ').trim().replace(/;$/, '')
const sorted = (values: Iterable<string>): string[] => [...values].sort()

const columnSignature = (table: string, column: string, type: string, notNull: boolean, identity: string, defaultExpression: string | undefined): string =>
	`${table}.${column}|${normalizeDefinition(type)}|${notNull ? 'not-null' : 'nullable'}|${identity}|${normalizeDefinition(defaultExpression ?? '')}`

export const expectedSchemaLayout = (schema: string, version: SupportedSchemaVersion): SchemaLayout => {
	const normalizedSchema = schema.replaceAll('\r\n', '\n')
	const relations = new Set<string>(['table:augurscan_schema'])
	const columns = new Set<string>([
		columnSignature('augurscan_schema', 'singleton', 'boolean', true, '', 'true'),
		columnSignature('augurscan_schema', 'schema_version', 'text', true, '', undefined),
		columnSignature('augurscan_schema', 'initialized_at', 'timestamp with time zone', true, '', 'now()'),
	])
	const constraints = new Set<string>([
		'augurscan_schema.augurscan_schema_pkey|PRIMARY KEY (singleton)',
		'augurscan_schema.augurscan_schema_singleton_check|CHECK (singleton)',
	])
	const indexes = new Set<string>()
	const defaultOverrides = new Map<string, string>()
	for (const match of normalizedSchema.matchAll(/ALTER TABLE ONLY public\.([a-z_][a-z0-9_]*) ALTER COLUMN ([a-z_][a-z0-9_]*) SET DEFAULT ([\s\S]*?);/g)) {
		const [, table, column, expression] = match
		if (table !== undefined && column !== undefined && expression !== undefined) defaultOverrides.set(`${table}.${column}`, expression)
	}
	for (const match of normalizedSchema.matchAll(/CREATE TABLE public\.([a-z_][a-z0-9_]*) \(\n([\s\S]*?)\n\);/g)) {
		const [, table, body] = match
		if (table === undefined || body === undefined || (version === PREVIOUS_SCHEMA_VERSION && historicalIntegrityTables.has(table))) continue
		relations.add(`table:${table}`)
		for (const sourceLine of body.split('\n')) {
			const line = sourceLine.trim().replace(/,$/, '')
			const constraintMatch = /^CONSTRAINT ([a-z_][a-z0-9_]*) (.+)$/.exec(line)
			if (constraintMatch !== null) {
				const [, name, definition] = constraintMatch
				if (name !== undefined && definition !== undefined) constraints.add(`${table}.${name}|${normalizeDefinition(definition)}`)
				continue
			}
			const columnMatch = /^(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+(timestamp with time zone|numeric\(\d+,\d+\)|bigint|integer|text|boolean|jsonb)([\s\S]*)$/.exec(
				line,
			)
			if (columnMatch === null) continue
			const [, quotedColumn, plainColumn, type, remainderValue] = columnMatch
			const column = quotedColumn ?? plainColumn
			if (column === undefined || type === undefined) continue
			if (version === PREVIOUS_SCHEMA_VERSION && historicalIntegrityColumns.has(`${table}.${column}`)) continue
			const remainder = remainderValue ?? ''
			const defaultMatch = /\bDEFAULT ([\s\S]*?)(?=\s+NOT NULL|\s+GENERATED (?:ALWAYS|BY DEFAULT) AS IDENTITY|$)/.exec(remainder)
			const identity = /\bGENERATED ALWAYS AS IDENTITY\b/.test(remainder) ? 'a' : /\bGENERATED BY DEFAULT AS IDENTITY\b/.test(remainder) ? 'd' : ''
			const defaultExpression = defaultOverrides.get(`${table}.${column}`) ?? defaultMatch?.[1]
			columns.add(columnSignature(table, column, type, /\bNOT NULL\b/.test(remainder), identity, defaultExpression))
			if (identity !== '') relations.add(`sequence:${table}_${column}_seq`)
		}
	}
	for (const match of normalizedSchema.matchAll(/ALTER TABLE ONLY public\.([a-z_][a-z0-9_]*)\s+ADD CONSTRAINT ([a-z_][a-z0-9_]*) ([\s\S]*?);/g)) {
		const [, table, name, definition] = match
		if (table === undefined || name === undefined || definition === undefined) continue
		if (version === PREVIOUS_SCHEMA_VERSION && historicalIntegrityTables.has(table)) continue
		constraints.add(`${table}.${name}|${normalizeDefinition(definition)}`)
	}
	for (const match of normalizedSchema.matchAll(/CREATE (UNIQUE )?INDEX ([a-z_][a-z0-9_]*)\s+ON public\.([a-z_][a-z0-9_]*)\s+([\s\S]*?);/g)) {
		const [, unique, name, table, definition] = match
		if (name === undefined || table === undefined || definition === undefined) continue
		if (version === PREVIOUS_SCHEMA_VERSION && (historicalIntegrityTables.has(table) || historicalIntegrityIndexes.has(name))) continue
		indexes.add(`${name}|${normalizeDefinition(`CREATE ${unique ?? ''}INDEX ${name} ON public.${table} ${definition}`)}`)
	}
	for (const match of normalizedSchema.matchAll(/CREATE SEQUENCE public\.([a-z_][a-z0-9_]*)/g)) {
		const sequence = match[1]
		if (sequence !== undefined) relations.add(`sequence:${sequence}`)
	}
	return {
		relations: sorted(relations),
		columns: sorted(columns),
		constraints: sorted(constraints),
		indexes: sorted(indexes),
		unsupportedObjects: [],
	}
}

export const schemaLayoutsMatch = (expected: SchemaLayout, actual: SchemaLayout): boolean =>
	schemaLayoutKeys.every((key) => JSON.stringify(expected[key]) === JSON.stringify(actual[key]))

const actualSchemaLayout = async (connection: Awaited<ReturnType<SQL['reserve']>>): Promise<SchemaLayout> => {
	const [relations, columns, constraints, indexes, unsupportedObjects] = await Promise.all([
		connection`
			SELECT CASE class.relkind WHEN 'r' THEN 'table:' ELSE 'sequence:' END || class.relname AS signature
			FROM pg_catalog.pg_class class
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
			WHERE namespace.nspname = 'public' AND class.relkind IN ('r', 'S')
			ORDER BY signature
		`,
		connection`
			SELECT class.relname AS table_name, attribute.attname AS column_name,
				pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type,
				attribute.attnotnull AS not_null, attribute.attidentity AS identity,
				pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid) AS default_expression
			FROM pg_catalog.pg_attribute attribute
			JOIN pg_catalog.pg_class class ON class.oid = attribute.attrelid AND class.relkind = 'r'
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
			LEFT JOIN pg_catalog.pg_attrdef defaults ON defaults.adrelid = attribute.attrelid AND defaults.adnum = attribute.attnum
			WHERE namespace.nspname = 'public' AND attribute.attnum > 0 AND NOT attribute.attisdropped
			ORDER BY class.relname, attribute.attnum
		`,
		connection`
			SELECT class.relname AS table_name, constraint_record.conname AS constraint_name,
				pg_catalog.pg_get_constraintdef(constraint_record.oid, false) AS definition
			FROM pg_catalog.pg_constraint constraint_record
			JOIN pg_catalog.pg_class class ON class.oid = constraint_record.conrelid
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
			WHERE namespace.nspname = 'public'
			ORDER BY class.relname, constraint_record.conname
		`,
		connection`
			SELECT index_class.relname AS index_name, pg_catalog.pg_get_indexdef(index_class.oid, 0, false) AS definition
			FROM pg_catalog.pg_index index_record
			JOIN pg_catalog.pg_class index_class ON index_class.oid = index_record.indexrelid
			JOIN pg_catalog.pg_namespace namespace ON namespace.oid = index_class.relnamespace
			WHERE namespace.nspname = 'public' AND NOT EXISTS (
				SELECT FROM pg_catalog.pg_constraint constraint_record
				WHERE constraint_record.conindid = index_record.indexrelid AND constraint_record.contype IN ('p', 'u', 'x')
			)
			ORDER BY index_class.relname
		`,
		connection`
			SELECT kind || ':' || object_name AS signature FROM (
				SELECT 'function' AS kind, procedure_record.proname AS object_name
				FROM pg_catalog.pg_proc procedure_record JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure_record.pronamespace
				WHERE namespace.nspname = 'public'
				UNION ALL
				SELECT 'operator', operator_record.oprname
				FROM pg_catalog.pg_operator operator_record JOIN pg_catalog.pg_namespace namespace ON namespace.oid = operator_record.oprnamespace
				WHERE namespace.nspname = 'public'
				UNION ALL
				SELECT 'collation', collation_record.collname
				FROM pg_catalog.pg_collation collation_record JOIN pg_catalog.pg_namespace namespace ON namespace.oid = collation_record.collnamespace
				WHERE namespace.nspname = 'public'
				UNION ALL
				SELECT 'type', type_record.typname
				FROM pg_catalog.pg_type type_record JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type_record.typnamespace
				WHERE namespace.nspname = 'public' AND type_record.typrelid = 0 AND type_record.typtype IN ('d', 'e', 'm', 'r')
				UNION ALL
				SELECT 'relation', class.relname
				FROM pg_catalog.pg_class class JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public' AND class.relkind NOT IN ('r', 'i', 'S')
				UNION ALL
				SELECT 'trigger', class.relname || '.' || trigger_record.tgname
				FROM pg_catalog.pg_trigger trigger_record
				JOIN pg_catalog.pg_class class ON class.oid = trigger_record.tgrelid
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public' AND NOT trigger_record.tgisinternal
				UNION ALL
				SELECT 'rule', class.relname || '.' || rewrite.rulename
				FROM pg_catalog.pg_rewrite rewrite
				JOIN pg_catalog.pg_class class ON class.oid = rewrite.ev_class
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public' AND rewrite.rulename <> '_RETURN'
				UNION ALL
				SELECT 'policy', class.relname || '.' || policy_record.polname
				FROM pg_catalog.pg_policy policy_record
				JOIN pg_catalog.pg_class class ON class.oid = policy_record.polrelid
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public'
				UNION ALL
				SELECT 'table-security', class.relname || ':row=' || class.relrowsecurity::text || ':force=' || class.relforcerowsecurity::text
				FROM pg_catalog.pg_class class
				JOIN pg_catalog.pg_namespace namespace ON namespace.oid = class.relnamespace
				WHERE namespace.nspname = 'public' AND class.relkind = 'r'
					AND (class.relrowsecurity OR class.relforcerowsecurity)
			) objects
			ORDER BY signature
		`,
	])
	return {
		relations: sorted(relations.flatMap((row: { signature?: unknown }) => (typeof row.signature === 'string' ? [row.signature] : []))),
		columns: sorted(
			columns.flatMap((row: Record<string, unknown>) => {
				if (
					typeof row['table_name'] !== 'string' ||
					typeof row['column_name'] !== 'string' ||
					typeof row['formatted_type'] !== 'string' ||
					typeof row['not_null'] !== 'boolean' ||
					typeof row['identity'] !== 'string'
				)
					return []
				return [
					columnSignature(
						row['table_name'],
						row['column_name'],
						row['formatted_type'],
						row['not_null'],
						row['identity'],
						typeof row['default_expression'] === 'string' ? row['default_expression'] : undefined,
					),
				]
			}),
		),
		constraints: sorted(
			constraints.flatMap((row: Record<string, unknown>) =>
				typeof row['table_name'] === 'string' && typeof row['constraint_name'] === 'string' && typeof row['definition'] === 'string'
					? [`${row['table_name']}.${row['constraint_name']}|${normalizeDefinition(row['definition'])}`]
					: [],
			),
		),
		indexes: sorted(
			indexes.flatMap((row: Record<string, unknown>) =>
				typeof row['index_name'] === 'string' && typeof row['definition'] === 'string'
					? [`${row['index_name']}|${normalizeDefinition(row['definition'])}`]
					: [],
			),
		),
		unsupportedObjects: sorted(unsupportedObjects.flatMap((row: { signature?: unknown }) => (typeof row.signature === 'string' ? [row.signature] : []))),
	}
}

const assertSchemaLayout = async (connection: Awaited<ReturnType<SQL['reserve']>>, schema: string, version: SupportedSchemaVersion): Promise<void> => {
	const differences = schemaLayoutDifferences(expectedSchemaLayout(schema, version), await actualSchemaLayout(connection))
	if (Object.keys(differences).length > 0) throw new Error(`${UNSUPPORTED_SCHEMA_MESSAGE} Differences: ${JSON.stringify(differences)}`)
}

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

export const schemaInitializationAction = (markerVersion: string | undefined, publicObjects: readonly string[]): 'initialize' | 'migrate' | 'current' => {
	if (markerVersion === CURRENT_SCHEMA_VERSION) return 'current'
	if (markerVersion === PREVIOUS_SCHEMA_VERSION) return 'migrate'
	if (markerVersion !== undefined || publicObjects.length > 0) throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
	return 'initialize'
}

export const assertSupportedPostgresVersion = (versionNumber: unknown): void => {
	if (versionNumber !== SUPPORTED_POSTGRES_VERSION_NUM) throw new Error(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
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
			if (markerShape.length !== 1 || markerShape[0]?.relkind !== 'r' || markerShape[0]?.has_singleton !== true || markerShape[0]?.has_schema_version !== true)
				throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
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
		if (action === 'migrate') {
			await assertSchemaLayout(connection, schema, PREVIOUS_SCHEMA_VERSION)
			const migration = await Bun.file(path.resolve(import.meta.dir, '../migrations/002-historical-integrity.sql')).text()
			await runSchemaTransaction(
				async () => await connection.unsafe('BEGIN'),
				async () => await connection.unsafe('COMMIT'),
				async () => await connection.unsafe('ROLLBACK'),
				async () => {
					await connection.unsafe(migration)
					await assertSchemaLayout(connection, schema, CURRENT_SCHEMA_VERSION)
					await connection`
						INSERT INTO public.augurscan_schema_migrations (schema_version, description)
						VALUES (${CURRENT_SCHEMA_VERSION}, ${'Durable reorganization evidence and indexer-run provenance'})
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
