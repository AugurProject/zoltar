import type { EvidenceProvenance, ScannerDatabase } from './database.ts'
import { safeIndexerFailure } from './indexer-runtime.ts'
import type { NetworkConfig } from './types.ts'

export * from './indexer/planning.ts'

import { NetworkIndexer } from './indexer/block-ingestion.ts'

export const startIndexers = (
	networks: readonly NetworkConfig[],
	database: ScannerDatabase,
	signal: AbortSignal,
	options: {
		readonly provenance?: EvidenceProvenance
	} = {},
): readonly Promise<void>[] => networks.map(network => runIndexerTask(network.id, () => new NetworkIndexer(network, database, signal, options).run()))

const runIndexerTask = async (networkId: string, run: () => Promise<void>): Promise<void> => {
	try {
		await run()
		console.info(`[${networkId}] indexer state: stopped`)
	} catch (error) {
		const message = safeIndexerFailure(error)
		console.error(`[${networkId}] indexer state: stopped; ${message}`)
	}
}
