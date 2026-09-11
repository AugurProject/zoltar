// Flashbots exposes its private-transaction compatibility profile only on the official relay per chain.
const FLASHBOTS_MAINNET_RELAY_ORIGIN = 'https://relay.flashbots.net'
const FLASHBOTS_SEPOLIA_RELAY_ORIGIN = 'https://relay-sepolia.flashbots.net'
export function flashbotsPrivateTransactionCompatibilityProfileAllowed(url: string, expectedChainId: number) {
	const parsed = new URL(url)
	const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
	let officialOrigin: string | undefined
	if (expectedChainId === 1) officialOrigin = FLASHBOTS_MAINNET_RELAY_ORIGIN
	else if (expectedChainId === 11_155_111) officialOrigin = FLASHBOTS_SEPOLIA_RELAY_ORIGIN
	return loopback || parsed.origin === officialOrigin
}
