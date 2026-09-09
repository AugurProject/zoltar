import { parseCentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalNetworkDeployment } from '@zoltar/bot-shared/config/canonical-deployment'

export function canonicalDeployment(chainId: number) {
	const core = canonicalCoreDeployment(chainId === 1 ? mainnet : sepolia)
	return { securityPoolFactory: core.securityPoolFactory, weth: core.weth, zoltar: core.zoltar }
}

export function parseRootMarketSettings(value: unknown, chainId: number) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Root market settings must be a JSON object')
	return parseCentralizedMarketSettings({ ...value, ...canonicalRootMarketIdentity(chainId) })
}

export function canonicalRootMarketIdentity(chainId: number) {
	const identity = canonicalNetworkDeployment(chainId === 1 ? mainnet : sepolia)
	return { assetAddress: identity.rep, assetChainId: identity.chainId }
}
