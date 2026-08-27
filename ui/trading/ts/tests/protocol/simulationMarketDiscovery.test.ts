/// <reference types='bun-types' />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulationTestUtils.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'
import { discoverLiveUniverseMarketPage } from '../../protocol/live.js'

describe('trading simulation market discovery', () => {
	let backend: SimulationBackend

	beforeAll(async () => {
		backend = await createBootstrappedSimulationBackendWithRetry('trading', 1, 'trading')
		await backend.setTransactionDelayMilliseconds(0)
	}, 180_000)

	afterAll(async () => {
		if (backend !== undefined) await backend.dispose()
		resetActiveEnvironmentForTesting()
	}, 30_000)

	test('discovers the seeded market through its Zoltar universe and factory event', async () => {
		activateSimulationBackendProfile(backend)
		const addresses = getInfraContractAddresses(backend.profile)
		const plan = getTradingDeploymentPlan(
			{
				chainId: backend.profile.chain.id,
				chainName: backend.profile.displayName,
				defaultRpcUrl: 'http://127.0.0.1/',
				id: 'simulation',
				proxyDeployer: PROXY_DEPLOYER_ADDRESS,
				securityPoolFactory: addresses.securityPoolFactory,
				zoltar: addresses.zoltar,
			},
			30,
		)
		const discovery = await discoverLiveUniverseMarketPage(backend.createReadClient(), deploymentConfigurationForPlan(plan, 'http://127.0.0.1/'), 0n)

		expect(discovery.universeIds).toEqual([0n])
		expect(discovery.markets).toHaveLength(1)
		expect(discovery.markets[0]?.title).toBe('Will this resolve?')
	}, 180_000)
})
