import { expect, test } from 'bun:test'
import path from 'node:path'
import { runIndexerProcess } from '../src/indexer-process-runner.ts'

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

	await Bun.sleep(500)
	const earlyExit = await Promise.race([child.exited.then((code) => ({ exited: true, code })), Bun.sleep(50).then(() => ({ exited: false as const }))])
	expect(earlyExit).toEqual({ exited: false })

	child.kill('SIGTERM')
	expect(await child.exited).toBe(0)
	expect(await new Response(child.stdout).text()).toContain('["stop","close"]')
	expect(await new Response(child.stderr).text()).toBe('')
})

test('signal-triggered shutdown aborts active indexers before recording and closing', async () => {
	let terminate: (() => void) | undefined
	const untilTerminated = new Promise<void>((resolve) => {
		terminate = resolve
	})
	const events: string[] = []
	const database = { close: async () => events.push('close') }
	const running = runIndexerProcess({
		runtimeConfig: { disableIndexer: false },
		initialize: async () => ({
			database,
			networks: [],
			evidenceProvenance: { indexerRunId: '1', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'proj' },
			indexerRunId: '1',
		}),
		start: (_networks, _database, signal) => [
			new Promise<void>((resolve) => {
				signal.addEventListener('abort', () => {
					events.push('indexer-stopped')
					resolve()
				})
			}),
		],
		recordStop: async () => {
			events.push('stop-recorded')
		},
		untilTerminated,
	})
	terminate?.()
	await expect(Promise.race([running.then(() => 'stopped'), Bun.sleep(250).then(() => 'timed-out')])).resolves.toBe('stopped')
	expect(events).toEqual(['indexer-stopped', 'stop-recorded', 'close'])
})

test('termination during initialization cleans up without starting indexers', async () => {
	let finishInitialization: (() => void) | undefined
	let terminate: (() => void) | undefined
	const initialization = new Promise<void>((resolve) => {
		finishInitialization = resolve
	})
	const untilTerminated = new Promise<void>((resolve) => {
		terminate = resolve
	})
	const events: string[] = []
	const database = { close: async () => events.push('close') }
	const running = runIndexerProcess({
		runtimeConfig: { disableIndexer: false },
		initialize: async () => {
			await initialization
			return {
				database,
				networks: [],
				evidenceProvenance: { indexerRunId: '1', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'proj' },
				indexerRunId: '1',
			}
		},
		start: () => {
			events.push('start')
			return []
		},
		recordStop: async () => events.push('stop-recorded'),
		untilTerminated,
	})
	terminate?.()
	await Bun.sleep(0)
	finishInitialization?.()
	await running
	expect(events).toEqual(['stop-recorded', 'close'])
})
