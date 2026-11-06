import { createSimulationEngine } from '@zoltar/ui-core-shared/simulation/tevmEngine.js'
import { setRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getDeploymentSteps } from '@zoltar/ui-statoblast-shared/protocol/deployment.js'
import { getZoltarAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'
import { forkSeededPortfolio } from '@zoltar/ui-statoblast-shared/simulation/portfolioScenarioFork.js'
import { loadTradingDetails } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { expect, test } from 'bun:test'
import { createPublicClient, custom } from '@zoltar/core-shared/evm/ethereum'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { simulationSetupTimeoutMs } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { loadAllSecurityPools } from '@zoltar/ui-statoblast-shared/protocol/securityPools.js'

test(
	'forked portfolio simulation retains parent shares and prepares a child question',
	async () => {
		const engine = await createSimulationEngine({
			dependencies: {
				applyScenario: async parameters => {
					setRuntimeNetworkProfile(parameters.profile)
					await applyStatoblastScenario({ ...parameters, scenario: 'security-pool' })
					const [pool] = await loadAllSecurityPools(parameters.createReadClient())
					if (pool === undefined) throw new Error('Missing seeded portfolio question')
					await forkSeededPortfolio(parameters, pool.portfolioAddress, pool.securityPoolAddress, BigInt(pool.questionId))
					return true
				},
				getDeploymentSteps,
				getZoltarAddress,
			},
			initialization: { kind: 'scenario', scenario: 'portfolio' },
		})
		await engine.bootstrap()
		setRuntimeNetworkProfile(engine.getProfile())
		const client = createPublicClient({ transport: custom({ request: request => engine.request(request) }) })
		try {
			const pools = await loadAllSecurityPools(client)
			expect(pools.some(pool => pool.universeId === 0n && pool.universeHasForked)).toBe(true)
			expect(pools.some(pool => pool.universeId !== 0n)).toBe(true)
			const parent = pools.find(pool => pool.universeId === 0n)
			const [owner] = await engine.getAccounts()
			if (parent === undefined || owner === undefined) throw new Error('Missing parent market or wallet')
			const details = await loadTradingDetails(client, parent.securityPoolAddress, owner)
			expect(details.shareBalances?.yesAttoShares).toBeGreaterThan(0n)
		} finally {
			resetActiveEnvironmentForTesting()
		}
	},
	simulationSetupTimeoutMs,
)
