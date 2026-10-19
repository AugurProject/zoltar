import { expect, test } from 'bun:test'
import { getActiveNetworkProfile, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getRegisteredSimulationScenarios, getSimulationScenarioDescription } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { initializeOpenOracleActiveEnvironment } from '../../app/activeEnvironment.js'
import { registerStatoblastSimulationScenarios } from '@zoltar/ui-statoblast-shared/simulation/registerStatoblastScenarios.js'

installDomTestLifecycle({ afterTest: resetActiveEnvironmentForTesting })

test('initializes the requested public network for the standalone oracle app', async () => {
	await initializeOpenOracleActiveEnvironment({ hostname: 'localhost', search: '?network=sepolia' })
	expect(getActiveNetworkProfile().id).toBe('sepolia')
})

test('registers the pool-backed report fixtures used by the standalone oracle simulation', () => {
	registerStatoblastSimulationScenarios()
	expect(getRegisteredSimulationScenarios()).toContain('security-pool')
	expect(getSimulationScenarioDescription('security-pool')).not.toContain('Unregistered')
})
