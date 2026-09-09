import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import { discoverLiveUniverseMarketPage } from '../protocol/live.js'
import type { BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { reportBootstrapProgress, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../protocol/deployment.js'
import { FUNDED_TRADING_SIMULATION_SCENARIO, TRADING_SIMULATION_SCENARIO } from './index.js'

export async function applyTradingScenario(parameters: BootstrapScenarioApplyParameters): Promise<boolean> {
	if (parameters.scenario !== TRADING_SIMULATION_SCENARIO && parameters.scenario !== FUNDED_TRADING_SIMULATION_SCENARIO) return false
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
	if (parameters.scenario === FUNDED_TRADING_SIMULATION_SCENARIO) {
		await reportBootstrapProgress(parameters.onProgress, 'Funding Trading liquidity and wallet shares', 0.99)
		const configuration = deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
		const { markets } = await discoverLiveUniverseMarketPage(readClient, configuration, 0n)
		const market = markets[0]
		if (market === undefined || market.loadError !== undefined) throw new Error('Trading simulation could not discover its seeded SecurityPool')
		const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
		const block = await readClient.getBlock()
		const liquidityHash = await writeClient.writeContract({ abi: router.abi, address: plan.router.address, functionName: 'createPairAndInitializeWithEth', args: [market.pool, 5_000n, 0n, account, block.timestamp + 1_200n], value: 10n ** 16n })
		const liquidityReceipt = await readClient.waitForTransactionReceipt({ hash: liquidityHash })
		if (liquidityReceipt.status !== 'success') throw new Error('Trading simulation liquidity initialization reverted')
		const sharesHash = await writeClient.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: market.pool, functionName: 'createCompleteSet', value: 5n * 10n ** 15n })
		const sharesReceipt = await readClient.waitForTransactionReceipt({ hash: sharesHash })
		if (sharesReceipt.status !== 'success') throw new Error('Trading simulation wallet share funding reverted')
	}
	await reportBootstrapProgress(parameters.onProgress, 'Trading simulation is ready', 0.995)
	return true
}
