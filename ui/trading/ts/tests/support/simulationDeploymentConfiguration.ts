import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import type { SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'

/** The 30-basis-point Trading deployment on a bootstrapped simulation backend's infrastructure, for a YES genesis universe. */
export function simulationDeploymentConfiguration(backend: SimulationBackend) {
	const addresses = getInfraContractAddresses(backend.profile)
	const plan = getTradingDeploymentPlan(
		{
			genesisOutcome: 'yes',
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
	return deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
}
