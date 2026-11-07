import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import { discoverLiveUniverseMarketPage } from '../protocol/live.js'
import type { BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { reportBootstrapProgress, requireQaAccount } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { applyStatoblastScenario } from '@zoltar/ui-statoblast-shared/simulation/statoblastScenarios.js'
import { forkSeededPortfolio } from '@zoltar/ui-statoblast-shared/simulation/portfolioScenarioFork.js'
import { prepareSeededPortfolioMint } from '@zoltar/ui-statoblast-shared/simulation/portfolioScenarioMint.js'
import { portfolioReadClient, sendPortfolioTransaction } from '@zoltar/ui-statoblast-shared/protocol/securityPoolPortfolio.js'
import { loadBudgetMint } from '../protocol/minting.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../protocol/deployment.js'
import { DEPLOYED_TRADING_SIMULATION_SCENARIO, FORKED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO } from './index.js'

const TRADING_SIMULATION_SCENARIOS: readonly string[] = [DEPLOYED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO, FORKED_TRADING_SIMULATION_SCENARIO]

export async function applyTradingScenario(parameters: BootstrapScenarioApplyParameters): Promise<boolean> {
	if (!TRADING_SIMULATION_SCENARIOS.includes(parameters.scenario)) return false
	const seeded = await applyStatoblastScenario({ ...parameters, scenario: 'security-pool' })
	if (!seeded) throw new Error('Trading simulation could not seed its Statoblast security pool')

	const account = requireQaAccount(parameters.accounts[0], 'Expected a Trading simulation QA account')
	const addresses = getInfraContractAddresses(parameters.profile)
	const plan = getTradingDeploymentPlan(
		{
			genesisOutcome: parameters.profile.genesisOutcome,
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
	await reportBootstrapProgress(parameters.onProgress, 'Deploying trading factory', 0.96)
	await deployTradingStep(writeClient, readClient, plan, plan.factory)
	await reportBootstrapProgress(parameters.onProgress, 'Deploying trading router', 0.98)
	await deployTradingStep(writeClient, readClient, plan, plan.router)
	if (parameters.scenario !== DEPLOYED_TRADING_SIMULATION_SCENARIO) {
		await reportBootstrapProgress(parameters.onProgress, 'Funding Trading liquidity and wallet shares', 0.984)
		const configuration = deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
		const { markets } = await discoverLiveUniverseMarketPage(readClient, configuration, 0n)
		const market = markets[0]
		if (market === undefined || market.loadError !== undefined) throw new Error('Trading simulation could not discover its seeded SecurityPool')
		const router = tradingContracts['contracts/trading/TwoWayConstantProductRouter.sol'].TwoWayConstantProductRouter
		const block = await readClient.getBlock()
		if (block.number === undefined) throw new Error('Trading seed requires a mined block')
		const mintAttoEth = await loadBudgetMint(readClient, market, 10n ** 16n, block.number)
		const liquidityHash = await writeClient.writeContract({ abi: router.abi, address: plan.router.address, functionName: 'createPairAndInitializeWithEth', args: [market.pool, mintAttoEth, 5_000n, 0n, account, block.timestamp + 1_200n], value: 10n ** 16n })
		const liquidityReceipt = await readClient.waitForTransactionReceipt({ hash: liquidityHash })
		if (liquidityReceipt.status !== 'success') throw new Error('Trading simulation liquidity initialization reverted')
		const portfolio = await readClient.readContract({ abi: factoryArtifact.abi, address: addresses.securityPoolFactory, functionName: 'getSecurityPoolPortfolio', args: [market.pool] })
		await sendPortfolioTransaction(writeClient, await prepareSeededPortfolioMint(portfolioReadClient(readClient), account, portfolio, market.questionId, 5n * 10n ** 15n, 100n), 'Fund trading wallet shares')
		if (parameters.scenario === FORKED_TRADING_SIMULATION_SCENARIO) await forkSeededPortfolio(parameters, portfolio, market.pool, market.questionId)
	}
	await reportBootstrapProgress(parameters.onProgress, 'Trading simulation is ready', 0.995)
	return true
}
