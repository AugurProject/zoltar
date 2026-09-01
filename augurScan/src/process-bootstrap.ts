import path from 'node:path'
import { loadNetworks, runtimeConfig } from './config.ts'
import { type EvidenceProvenance, ScannerDatabase } from './database.ts'
import { abiSourceHash } from './metadata.ts'
import { sourceProvenance } from './provenance.ts'
import { CURRENT_SCHEMA_VERSION, initializeSchema } from './schema.ts'
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

const networkConfiguration = (networks: readonly NetworkConfig[]): unknown =>
	networks.map((network) => ({
		id: network.id,
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

export const initializeProcessContext = async (indexerEnabled: boolean): Promise<AugurScanProcessContext> => {
	const database = new ScannerDatabase(runtimeConfig.postgresUrl)
	await initializeSchema(database.sql)
	const networks = await loadNetworks()
	const [version, sourceHashes] = await Promise.all([packageVersion(), sourceProvenance()])
	const runRows = await database.sql`
		INSERT INTO indexer_runs
			(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash, indexer_enabled, network_configuration)
		VALUES (${CURRENT_SCHEMA_VERSION}, ${version}, ${abiSourceHash}, ${sourceHashes.applicationSourceHash},
			${sourceHashes.projectionSourceHash}, ${indexerEnabled}, ${JSON.stringify(networkConfiguration(networks))}::jsonb)
		RETURNING id::text
	`
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
