import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as process from 'node:process'
import { SIMULATION_SNAPSHOT_DIRECTORY, SIMULATION_SNAPSHOT_MANIFEST_FILE, isSimulationSnapshotManifest, type SimulationSnapshotManifest } from '../../ui/coreShared/ts/simulation/scenarioSnapshots.ts'
import { generatedArtifacts } from '../repo/generated-artifacts.ts'
import { getUiAppPaths, isUiAppId, parseUiAppId, UI_APP_IDS, type UiAppId, type UiAppPaths } from './appPaths.mts'
import { normalizeBundlerPath } from './bundlerPaths.mts'
import { createTevmBufferImportPlugin } from './tevmBufferImport.mts'

/**
 * Prepared simulation scenario states.
 *
 * Seeding a scenario replays every deployment and transaction on the in-browser chain, which takes seconds to minutes.
 * A snapshot is the exported chain state after seeding; the worker restores it in about a second. Snapshots are keyed
 * by the content of every workspace source the worker bundle is built from (plus the lockfile), so the worker build
 * removes them the moment they could describe a different chain, and this script regenerates them on request.
 */
export type SimulationSnapshotPaths = {
	directory: string
	manifest: string
}

export type SimulationSnapshotStatus = 'absent' | 'current' | 'stale'

/** Bundler `define` that compiles the key into a worker bundle (read by `getBundledSimulationSnapshotKey`). */
export function simulationSnapshotKeyDefine(key: string): Record<string, string> {
	return { SIMULATION_SNAPSHOT_KEY: JSON.stringify(key) }
}

const CORE_SCENARIOS = ['baseline', 'deployed'] as const

const CONTRACT_HASH_FILE = 'solidity/.contract-hash.json'

/**
 * Generated TypeScript contract artifacts are rewritten per app from the same compiled contracts (the last vendored app
 * wins), so their content is not a stable fingerprint. The compiled contracts' source hash stands in for them.
 */
const generatedContractSources = new Set(generatedArtifacts.filter(artifact => !artifact.tracked && !/[*?]/.test(artifact.pattern) && artifact.pattern.endsWith('.ts')).map(artifact => artifact.pattern))

async function readContractSourceHash(repositoryRoot: string) {
	const parsed: unknown = JSON.parse(await fs.readFile(path.join(repositoryRoot, CONTRACT_HASH_FILE), 'utf8'))
	if (typeof parsed !== 'object' || parsed === null || !('hash' in parsed) || typeof parsed.hash !== 'string') throw new Error(`${CONTRACT_HASH_FILE} has no contract source hash`)
	return parsed.hash
}

export function getSimulationSnapshotPaths(appPaths: UiAppPaths): SimulationSnapshotPaths {
	const directory = path.join(appPaths.appGeneratedJsRoot, 'simulation', SIMULATION_SNAPSHOT_DIRECTORY)
	return { directory, manifest: path.join(directory, SIMULATION_SNAPSHOT_MANIFEST_FILE) }
}

/**
 * The repository-relative TypeScript sources a bundled workspace input may have been compiled from, most specific
 * first; empty for dependencies and built-ins. Bun records inputs relative to the working directory of the build.
 */
export function getWorkerInputSourceCandidates(inputPath: string, repositoryRoot: string, cwd: string): readonly string[] {
	if (inputPath.includes(':')) return []
	const relativePath = path.relative(repositoryRoot, path.resolve(cwd, inputPath)).split(path.sep).join('/')
	if (relativePath.startsWith('..') || relativePath.includes('node_modules/')) return []
	const compiled = relativePath.match(/^((?:ui|shared)\/[^/]+)\/js\/(.+)\.js$/)
	if (compiled === null) return [relativePath]
	const [, packageRoot, modulePath] = compiled
	return [`${packageRoot}/ts/${modulePath}.ts`, `${packageRoot}/ts/${modulePath}.tsx`, relativePath]
}

async function readFirstExisting(repositoryRoot: string, candidates: readonly string[]) {
	for (const candidate of candidates) {
		try {
			return { content: await fs.readFile(path.join(repositoryRoot, candidate)), path: candidate }
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
		}
	}
	return undefined
}

function sha256(content: Uint8Array | string) {
	return createHash('sha256').update(content).digest('hex')
}

/** Hashes the workspace sources listed by a worker bundle metafile together with the lockfile that pins everything else. */
export async function computeSimulationSnapshotKeyFromMetafile(metafile: { inputs: Record<string, unknown> }, repositoryRoot: string, cwd: string = process.cwd()) {
	const entries: Array<[string, string]> = []
	let usesContractArtifacts = false
	for (const inputPath of Object.keys(metafile.inputs)) {
		const source = await readFirstExisting(repositoryRoot, getWorkerInputSourceCandidates(inputPath, repositoryRoot, cwd))
		if (source === undefined) continue
		if (generatedContractSources.has(source.path)) usesContractArtifacts = true
		else entries.push([source.path, sha256(source.content)])
	}
	if (usesContractArtifacts) entries.push([CONTRACT_HASH_FILE, await readContractSourceHash(repositoryRoot)])
	const lockfile = await readFirstExisting(repositoryRoot, ['bun.lock'])
	if (lockfile === undefined) throw new Error('bun.lock is missing')
	entries.push([lockfile.path, sha256(lockfile.content)])
	entries.sort(([left], [right]) => left.localeCompare(right))
	return sha256(JSON.stringify(entries))
}

/**
 * Bundles the worker in memory only to learn which files it is built from. Call it before anything in the process has
 * loaded tevm: once the runtime has resolved tevm's Node builds, Bun's in-process bundler can no longer produce the
 * browser bundle.
 */
export async function computeSimulationSnapshotKey(appPaths: UiAppPaths) {
	const result = await Bun.build({
		entrypoints: [normalizeBundlerPath(appPaths.workerEntrypoint)],
		metafile: true,
		plugins: [createTevmBufferImportPlugin()],
		target: 'browser',
	})
	if (!result.success || result.metafile === undefined) throw new Error(`Failed to resolve the ${appPaths.appId} simulation worker sources: ${result.logs.map(log => log.message).join('\n')}`)
	return await computeSimulationSnapshotKeyFromMetafile(result.metafile, appPaths.repositoryRoot)
}

export async function readSimulationSnapshotManifest(paths: SimulationSnapshotPaths): Promise<SimulationSnapshotManifest | undefined> {
	let serialized: string
	try {
		serialized = await fs.readFile(paths.manifest, 'utf8')
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	}
	const manifest: unknown = JSON.parse(serialized)
	if (!isSimulationSnapshotManifest(manifest)) throw new Error(`The simulation snapshot manifest at ${paths.manifest} is malformed`)
	return manifest
}

export async function getSimulationSnapshotStatus(paths: SimulationSnapshotPaths, key: string, scenarios: readonly string[]): Promise<SimulationSnapshotStatus> {
	const manifest = await readSimulationSnapshotManifest(paths)
	if (manifest === undefined) return 'absent'
	if (manifest.key !== key) return 'stale'
	for (const scenario of scenarios) {
		const entry = manifest.scenarios[scenario]
		if (entry === undefined) return 'stale'
		const exists = await fs
			.access(path.join(paths.directory, entry.file))
			.then(() => true)
			.catch(() => false)
		if (!exists) return 'stale'
	}
	return 'current'
}

/** Removes snapshots whose key no longer matches the worker sources; the worker build runs this after every bundle. */
export async function pruneStaleSimulationSnapshots(paths: SimulationSnapshotPaths, key: string): Promise<'absent' | 'current' | 'pruned'> {
	const manifest = await readSimulationSnapshotManifest(paths).catch(() => undefined)
	if (manifest === undefined) {
		const exists = await fs
			.access(paths.directory)
			.then(() => true)
			.catch(() => false)
		if (!exists) return 'absent'
		await fs.rm(paths.directory, { recursive: true, force: true })
		return 'pruned'
	}
	if (manifest.key === key) return 'current'
	await fs.rm(paths.directory, { recursive: true, force: true })
	return 'pruned'
}

/** Every scenario the app can bootstrap, in the order they are presented. */
export async function getSimulationSnapshotScenarios(appId: UiAppId): Promise<readonly string[]> {
	switch (appId) {
		case 'zoltar': {
			const { ZOLTAR_SCENARIOS } = await import('../../ui/zoltar/ts/simulation/index.ts')
			return [...CORE_SCENARIOS, ...ZOLTAR_SCENARIOS]
		}
		case 'statoblast':
		case 'openoracle': {
			const { STATOBLAST_SCENARIOS } = await import('../../ui/statoblastShared/ts/simulation/statoblastScenarioDescriptions.ts')
			return [...CORE_SCENARIOS, ...STATOBLAST_SCENARIOS]
		}
		case 'trading': {
			const { DEPLOYED_TRADING_SIMULATION_SCENARIO, FORKED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO } = await import('../../ui/trading/ts/simulation/index.ts')
			return ['baseline', DEPLOYED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO, FORKED_TRADING_SIMULATION_SCENARIO]
		}
		default:
			return appId satisfies never
	}
}

export type GenerateSimulationSnapshotsOptions = {
	concurrency?: number
	log?: (message: string) => void
	scenarios?: readonly string[]
}

async function exportScenarioSnapshot(appId: UiAppId, scenario: string) {
	const { createSimulationBackend } = await import('../../ui/coreShared/ts/simulation/tevmBackend.ts')
	const backend = await createSimulationBackend({ appId, scenario })
	try {
		await backend.bootstrap()
		return await backend.exportState(scenario)
	} finally {
		await backend.dispose()
	}
}

async function runWithConcurrency<TItem>(items: readonly TItem[], concurrency: number, work: (item: TItem) => Promise<void>) {
	const queue = [...items]
	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
		for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
	})
	await Promise.all(workers)
}

/**
 * Seeds the scenarios in their own workers and writes the snapshots with a manifest keyed by the current sources. A
 * targeted run keeps the other scenarios of a manifest generated under the same key.
 */
export async function generateSimulationSnapshots(appPaths: UiAppPaths, paths: SimulationSnapshotPaths, key: string, { concurrency = defaultConcurrency(), log = () => undefined, scenarios }: GenerateSimulationSnapshotsOptions = {}) {
	const scenarioIds = scenarios ?? (await getSimulationSnapshotScenarios(appPaths.appId))
	const existing = await readSimulationSnapshotManifest(paths).catch(() => undefined)
	const keepsExisting = existing !== undefined && existing.key === key && scenarios !== undefined
	if (!keepsExisting) await fs.rm(paths.directory, { recursive: true, force: true })
	await fs.mkdir(paths.directory, { recursive: true })
	const manifest: SimulationSnapshotManifest = { generatedAt: new Date().toISOString(), key, scenarios: keepsExisting ? { ...existing.scenarios } : {} }
	await runWithConcurrency(scenarioIds, concurrency, async scenario => {
		const startedAt = performance.now()
		const serialized = await exportScenarioSnapshot(appPaths.appId, scenario)
		const file = `${scenario}.json`
		await fs.writeFile(path.join(paths.directory, file), serialized)
		manifest.scenarios[scenario] = { file }
		log(`[simulation snapshots] ${appPaths.appId}/${scenario}: ${(serialized.length / 1024 / 1024).toFixed(1)} MiB in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`)
	})
	const order = await getSimulationSnapshotScenarios(appPaths.appId)
	manifest.scenarios = Object.fromEntries([...order, ...Object.keys(manifest.scenarios)].map(scenario => [scenario, manifest.scenarios[scenario]]).filter((entry): entry is [string, { file: string }] => entry[1] !== undefined))
	await fs.writeFile(paths.manifest, `${JSON.stringify(manifest, undefined, '\t')}\n`)
	return manifest
}

function defaultConcurrency() {
	return Math.max(1, Math.min(4, os.availableParallelism() - 1))
}

/** Regenerates the app's snapshots unless they already match the current sources; pass `key` when the process has already seeded a chain. */
export async function ensureSimulationSnapshots(appPaths: UiAppPaths, options: GenerateSimulationSnapshotsOptions & { force?: boolean; key?: string } = {}) {
	const paths = getSimulationSnapshotPaths(appPaths)
	const key = options.key ?? (await computeSimulationSnapshotKey(appPaths))
	const scenarios = options.scenarios ?? (await getSimulationSnapshotScenarios(appPaths.appId))
	const status = await getSimulationSnapshotStatus(paths, key, scenarios)
	if (status === 'current' && options.force !== true) return { key, paths, status }
	await generateSimulationSnapshots(appPaths, paths, key, { ...options, scenarios })
	return { key, paths, status: 'generated' as const }
}

function parseArguments(argv: readonly string[]) {
	const appIds: UiAppId[] = []
	const scenarios: string[] = []
	let check = false
	let force = false
	let concurrency: number | undefined
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (argument === undefined) continue
		if (argument === '--check') check = true
		else if (argument === '--force') force = true
		else if (argument === '--scenario') {
			const scenario = argv[index + 1]
			if (scenario === undefined) throw new Error('--scenario requires a scenario id')
			scenarios.push(scenario)
			index += 1
		} else if (argument === '--concurrency') {
			concurrency = Number(argv[index + 1])
			if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('--concurrency requires a positive integer')
			index += 1
		} else if (isUiAppId(argument)) appIds.push(parseUiAppId(argument, 'simulation snapshots'))
		else throw new Error(`Unknown argument ${argument}`)
	}
	return { appIds: appIds.length === 0 ? [...UI_APP_IDS] : appIds, check, concurrency, force, scenarios: scenarios.length === 0 ? undefined : scenarios }
}

if (import.meta.main) {
	const { appIds, check, concurrency, force, scenarios } = parseArguments(process.argv.slice(2))
	let stale = false
	// Every key is computed before the first scenario seeds, since seeding loads tevm into this process.
	const keys = new Map<UiAppId, string>()
	for (const appId of appIds) keys.set(appId, await computeSimulationSnapshotKey(getUiAppPaths(appId)))
	for (const appId of appIds) {
		const appPaths = getUiAppPaths(appId)
		const key = keys.get(appId)
		if (key === undefined) throw new Error(`No snapshot key for ${appId}`)
		if (check) {
			const status = await getSimulationSnapshotStatus(getSimulationSnapshotPaths(appPaths), key, scenarios ?? (await getSimulationSnapshotScenarios(appId)))
			console.log(`[simulation snapshots] ${appId}: ${status}`)
			if (status !== 'current') stale = true
			continue
		}
		const startedAt = performance.now()
		const result = await ensureSimulationSnapshots(appPaths, { ...(concurrency === undefined ? {} : { concurrency }), force, key, log: message => console.log(message), ...(scenarios === undefined ? {} : { scenarios }) })
		console.log(`[simulation snapshots] ${appId}: ${result.status} (${((performance.now() - startedAt) / 1000).toFixed(1)}s) in ${path.relative(appPaths.repositoryRoot, result.paths.directory)}`)
	}
	if (stale) process.exit(1)
}
