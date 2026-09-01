import { runtimeConfig } from './config.ts'
import { runDefaultIndexerProcess } from './indexer-process-runner.ts'
import { installConsoleTimestamps } from './logging.ts'

installConsoleTimestamps()

await runDefaultIndexerProcess(runtimeConfig)
