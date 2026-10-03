export const CURRENT_SCHEMA_VERSION = '5'
const SUPPORTED_POSTGRES_VERSION = '17.11'

const UNSUPPORTED_POSTGRES_VERSION_MESSAGE = `Unsupported PostgreSQL server version. augurScan requires PostgreSQL ${SUPPORTED_POSTGRES_VERSION} because schema fingerprints are version-specific; the database was not modified.`

export const UNSUPPORTED_SCHEMA_MESSAGE = 'Unsupported augurScan database schema. Restore a compatible backup or upgrade through a supported augurScan release; the database was not modified.'

export const QUESTION_SECONDS_SCHEMA_VERSION = '4'
export const INDEXER_OWNERSHIP_SCHEMA_VERSION = '3'
export const HISTORICAL_INTEGRITY_SCHEMA_VERSION = '2'

export const INITIAL_MIGRATABLE_SCHEMA_VERSION = '1'

const postgresVersionNumber = (release: string): string => {
	const match = /^(\d+)\.(\d+)$/u.exec(release)
	if (match?.[1] === undefined || match[2] === undefined) throw new Error(`Invalid supported PostgreSQL release: ${release}`)
	return `${match[1]}${match[2].padStart(4, '0')}`
}

const SUPPORTED_POSTGRES_VERSION_NUM = postgresVersionNumber(SUPPORTED_POSTGRES_VERSION)

export type SupportedSchemaVersion = typeof INITIAL_MIGRATABLE_SCHEMA_VERSION | typeof INDEXER_OWNERSHIP_SCHEMA_VERSION | typeof CURRENT_SCHEMA_VERSION | typeof HISTORICAL_INTEGRITY_SCHEMA_VERSION | typeof QUESTION_SECONDS_SCHEMA_VERSION

type SchemaMigration = { readonly version: SupportedSchemaVersion; readonly file: string; readonly description: string }

// Ordered upgrade steps; each records its own row in augurscan_schema_migrations when applied.
const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
	{ version: HISTORICAL_INTEGRITY_SCHEMA_VERSION, file: '002-historical-integrity.sql', description: 'Historical integrity observations and indexer provenance' },
	{ version: INDEXER_OWNERSHIP_SCHEMA_VERSION, file: '003-indexer-ownership.sql', description: 'Indexer ownership leases' },
	{ version: QUESTION_SECONDS_SCHEMA_VERSION, file: '004-question-seconds.sql', description: 'Exact question timestamps in Unix seconds' },
	{ version: CURRENT_SCHEMA_VERSION, file: '005-invalidation-counts.sql', description: 'Stored history invalidation occurrence counts' },
]

/** Migrations that upgrade a database at `startingVersion` to the current schema, in application order. */
export const pendingSchemaMigrations = (startingVersion: SupportedSchemaVersion): readonly SchemaMigration[] => SCHEMA_MIGRATIONS.filter(migration => Number(migration.version) > Number(startingVersion))

export const runSchemaTransaction = async <T>(begin: () => Promise<unknown>, commit: () => Promise<unknown>, rollback: () => Promise<unknown>, operation: () => Promise<T>): Promise<T> => {
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

export const schemaInitializationAction = (markerVersion: string | undefined, publicObjects: readonly string[]): 'initialize' | 'migrate-from-1' | 'migrate-from-2' | 'migrate-from-3' | 'migrate-from-4' | 'current' => {
	if (markerVersion === CURRENT_SCHEMA_VERSION) return 'current'
	if (markerVersion === QUESTION_SECONDS_SCHEMA_VERSION) return 'migrate-from-4'
	if (markerVersion === INDEXER_OWNERSHIP_SCHEMA_VERSION) return 'migrate-from-3'
	if (markerVersion === HISTORICAL_INTEGRITY_SCHEMA_VERSION) return 'migrate-from-2'
	if (markerVersion === INITIAL_MIGRATABLE_SCHEMA_VERSION) return 'migrate-from-1'
	if (markerVersion !== undefined || publicObjects.length > 0) throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
	return 'initialize'
}

export const assertSupportedPostgresVersion = (versionNumber: unknown): void => {
	if (versionNumber !== SUPPORTED_POSTGRES_VERSION_NUM) throw new Error(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
}
