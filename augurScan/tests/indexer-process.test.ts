import { expect, test } from 'bun:test'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')

test('keeps a disabled indexer process alive until termination without starting indexers', async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			'-e',
			`import { runIndexerProcess, terminationSignal } from './src/indexer-process-runner.ts'
const events = []
const database = { close: async () => events.push('close') }
runIndexerProcess({
  runtimeConfig: { disableIndexer: true },
  initialize: async () => ({ database, networks: [], evidenceProvenance: { indexerRunId: '1', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'proj' }, indexerRunId: '1' }),
  start: () => { events.push('start'); return [] },
  recordStop: async () => { events.push('stop') },
  untilTerminated: terminationSignal(),
}).then(() => {
  console.log(JSON.stringify(events))
  process.exit(0)
}).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})`,
		],
		{ cwd: projectRoot, stdout: 'pipe', stderr: 'pipe' },
	)

	await Bun.sleep(150)
	const earlyExit = await Promise.race([child.exited.then((code) => ({ exited: true, code })), Bun.sleep(50).then(() => ({ exited: false as const }))])
	expect(earlyExit).toEqual({ exited: false })

	child.kill('SIGTERM')
	expect(await child.exited).toBe(0)
	expect(await new Response(child.stdout).text()).toContain('["stop","close"]')
	expect(await new Response(child.stderr).text()).toBe('')
})
