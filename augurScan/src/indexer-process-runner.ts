import { startIndexers } from './indexer.ts'
import { type RuntimeSettings, runIndexerProcess, terminationSignal } from './indexer-process-lifecycle.ts'
import { initializeProcessContext, recordProcessStop } from './process-bootstrap.ts'

export const runDefaultIndexerProcess = async (runtimeConfig: RuntimeSettings): Promise<void> =>
	await runIndexerProcess({
		runtimeConfig,
		initialize: initializeProcessContext,
		start: startIndexers,
		recordStop: recordProcessStop,
		untilTerminated: terminationSignal(),
	})
