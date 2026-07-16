import { createSimulationBackend } from '../../simulation/tevmBackend.js'
import type { SimulationScenario } from '../../simulation/scenarios.js'

export type SimulationBackend = Awaited<ReturnType<typeof createSimulationBackend>>

export async function createBootstrappedSimulationBackendWithRetry(scenario: SimulationScenario, maxAttempts = 2) {
	let lastError: unknown = undefined
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		const backend = await createSimulationBackend({ scenario })
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
	const primaryAccount = backend.accounts[0]
	if (primaryAccount !== undefined && backend.selectedAccount !== primaryAccount) await backend.selectAccount(primaryAccount)
	backend.setTransactionDelayMilliseconds(0)
}
