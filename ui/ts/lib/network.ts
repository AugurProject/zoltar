export const MAINNET_CHAIN_ID = '0x1'

export function isMainnetChain(chainId: string | undefined) {
	return chainId === MAINNET_CHAIN_ID
}
