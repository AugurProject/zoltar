import { seedPortfolioScenario } from './portfolioScenario.js'
import { seedPortfolioAuctionScenario } from './portfolioAuctionScenario.js'
import { deploySimulationAppContracts, requireQaAccount, type BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { getStatoblastScenarioProtocol } from './statoblastScenarioProtocol.js'
import { STATOBLAST_SCENARIOS } from './statoblastScenarioDescriptions.js'

export async function applyStatoblastScenario({ scenario, ...parameters }: BootstrapScenarioApplyParameters): Promise<boolean> {
	if (!STATOBLAST_SCENARIOS.some(candidate => candidate === scenario)) return false
	const owner = requireQaAccount(parameters.accounts[0], 'Expected simulation portfolio owner')
	await deploySimulationAppContracts(parameters.createWriteClient(owner), parameters.memoryClient, parameters.onProgress, parameters.profile, { start: 0.32, end: 0.7 }, getStatoblastScenarioProtocol().getDeploymentSteps)
	if (scenario === 'portfolio-auction') await seedPortfolioAuctionScenario(parameters)
	else await seedPortfolioScenario(parameters, scenario === 'security-pool' ? 1 : 2)
	return true
}
