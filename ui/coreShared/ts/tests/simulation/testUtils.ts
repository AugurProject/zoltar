import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'
import { getUiAppPaths } from '../../../../../tooling/ui/appPaths.mts'
import { getSimulationSnapshotPaths, readSimulationSnapshotManifest } from '../../../../../tooling/ui/simulationSnapshots.mts'
import { createSimulationBackend } from '../../simulation/tevmBackend.js'
import { setRuntimeNetworkProfile } from '../../wallet/networkProfile.js'
import type { SimulationScenario } from '../../simulation/scenarios.js'

export type SimulationBackend = Awaited<ReturnType<typeof createSimulationBackend>>

type SimulationTestAppId = Parameters<typeof getUiAppPaths>[0]

/** `waitFor` options for reads from the in-process simulation chain, which slow down sharply on a loaded machine. The limit only bounds how long a real failure takes to report. */
export const simulationWaitOptions = { timeout: 60_000 }

/** Limit for hooks that bootstrap a simulation chain. Setup is CPU-bound and takes about a minute on an idle machine; five minutes leaves room on a loaded one while a hung setup still fails well inside a CI job. */
export const simulationSetupTimeoutMs = 300_000

export function activateSimulationBackendProfile(backend: SimulationBackend) {
	setRuntimeNetworkProfile(backend.profile)
}

const snapshotChecks = new Map<SimulationTestAppId, Promise<boolean>>()

/** Runs the snapshot freshness check in its own process: the key comes from a bundler pass that `bun test` cannot host. */
async function hasCurrentSnapshots(appId: SimulationTestAppId) {
	const check = snapshotChecks.get(appId) ?? Bun.spawn([process.execPath, path.join(getUiAppPaths(appId).repositoryRoot, 'tooling/ui/simulationSnapshots.mts'), appId, '--check'], { stderr: 'ignore', stdout: 'ignore' }).exited.then(exitCode => exitCode === 0)
	snapshotChecks.set(appId, check)
	return await check
}

/**
 * The prepared state `bun run ui:snapshots` wrote for the scenario, when it still matches the sources the test would
 * otherwise seed from; the key check protects a test from a snapshot that predates a scenario edit. Set
 * `ZOLTAR_SIMULATION_SNAPSHOTS=0` to seed every scenario live.
 */
async function loadPreparedScenarioSnapshot(appId: SimulationTestAppId, scenario: SimulationScenario) {
	if (process.env['ZOLTAR_SIMULATION_SNAPSHOTS'] === '0' || !(await hasCurrentSnapshots(appId))) return undefined
	const paths = getSimulationSnapshotPaths(getUiAppPaths(appId))
	const entry = (await readSimulationSnapshotManifest(paths))?.scenarios[scenario]
	if (entry === undefined) return undefined
	return await fs.readFile(path.join(paths.directory, entry.file), 'utf8')
}

export async function createBootstrappedSimulationBackendWithRetry(scenario: SimulationScenario, maxAttempts = 2, appId: SimulationTestAppId = 'zoltar') {
	const scenarioSnapshot = await loadPreparedScenarioSnapshot(appId, scenario)
	let lastError: unknown = undefined
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const backend = await createSimulationBackend({ appId, scenario, ...(scenarioSnapshot === undefined ? {} : { scenarioSnapshot }) })
		activateSimulationBackendProfile(backend)
		try {
			await backend.bootstrap()
			return backend
		} catch (error) {
			lastError = error
			await backend.dispose()
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`Failed to bootstrap ${scenario} simulation backend`)
}

export async function resetSelectedAccountAndTransactionDelay(backend: SimulationBackend) {
	activateSimulationBackendProfile(backend)
	const primaryAccount = backend.accounts[0]
	if (primaryAccount !== undefined && backend.selectedAccount !== primaryAccount) await backend.selectAccount(primaryAccount)
	await backend.setTransactionDelayMilliseconds(0)
}
