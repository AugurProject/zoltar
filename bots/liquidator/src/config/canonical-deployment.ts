import { parseCentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalNetworkDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { presetNetworkChainId, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { MAINNET_CHAIN_ID } from '@zoltar/core-shared/deployment/uniswapDeployments'
import { mainnet as mainnetChain, sepolia as sepoliaChain } from '@zoltar/core-shared/evm/ethereum'

export function canonicalDeployment(chainId: number) {
	const core = canonicalCoreDeployment(chainId === MAINNET_CHAIN_ID ? mainnet : sepolia)
	return { multicall3: core.multicall3, securityPoolFactory: core.securityPoolFactory, weth: core.weth, zoltar: core.zoltar }
}

export function parseRootMarketSettings(value: unknown, chainId: number) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Root market settings must be a JSON object')
	return parseCentralizedMarketSettings({ ...value, ...canonicalRootMarketIdentity(chainId) })
}

export function canonicalRootMarketIdentity(chainId: number) {
	const identity = canonicalNetworkDeployment(chainId === MAINNET_CHAIN_ID ? mainnet : sepolia)
	return { assetAddress: identity.rep, assetChainId: identity.chainId }
}

/** Chain identity and block explorer of a preset network profile. */
export function presetNetwork(name: NetworkName) {
	return { chainId: presetNetworkChainId(name), explorerUrl: (name === 'mainnet' ? mainnetChain : sepoliaChain).blockExplorers.default.url, name }
}
