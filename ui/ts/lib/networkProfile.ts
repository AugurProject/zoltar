import { defineChain, type Address, type Hash } from 'viem'
import { mainnet, type Chain } from 'viem/chains'

export type NetworkProfile = {
	chain: Chain
	chainIdHex: string
	displayName: string
	genesisRepTokenAddress: Address
	id: 'mainnet' | 'simulation'
	isSupportedAppChain: boolean
	repPricingMode: 'uniswap' | 'mock'
	transactionExplorerBaseUrl?: string
	wethAddress: Address
}

export const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address

const simulationChain = defineChain({
	id: 1337,
	name: 'Browser Simulation',
	nativeCurrency: {
		decimals: 18,
		name: 'Ether',
		symbol: 'ETH',
	},
	rpcUrls: {
		default: {
			http: ['http://127.0.0.1'],
		},
	},
})

export const MAINNET_NETWORK_PROFILE: NetworkProfile = {
	chain: mainnet,
	chainIdHex: '0x1',
	displayName: 'Ethereum Mainnet',
	genesisRepTokenAddress: '0x221657776846890989a759ba2973e427dff5c9bb',
	id: 'mainnet',
	isSupportedAppChain: true,
	repPricingMode: 'uniswap',
	transactionExplorerBaseUrl: 'https://etherscan.io/tx/',
	wethAddress: MAINNET_WETH_ADDRESS,
}

export function createSimulationProfile({ genesisRepTokenAddress, wethAddress }: { genesisRepTokenAddress: Address; wethAddress: Address }): NetworkProfile {
	return {
		chain: simulationChain,
		chainIdHex: '0x539',
		displayName: 'Browser Simulation',
		genesisRepTokenAddress,
		id: 'simulation',
		isSupportedAppChain: true,
		repPricingMode: 'mock',
		wethAddress,
	}
}

export function buildTransactionExplorerUrl(profile: NetworkProfile, hash: Hash) {
	if (profile.transactionExplorerBaseUrl === undefined) return undefined
	return `${profile.transactionExplorerBaseUrl}${hash}`
}
