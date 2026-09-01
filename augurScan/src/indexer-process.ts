import { runtimeConfig } from './config.ts'
import { startIndexers } from './indexer.ts'
import { installConsoleTimestamps } from './logging.ts'
import { initializeProcessContext, recordProcessStop } from './process-bootstrap.ts'

installConsoleTimestamps()

const { database, networks, evidenceProvenance, indexerRunId } = await initializeProcessContext(!runtimeConfig.disableIndexer)
const abortController = new AbortController()
const indexers = runtimeConfig.disableIndexer ? [] : startIndexers(networks, database, abortController.signal, { provenance: evidenceProvenance })

if (runtimeConfig.disableIndexer) console.info('augurScan indexer process disabled by DISABLE_INDEXER=1; exiting')

let shutdownPromise: Promise<void> | undefined
const shutdown = async (): Promise<void> => {
	shutdownPromise ??= (async () => {
		abortController.abort()
		const outcomes = await Promise.allSettled(indexers)
		await recordProcessStop(database, indexerRunId)
		await database.close()
		const failure = outcomes.find((outcome) => outcome.status === 'rejected')
		if (failure !== undefined) throw failure.reason
	})()
	return await shutdownPromise
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

if (runtimeConfig.disableIndexer) await shutdown()
else {
	const outcomes = await Promise.allSettled(indexers)
	const failure = outcomes.find((outcome) => outcome.status === 'rejected')
	await shutdown()
	if (failure !== undefined) throw failure.reason
}
