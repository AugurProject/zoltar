import { expect, test } from 'bun:test'
import path from 'node:path'
import { runIndexerProcess } from '../../src/indexer-process-lifecycle.ts'

const projectRoot = path.resolve(import.meta.dir, '..', '..')

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
	let resolvePromise: (() => void) | undefined
	const promise = new Promise<void>(resolve => {
		resolvePromise = resolve
	})
	return { promise, resolve: () => resolvePromise?.() }
}

const initializedProcess = (events: string[]) => ({
	database: {
		close: async () => {
			events.push('close')
		},
	},
	networks: [],
	evidenceProvenance: { indexerRunId: '1', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'proj' },
	indexerRunId: '1',
})

test('keeps a disabled indexer process alive until termination without starting indexers', async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			'-e',
			`import { runIndexerProcess, terminationSignal } from './src/indexer-process-lifecycle.ts'
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

	await Bun.sleep(500)
	const earlyExit = await Promise.race([child.exited.then(code => ({ exited: true, code })), Bun.sleep(50).then(() => ({ exited: false as const }))])
	expect(earlyExit).toEqual({ exited: false })

	child.kill('SIGTERM')
	expect(await child.exited).toBe(0)
	expect(await new Response(child.stdout).text()).toContain('["stop","close"]')
	expect(await new Response(child.stderr).text()).toBe('')
})

test('signal-triggered shutdown aborts active indexers before recording and closing', async () => {
	const termination = deferred()
	const events: string[] = []
	const running = runIndexerProcess({
		runtimeConfig: { disableIndexer: false },
		initialize: async () => initializedProcess(events),
		start: (_networks, _database, signal) => [
			new Promise<void>(resolve => {
				signal.addEventListener('abort', () => {
					events.push('indexer-stopped')
					resolve()
				})
			}),
		],
		recordStop: async () => {
			events.push('stop-recorded')
		},
		untilTerminated: termination.promise,
	})
	termination.resolve()
	await expect(Promise.race([running.then(() => 'stopped'), Bun.sleep(250).then(() => 'timed-out')])).resolves.toBe('stopped')
	expect(events).toEqual(['indexer-stopped', 'stop-recorded', 'close'])
})

test('termination during initialization cleans up without starting indexers', async () => {
	const initialization = deferred()
	const termination = deferred()
	const events: string[] = []
	const running = runIndexerProcess({
		runtimeConfig: { disableIndexer: false },
		initialize: async () => {
			await initialization.promise
			return initializedProcess(events)
		},
		start: () => {
			events.push('start')
			return []
		},
		recordStop: async () => {
			events.push('stop-recorded')
		},
		untilTerminated: termination.promise,
	})
	termination.resolve()
	await Bun.sleep(0)
	initialization.resolve()
	await running
	expect(events).toEqual(['stop-recorded', 'close'])
})
