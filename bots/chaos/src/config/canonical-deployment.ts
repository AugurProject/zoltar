import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import type { DeploymentSettings } from './settings.ts'
import { tradingRootDeploymentPlans } from '../operations/trading.ts'

export function canonicalDeployment(chainId: number): DeploymentSettings {
	const core = canonicalCoreDeployment(chainId === 1 ? mainnet : sepolia)
	const trading = tradingRootDeploymentPlans(core.securityPoolFactory)
	return {
		openOracle: core.openOracle,
		questionData: core.questionData,
		securityPoolFactory: core.securityPoolFactory,
		securityPoolForker: core.securityPoolForker,
		tradingFactory: trading.factoryAddress,
		tradingRouter: trading.routerAddress,
		uniswapV3Factory: canonicalUniswapDeployment(chainId).factory,
		weth: core.weth,
		zoltar: core.zoltar,
	}
}
