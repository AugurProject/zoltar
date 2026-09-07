/// <reference types='bun-types' />

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulationTestUtils.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'
import { discoverLiveUniverseMarketPage } from '../../protocol/live.js'
import { toHex } from '@zoltar/shared/ethereum'

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

	test('rejects a forged question ID through primary live discovery', async () => {
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
		const readClient = backend.createReadClient()
		let forgedQuestionLog = false
		const forgedClient = new Proxy(readClient, {
			get: (target, property, receiver) => {
				if (property === 'getBlock') {
					return async (...parameters: Parameters<typeof readClient.getBlock>) => {
						const block = await readClient.getBlock(...parameters)
						return parameters[0]?.blockNumber === 0n ? { ...block, hash: `0x${'99'.repeat(32)}` as const } : block
					}
				}
				if (property !== 'getLogs') return Reflect.get(target, property, receiver)
				return async (...parameters: Parameters<typeof readClient.getLogs>) => {
					const logs = await readClient.getLogs(...parameters)
					if (Reflect.get(parameters[0].event ?? {}, 'name') !== 'QuestionCreated') return logs
					forgedQuestionLog = true
					return logs.map(log => ({ ...log, topics: [log.topics[0], toHex(99n, { size: 32 }), ...log.topics.slice(2)] }))
				}
			},
		})
		const discovery = await discoverLiveUniverseMarketPage(forgedClient, deploymentConfigurationForPlan(plan, 'http://127.0.0.1/'), 0n)

		expect(forgedQuestionLog).toBeTrue()
		expect(discovery.markets).toHaveLength(1)
		expect(discovery.markets[0]?.loadError).toContain('mismatched deterministic question ID')
	}, 180_000)
})
