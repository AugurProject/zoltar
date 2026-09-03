import { startIndexers } from './indexer.ts'
import { initializeProcessContext, recordProcessStop } from './process-bootstrap.ts'

type RuntimeSettings = {
	readonly disableIndexer: boolean
}

type ProcessContext = {
	readonly database: { close: () => Promise<void> }
	readonly networks: readonly unknown[]
	readonly evidenceProvenance: {
		readonly indexerRunId: string
		readonly abiSourceHash: string
		readonly applicationSourceHash: string
		readonly projectionSourceHash: string
	}
	readonly indexerRunId: string
}

type RunnerDependencies<TContext extends ProcessContext> = {
	readonly runtimeConfig: RuntimeSettings
	readonly initialize: (indexerEnabled: boolean) => Promise<TContext>
	readonly start: (
		networks: TContext['networks'],
		database: TContext['database'],
		signal: AbortSignal,
		options: { readonly provenance: TContext['evidenceProvenance'] },
	) => readonly Promise<void>[]
	readonly recordStop: (database: TContext['database'], indexerRunId: string) => Promise<void>
	readonly untilTerminated: Promise<void>
}

export const terminationSignal = (): Promise<void> =>
	new Promise((resolve) => {
		let resolved = false
		const keepAlive = setInterval(() => {}, 1 << 30)
		const finish = (): void => {
			if (resolved) return
			resolved = true
			clearInterval(keepAlive)
			resolve()
		}
		process.once('SIGINT', finish)
		process.once('SIGTERM', finish)
	})

export const runIndexerProcess = async <TContext extends ProcessContext>({
	runtimeConfig,
	initialize,
	start,
	recordStop,
	untilTerminated,
}: RunnerDependencies<TContext>): Promise<void> => {
	let terminationRequested = false
	void untilTerminated.then(() => {
		terminationRequested = true
	})
	const { database, networks, evidenceProvenance, indexerRunId } = await initialize(!runtimeConfig.disableIndexer)
	const abortController = new AbortController()
	if (terminationRequested) abortController.abort()
	const indexers =
		runtimeConfig.disableIndexer || terminationRequested ? [] : start(networks, database, abortController.signal, { provenance: evidenceProvenance })

	let shutdownPromise: Promise<void> | undefined
	const shutdown = async (): Promise<void> => {
		shutdownPromise ??= (async () => {
			abortController.abort()
			const outcomes = await Promise.allSettled(indexers)
			try {
				await recordStop(database, indexerRunId)
			} finally {
				await database.close()
			}
			const failure = outcomes.find((outcome) => outcome.status === 'rejected')
			if (failure !== undefined) throw failure.reason
		})()
		return await shutdownPromise
	}

	if (runtimeConfig.disableIndexer) {
		console.info('augurScan indexer process disabled by DISABLE_INDEXER=1; waiting for shutdown signal')
		await untilTerminated
		await shutdown()
		return
	}

	try {
		const completed = Promise.allSettled(indexers)
		const result = await Promise.race([
			completed.then((outcomes) => ({ kind: 'completed' as const, outcomes })),
			untilTerminated.then(() => ({ kind: 'terminated' as const })),
		])
		await shutdown()
		if (result.kind === 'completed') {
			const failure = result.outcomes.find((outcome) => outcome.status === 'rejected')
			if (failure !== undefined) throw failure.reason
		}
	} catch (error) {
		await shutdown()
		throw error
	}
}

export const runDefaultIndexerProcess = async (runtimeConfig: RuntimeSettings): Promise<void> =>
	await runIndexerProcess({
		runtimeConfig,
		initialize: initializeProcessContext,
		start: startIndexers,
		recordStop: recordProcessStop,
		untilTerminated: terminationSignal(),
	})
