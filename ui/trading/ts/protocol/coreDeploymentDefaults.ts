import { getChainDefaultRpcUrl } from '@zoltar/ui-core-shared/wallet/rpcConfig.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export const defaultCoreDeploymentRpcUrls: Readonly<Record<number, string>> = {
	[MAINNET_NETWORK_PROFILE.chain.id]: getChainDefaultRpcUrl(MAINNET_NETWORK_PROFILE.chain),
	[SEPOLIA_NETWORK_PROFILE.chain.id]: getChainDefaultRpcUrl(SEPOLIA_NETWORK_PROFILE.chain),
}
