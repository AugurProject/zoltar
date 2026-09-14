import { mainnetDisabled } from '../copy/app.js'
import { sameChainId } from './chainId.js'

// Set to true and rebuild the UIs to restore mainnet availability.
export const MAINNET_ENABLED: boolean = false

// Choose the startup network. A disabled mainnet always falls back to Sepolia.
export const DEFAULT_NETWORK: 'mainnet' | 'sepolia' = 'sepolia'

export function isMainnetDisabled(chainId: string | undefined) {
	return !MAINNET_ENABLED && sameChainId(chainId, '0x1')
}

export function assertNetworkEnabled(chainId: string | undefined) {
	if (isMainnetDisabled(chainId)) throw new Error(mainnetDisabled)
}
