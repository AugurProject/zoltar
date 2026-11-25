import path from 'node:path'
import type { SQL } from 'bun'
import { abiSourceHash } from './abi-catalog.ts'
import { configuredGenesisOutcome, loadNetworks, runtimeConfig } from './config.ts'
import { type EvidenceProvenance, ScannerDatabase } from './database.ts'
import type { JsonValue } from './ethereum.ts'
import { sourceProvenance } from './provenance.ts'
import { initializeSchema } from './schema.ts'
import { CURRENT_SCHEMA_VERSION } from './schema-policy.ts'
import type { NetworkConfig } from './types.ts'

export type AugurScanProcessContext = {
	readonly database: ScannerDatabase
	readonly networks: readonly NetworkConfig[]
	readonly indexerRunId: string
	readonly evidenceProvenance: EvidenceProvenance
}

const packageVersion = async (): Promise<string> => {
	const packageMetadata = (await Bun.file(path.resolve(import.meta.dir, '../package.json')).json()) as { readonly version?: unknown }
	if (typeof packageMetadata.version !== 'string') throw new Error('augurScan package version is missing')
	return packageMetadata.version
}

const networkConfiguration = (networks: readonly NetworkConfig[], genesisOutcome: ReturnType<typeof configuredGenesisOutcome>): readonly JsonValue[] =>
	networks.map(network => ({
		id: network.id,
		genesisOutcome,
		scanDirectCalls: runtimeConfig.scanDirectCalls,
		traceSelectedTransactions: runtimeConfig.traceSelectedTransactions,
		chainId: network.chainId,
		startBlock: network.startBlock.toString(),
		confirmationDepth: network.confirmationDepth.toString(),
		contracts: network.contracts.map(([address, label, kind, deploymentBlock]) => ({
			address,
			label,
			kind,
			...(deploymentBlock === undefined ? {} : { deploymentBlock: deploymentBlock.toString() }),
		})),
	}))

// The first run binds the database, even if the app starts before the worker has seeded a network.
// Runs and networks created before deployment profiles always describe Yes genesis.
/** @internal Exported for the database binding integration test. */
export const assertDatabaseGenesisOutcome = async (transaction: SQL, outcome: ReturnType<typeof configuredGenesisOutcome>): Promise<void> => {
	await transaction`LOCK TABLE indexer_runs IN SHARE ROW EXCLUSIVE MODE`
	const [binding] = await transaction`
		SELECT COALESCE(
			(SELECT COALESCE(network_configuration->0->>'genesisOutcome', 'yes') FROM indexer_runs ORDER BY id LIMIT 1),
			(SELECT 'yes' FROM networks LIMIT 1)
		) AS outcome
	`
	if (typeof binding?.outcome === 'string' && binding.outcome !== outcome) throw new Error(`Database contains ${binding.outcome} genesis history. Use a separate PostgreSQL database for ${outcome} genesis.`)
}

export const initializeProcessContext = async (indexerEnabled: boolean): Promise<AugurScanProcessContext> => {
	const database = new ScannerDatabase(runtimeConfig.postgresUrl)
	await initializeSchema(database.sql)
	const outcome = configuredGenesisOutcome()
	const networks = await loadNetworks(outcome)
	const [version, sourceHashes] = await Promise.all([packageVersion(), sourceProvenance()])
	const runRows = await database.sql.begin(async transaction => {
		await assertDatabaseGenesisOutcome(transaction, outcome)
		return await transaction`
			INSERT INTO indexer_runs
				(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash, indexer_enabled, network_configuration)
			VALUES (${CURRENT_SCHEMA_VERSION}, ${version}, ${abiSourceHash}, ${sourceHashes.applicationSourceHash},
				${sourceHashes.projectionSourceHash}, ${indexerEnabled}, ${JSON.stringify(networkConfiguration(networks, outcome))}::jsonb)
			RETURNING id::text
		`
	})
	const indexerRunId = runRows[0]?.['id']
	if (typeof indexerRunId !== 'string' || !/^\d+$/.test(indexerRunId)) throw new Error('Unable to record augurScan indexer-run provenance')
	return {
		database,
		networks,
		indexerRunId,
		evidenceProvenance: {
			indexerRunId,
			abiSourceHash,
			applicationSourceHash: sourceHashes.applicationSourceHash,
			projectionSourceHash: sourceHashes.projectionSourceHash,
		},
	}
}

export const recordProcessStop = async (database: ScannerDatabase, indexerRunId: string): Promise<void> => {
	try {
		await database.sql`UPDATE indexer_runs SET stopped_at = now() WHERE id = ${indexerRunId}`
	} catch (error) {
		console.error(`Unable to record indexer-run shutdown (${error instanceof Error ? error.name : typeof error})`)
	}
}
