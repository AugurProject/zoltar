import { runBunTestProcess } from './run-bun-test-process.mts'

process.exitCode = await runBunTestProcess({ cmd: [process.execPath, 'test', ...process.argv.slice(2)] })
