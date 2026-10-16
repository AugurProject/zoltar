import { createSimulationBackend } from '../../simulation/tevmBackend.js'
import { setRuntimeNetworkProfile } from '../../wallet/networkProfile.js'
import type { SimulationScenario } from '../../simulation/scenarios.js'

export type SimulationBackend = Awaited<ReturnType<typeof createSimulationBackend>>

/** `waitFor` options for reads from the in-process simulation chain, which slow down sharply on a loaded machine. The limit only bounds how long a real failure takes to report. */
export const simulationWaitOptions = { timeout: 60_000 }

/** Limit for hooks that bootstrap a simulation chain. Setup is CPU-bound and takes about a minute on an idle machine, so it matches the runner's default limit rather than a tighter one. */
export const simulationSetupTimeoutMs = 300_000

export function activateSimulationBackendProfile(backend: SimulationBackend) {
	setRuntimeNetworkProfile(backend.profile)
}

export async function createBootstrappedSimulationBackendWithRetry(scenario: SimulationScenario, maxAttempts = 2, appId: 'zoltar' | 'statoblast' | 'trading' = 'zoltar') {
	let lastError: unknown = undefined
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const backend = await createSimulationBackend({ appId, scenario })
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
