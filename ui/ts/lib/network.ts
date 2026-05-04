import { DEFAULT_NETWORK_KEY, getNetworkConfig, type SupportedNetworkKey } from '../shared/networkConfig.js'

export function doesWalletMatchActiveNetwork(walletChainId: string | undefined, activeNetworkKey: SupportedNetworkKey) {
	const activeNetwork = getNetworkConfig(activeNetworkKey)
	return walletChainId === activeNetwork.chainIdHex
}

export function getActiveNetworkLabel(activeNetworkKey: SupportedNetworkKey = DEFAULT_NETWORK_KEY) {
	return getNetworkConfig(activeNetworkKey).label
}
