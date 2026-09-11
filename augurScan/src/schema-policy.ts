export const CURRENT_SCHEMA_VERSION = '3'
const SUPPORTED_POSTGRES_VERSION = '17.11'

const UNSUPPORTED_POSTGRES_VERSION_MESSAGE = `Unsupported PostgreSQL server version. augurScan requires PostgreSQL ${SUPPORTED_POSTGRES_VERSION} because schema fingerprints are version-specific; the database was not modified.`

export const UNSUPPORTED_SCHEMA_MESSAGE = 'Unsupported augurScan database schema. Restore a compatible backup or upgrade through a supported augurScan release; the database was not modified.'

export const PREVIOUS_SCHEMA_VERSION = '2'

export const INITIAL_MIGRATABLE_SCHEMA_VERSION = '1'

const postgresVersionNumber = (release: string): string => {
	const match = /^(\d+)\.(\d+)$/u.exec(release)
	if (match?.[1] === undefined || match[2] === undefined) throw new Error(`Invalid supported PostgreSQL release: ${release}`)
	return `${match[1]}${match[2].padStart(4, '0')}`
}

const SUPPORTED_POSTGRES_VERSION_NUM = postgresVersionNumber(SUPPORTED_POSTGRES_VERSION)

export type SupportedSchemaVersion = typeof INITIAL_MIGRATABLE_SCHEMA_VERSION | typeof PREVIOUS_SCHEMA_VERSION | typeof CURRENT_SCHEMA_VERSION

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

export const schemaInitializationAction = (markerVersion: string | undefined, publicObjects: readonly string[]): 'initialize' | 'migrate-from-1' | 'migrate-from-2' | 'current' => {
	if (markerVersion === CURRENT_SCHEMA_VERSION) return 'current'
	if (markerVersion === PREVIOUS_SCHEMA_VERSION) return 'migrate-from-2'
	if (markerVersion === INITIAL_MIGRATABLE_SCHEMA_VERSION) return 'migrate-from-1'
	if (markerVersion !== undefined || publicObjects.length > 0) throw new Error(UNSUPPORTED_SCHEMA_MESSAGE)
	return 'initialize'
}

export const assertSupportedPostgresVersion = (versionNumber: unknown): void => {
	if (versionNumber !== SUPPORTED_POSTGRES_VERSION_NUM) throw new Error(UNSUPPORTED_POSTGRES_VERSION_MESSAGE)
}
