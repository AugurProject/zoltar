import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { DeploymentSettings } from './settings.ts'
import { tradingRootDeploymentPlans } from '../operations/trading.ts'

export function canonicalDeployment(chainId: number): DeploymentSettings {
	const core = canonicalCoreDeployment(chainId === 1 ? mainnet : sepolia)
	const trading = tradingRootDeploymentPlans(core.securityPoolFactory)
	return { ...core, uniswapV3Factory: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'), tradingFactory: trading.factoryAddress, tradingRouter: trading.routerAddress }
}
