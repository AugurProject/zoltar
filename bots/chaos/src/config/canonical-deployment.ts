import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import type { Address } from '@zoltar/bot-shared/ethereum'
import { MAINNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from '@zoltar/core-shared/deployment/uniswapDeployments'
import type { DeploymentSettings } from './settings.ts'
import { tradingRootDeploymentPlans } from '../operations/trading/roots.ts'

export function canonicalDeployment(chainId: number): DeploymentSettings {
	const core = canonicalCoreDeployment(chainId === MAINNET_CHAIN_ID ? mainnet : sepolia)
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

export function assertSepoliaUniswapFactory(chainId: number, factory: Address) {
	if (chainId !== SEPOLIA_CHAIN_ID) return
	const published = canonicalUniswapDeployment(chainId).factory
	if (factory.toLowerCase() !== published.toLowerCase()) throw new Error(`Sepolia requires the published Uniswap V3 factory ${published}`)
}
