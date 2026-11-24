import type { CollateralSymbol } from '../protocol/collateral.js'
import { seedSecurityPoolScenario } from './securityPoolScenario.js'
import { seedSecurityPoolAuctionScenario } from './securityPoolAuctionScenario.js'
import { deploySimulationAppContracts, requireQaAccount, type BootstrapScenarioApplyParameters } from '@zoltar/ui-core-shared/simulation/bootstrap.js'
import { getStatoblastScenarioProtocol } from './statoblastScenarioProtocol.js'
import { STATOBLAST_SCENARIOS } from './statoblastScenarioDescriptions.js'

export async function applyStatoblastScenario({ scenario, ...parameters }: BootstrapScenarioApplyParameters, collateralSymbol: CollateralSymbol = 'WETH'): Promise<boolean> {
	if (!STATOBLAST_SCENARIOS.some(candidate => candidate === scenario)) return false
	const owner = requireQaAccount(parameters.accounts[0], 'Expected simulation security pool owner')
	await deploySimulationAppContracts(parameters.createWriteClient(owner), parameters.memoryClient, parameters.onProgress, parameters.profile, { start: 0.32, end: 0.7 }, getStatoblastScenarioProtocol().getDeploymentSteps)
	const seeded = scenario === 'portfolio-auction' ? await seedSecurityPoolAuctionScenario(parameters) : await seedSecurityPoolScenario(parameters, scenario === 'security-pool' ? 1 : 2, collateralSymbol)
	parameters.onSeededSecurityPool?.({ address: seeded.securityPool, questionIds: seeded.questionIds })
	return true
}
