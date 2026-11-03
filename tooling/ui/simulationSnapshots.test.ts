/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getUiAppPaths } from './appPaths.mts'
import {
	computeSimulationSnapshotKey,
	computeSimulationSnapshotKeyFromMetafile,
	generateSimulationSnapshots,
	getSimulationSnapshotScenarios,
	getSimulationSnapshotStatus,
	getWorkerInputSourceCandidates,
	pruneStaleSimulationSnapshots,
	readSimulationSnapshotManifest,
	simulationSnapshotKeyDefine,
	type SimulationSnapshotPaths,
} from './simulationSnapshots.mts'

const temporaryDirectories: string[] = []

async function createTemporaryPaths(): Promise<SimulationSnapshotPaths> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simulation-snapshots-'))
	temporaryDirectories.push(root)
	const directory = path.join(root, 'snapshots')
	return { directory, manifest: path.join(directory, 'manifest.json') }
}

async function writeManifest(paths: SimulationSnapshotPaths, key: string, scenarios: readonly string[]) {
	await fs.mkdir(paths.directory, { recursive: true })
	for (const scenario of scenarios) await fs.writeFile(path.join(paths.directory, `${scenario}.json`), '{}')
	await fs.writeFile(paths.manifest, JSON.stringify({ generatedAt: '2026-11-02T00:00:00.000Z', key, scenarios: Object.fromEntries(scenarios.map(scenario => [scenario, { file: `${scenario}.json` }])) }))
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('simulation snapshots', () => {
	test('maps bundled workspace inputs back to their TypeScript sources from any working directory', () => {
		const root = '/repo'
		expect(getWorkerInputSourceCandidates('ui/coreShared/js/simulation/clock.js', root, root)).toEqual(['ui/coreShared/ts/simulation/clock.ts', 'ui/coreShared/ts/simulation/clock.tsx', 'ui/coreShared/js/simulation/clock.js'])
		expect(getWorkerInputSourceCandidates('../coreShared/js/simulation/clock.js', root, '/repo/ui/statoblast')).toEqual(['ui/coreShared/ts/simulation/clock.ts', 'ui/coreShared/ts/simulation/clock.tsx', 'ui/coreShared/js/simulation/clock.js'])
		expect(getWorkerInputSourceCandidates('shared/core/js/evm/ethereum.js', root, root)).toEqual(['shared/core/ts/evm/ethereum.ts', 'shared/core/ts/evm/ethereum.tsx', 'shared/core/js/evm/ethereum.js'])
		expect(getWorkerInputSourceCandidates('ui/statoblast/ts/simulation/tevmWorker.ts', root, root)).toEqual(['ui/statoblast/ts/simulation/tevmWorker.ts'])
		expect(getWorkerInputSourceCandidates('node_modules/.bun/viem@2/node_modules/viem/index.js', root, root)).toEqual([])
		expect(getWorkerInputSourceCandidates('../../elsewhere/file.js', root, root)).toEqual([])
		expect(getWorkerInputSourceCandidates('node:events', root, root)).toEqual([])
	})

	test('keys snapshots by the sources behind the inputs and the lockfile', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simulation-snapshot-key-'))
		temporaryDirectories.push(root)
		await fs.mkdir(path.join(root, 'ui/coreShared/ts/simulation'), { recursive: true })
		await fs.mkdir(path.join(root, 'ui/coreShared/js/simulation'), { recursive: true })
		await fs.writeFile(path.join(root, 'ui/coreShared/ts/simulation/clock.ts'), 'export const a = 1')
		await fs.writeFile(path.join(root, 'ui/coreShared/js/simulation/clock.js'), 'export const a = 1')
		await fs.writeFile(path.join(root, 'ui/coreShared/js/simulation/compiledOnly.js'), 'export const b = 2')
		await fs.writeFile(path.join(root, 'bun.lock'), 'lock')
		const inputs = { 'node:events': {}, 'node_modules/viem/index.js': {}, 'ui/coreShared/js/simulation/clock.js': {}, 'ui/coreShared/js/simulation/compiledOnly.js': {} }
		const key = await computeSimulationSnapshotKeyFromMetafile({ inputs }, root, root)
		expect(await computeSimulationSnapshotKeyFromMetafile({ inputs }, root, root)).toBe(key)

		// Generated contract artifacts are rewritten per app; the compiled contracts' source hash stands in for them.
		await fs.writeFile(path.join(root, 'ui/coreShared/ts/contractArtifact.ts'), 'export const zoltarScoped = 1')
		await fs.mkdir(path.join(root, 'solidity'), { recursive: true })
		await fs.writeFile(path.join(root, 'solidity/.contract-hash.json'), JSON.stringify({ hash: 'abc', updated: 1 }))
		const withArtifacts = { ...inputs, 'ui/coreShared/js/contractArtifact.js': {} }
		const artifactKey = await computeSimulationSnapshotKeyFromMetafile({ inputs: withArtifacts }, root, root)
		expect(artifactKey).not.toBe(key)
		await fs.writeFile(path.join(root, 'ui/coreShared/ts/contractArtifact.ts'), 'export const statoblastScoped = 2')
		expect(await computeSimulationSnapshotKeyFromMetafile({ inputs: withArtifacts }, root, root)).toBe(artifactKey)
		await fs.writeFile(path.join(root, 'solidity/.contract-hash.json'), JSON.stringify({ hash: 'def', updated: 2 }))
		expect(await computeSimulationSnapshotKeyFromMetafile({ inputs: withArtifacts }, root, root)).not.toBe(artifactKey)

		await fs.writeFile(path.join(root, 'ui/coreShared/ts/simulation/clock.ts'), 'export const a = 2')
		const sourceChanged = await computeSimulationSnapshotKeyFromMetafile({ inputs }, root, root)
		expect(sourceChanged).not.toBe(key)
		// The same inputs recorded from a package directory hash to the same key.
		const fromPackage = { 'node:events': {}, '../../node_modules/viem/index.js': {}, '../coreShared/js/simulation/clock.js': {}, '../coreShared/js/simulation/compiledOnly.js': {} }
		expect(await computeSimulationSnapshotKeyFromMetafile({ inputs: fromPackage }, root, path.join(root, 'ui/statoblast'))).toBe(sourceChanged)
		await fs.writeFile(path.join(root, 'bun.lock'), 'lock2')
		expect(await computeSimulationSnapshotKeyFromMetafile({ inputs }, root, root)).not.toBe(sourceChanged)
		await fs.rm(path.join(root, 'bun.lock'))
		await expect(computeSimulationSnapshotKeyFromMetafile({ inputs }, root, root)).rejects.toThrow('bun.lock is missing')
	})

	test('reports absent, stale and current snapshots and prunes the stale ones', async () => {
		const paths = await createTemporaryPaths()
		expect(await getSimulationSnapshotStatus(paths, 'key', ['baseline'])).toBe('absent')
		expect(await pruneStaleSimulationSnapshots(paths, 'key')).toBe('absent')

		await writeManifest(paths, 'key', ['baseline'])
		expect(await getSimulationSnapshotStatus(paths, 'key', ['baseline'])).toBe('current')
		expect(await getSimulationSnapshotStatus(paths, 'key', ['baseline', 'deployed'])).toBe('stale')
		await fs.rm(path.join(paths.directory, 'baseline.json'))
		expect(await getSimulationSnapshotStatus(paths, 'key', ['baseline'])).toBe('stale')
		expect(await pruneStaleSimulationSnapshots(paths, 'key')).toBe('current')

		expect(await pruneStaleSimulationSnapshots(paths, 'other')).toBe('pruned')
		expect(await readSimulationSnapshotManifest(paths)).toBeUndefined()
		await fs.mkdir(paths.directory, { recursive: true })
		await fs.writeFile(paths.manifest, '{"scenarios":[]}')
		await expect(readSimulationSnapshotManifest(paths)).rejects.toThrow('malformed')
		expect(await pruneStaleSimulationSnapshots(paths, 'key')).toBe('pruned')
	})

	test('lists the core scenarios before each app scenario', async () => {
		expect(await getSimulationSnapshotScenarios('zoltar')).toEqual(['baseline', 'deployed', 'two-questions', 'forked-categorical'])
		expect((await getSimulationSnapshotScenarios('statoblast')).slice(0, 3)).toEqual(['baseline', 'deployed', 'portfolio'])
		expect(await getSimulationSnapshotScenarios('openoracle')).toEqual(await getSimulationSnapshotScenarios('statoblast'))
		expect(await getSimulationSnapshotScenarios('trading')).toEqual(['baseline', 'deployed', 'trading-funded', 'trading-forked'])
	})

	test('compiles the key into a bundle where the worker reads it', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'simulation-snapshot-define-'))
		temporaryDirectories.push(root)
		const entry = path.join(root, 'entry.ts')
		await fs.writeFile(entry, "declare const SIMULATION_SNAPSHOT_KEY: string | undefined\nexport const key = typeof SIMULATION_SNAPSHOT_KEY === 'string' ? SIMULATION_SNAPSHOT_KEY : undefined\n")
		const result = await Bun.build({ define: simulationSnapshotKeyDefine('abc123'), entrypoints: [entry], target: 'browser' })
		expect(result.success).toBe(true)
		const output = await result.outputs[0]?.text()
		expect(output).toContain('"abc123"')
		expect(output).not.toContain('SIMULATION_SNAPSHOT_KEY')
	})

	test('derives a stable key from the real worker bundle', async () => {
		const appPaths = getUiAppPaths('zoltar')
		const key = await computeSimulationSnapshotKey(appPaths)
		expect(key).toMatch(/^[0-9a-f]{64}$/)
		expect(await computeSimulationSnapshotKey(appPaths)).toBe(key)
	}, 60_000)

	// Seeding loads tevm into this process, after which the in-process bundler behind the key no longer builds the worker; keep the key test above.
	test('a targeted regeneration keeps the other scenarios of a manifest made under the same key', async () => {
		const paths = await createTemporaryPaths()
		const appPaths = getUiAppPaths('zoltar')
		await generateSimulationSnapshots(appPaths, paths, 'same-key', { concurrency: 1, scenarios: ['baseline'] })
		await generateSimulationSnapshots(appPaths, paths, 'same-key', { concurrency: 1, scenarios: ['deployed'] })
		const manifest = await readSimulationSnapshotManifest(paths)
		expect(Object.keys(manifest?.scenarios ?? {})).toEqual(['baseline', 'deployed'])
		expect(await getSimulationSnapshotStatus(paths, 'same-key', ['baseline', 'deployed'])).toBe('current')
		await generateSimulationSnapshots(appPaths, paths, 'other-key', { concurrency: 1, scenarios: ['baseline'] })
		expect(Object.keys((await readSimulationSnapshotManifest(paths))?.scenarios ?? {})).toEqual(['baseline'])
		expect(await getSimulationSnapshotStatus(paths, 'other-key', ['baseline', 'deployed'])).toBe('stale')
	}, 120_000)
})
