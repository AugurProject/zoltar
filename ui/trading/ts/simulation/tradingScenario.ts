import type { BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { reportBootstrapProgress, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast/simulation/statoblastScenarios.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-zoltar/protocol/deploymentHelpers.js'
import { deployTradingStep, getTradingDeploymentPlan } from '../protocol/deployment.js'
import { TRADING_SIMULATION_SCENARIO } from './index.js'

export async function applyTradingScenario(parameters: BootstrapScenarioApplyParameters): Promise<boolean> {
	if (parameters.scenario !== TRADING_SIMULATION_SCENARIO) return false
	const seeded = await applyStatoblastScenario({ ...parameters, scenario: 'security-pool' })
	if (!seeded) throw new Error('Trading simulation could not seed its Statoblast security pool')

	const account = requireQaAccount(parameters.accounts[0], 'Expected a Trading simulation QA account')
	const addresses = getInfraContractAddresses(parameters.profile)
	const plan = getTradingDeploymentPlan(
		{
			chainId: parameters.profile.chain.id,
			chainName: parameters.profile.displayName,
			defaultRpcUrl: 'http://127.0.0.1/',
			id: 'simulation',
			proxyDeployer: PROXY_DEPLOYER_ADDRESS,
			securityPoolFactory: addresses.securityPoolFactory,
			zoltar: addresses.zoltar,
		},
		30,
	)
	const readClient = parameters.createReadClient()
	const writeClient = parameters.createWriteClient(account)
	await reportBootstrapProgress(parameters.onProgress, 'Deploying Trading factory', 0.96)
	await deployTradingStep(writeClient, readClient, plan, plan.factory)
	await reportBootstrapProgress(parameters.onProgress, 'Deploying Trading router', 0.98)
	await deployTradingStep(writeClient, readClient, plan, plan.router)
	await reportBootstrapProgress(parameters.onProgress, 'Trading simulation is ready', 0.995)
	return true
}
