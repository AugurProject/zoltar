import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment } from '@zoltar/bot-shared/config/canonical-deployment'

export function canonicalDeployment(chainId: number) {
	const core = canonicalCoreDeployment(chainId === 1 ? mainnet : sepolia)
	return { securityPoolFactory: core.securityPoolFactory, weth: core.weth, zoltar: core.zoltar }
}
