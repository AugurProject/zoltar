import type { SimulationScenario } from './scenarios.js'

/**
 * Prepared scenario states live next to the simulation worker bundle: a manifest naming one serialized saved-state
 * envelope per scenario. The build writes them (`bun run ui:snapshots <app>`) and removes them again as soon as the
 * sources behind the worker change, so a browser either finds a current snapshot or seeds the scenario live.
 */
export const SIMULATION_SNAPSHOT_DIRECTORY = 'snapshots'
export const SIMULATION_SNAPSHOT_MANIFEST_FILE = 'manifest.json'

/** Injected by the worker bundle builds (`workers.mts`, `production.mts`) so a bundle can recognise snapshots made for its sources. */
declare const SIMULATION_SNAPSHOT_KEY: string | undefined

export function getBundledSimulationSnapshotKey(): string | undefined {
	return typeof SIMULATION_SNAPSHOT_KEY === 'string' ? SIMULATION_SNAPSHOT_KEY : undefined
}

export type SimulationScenarioSnapshot = {
	/** The source key the snapshot manifest was generated under. */
	manifestKey: string
	snapshot: string
}

export type SimulationSnapshotManifest = {
	generatedAt: string
	/** Content key of the worker's sources when the snapshots were generated. */
	key: string
	scenarios: Record<string, { file: string }>
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSimulationSnapshotManifest(value: unknown): value is SimulationSnapshotManifest {
	if (!isObjectRecord(value) || typeof value['generatedAt'] !== 'string' || typeof value['key'] !== 'string' || !isObjectRecord(value['scenarios'])) return false
	return Object.values(value['scenarios']).every(entry => isObjectRecord(entry) && typeof entry['file'] === 'string' && entry['file'] !== '')
}

function getSimulationSnapshotDirectoryUrl(workerPath: URL) {
	return new URL(`./${SIMULATION_SNAPSHOT_DIRECTORY}/`, workerPath)
}

/** Loads the prepared state for `scenario` from the snapshot directory next to a served worker bundle, or nothing when the build has none. */
export async function fetchSimulationScenarioSnapshot(workerPath: URL, scenario: SimulationScenario, fetchImplementation: typeof fetch = fetch): Promise<SimulationScenarioSnapshot | undefined> {
	if (workerPath.protocol !== 'http:' && workerPath.protocol !== 'https:') return undefined
	const directory = getSimulationSnapshotDirectoryUrl(workerPath)
	const manifestResponse = await fetchImplementation(new URL(SIMULATION_SNAPSHOT_MANIFEST_FILE, directory), { cache: 'no-cache' })
	if (!manifestResponse.ok) return undefined
	const manifest: unknown = await manifestResponse.json()
	if (!isSimulationSnapshotManifest(manifest)) throw new Error('The simulation snapshot manifest is malformed')
	const entry = manifest.scenarios[scenario]
	if (entry === undefined) return undefined
	const snapshotResponse = await fetchImplementation(new URL(entry.file, directory), { cache: 'no-cache' })
	if (!snapshotResponse.ok) throw new Error(`The ${scenario} simulation snapshot could not be loaded (${snapshotResponse.status})`)
	return { manifestKey: manifest.key, snapshot: await snapshotResponse.text() }
}
