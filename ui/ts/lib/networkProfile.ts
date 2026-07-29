import { defineChain, type Address, type Hash } from '@zoltar/shared/ethereum'
import { mainnet, type Chain } from '@zoltar/shared/ethereum'
import { MAINNET_PROTOCOL_TOKEN_ADDRESSES, SEPOLIA_PROTOCOL_TOKEN_ADDRESSES } from '../protocol/deploymentHelpers.js'

export type NetworkProfile = {
	chain: Chain
	chainIdHex: string
	displayName: string
	genesisRepTokenAddress: Address
	id: 'mainnet' | 'sepolia' | 'simulation'
	isSupportedAppChain: boolean
	repPricingMode: 'mock' | 'unavailable' | 'uniswap'
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

const sepoliaChain = defineChain({
	id: 11155111,
	name: 'Sepolia',
	nativeCurrency: {
		decimals: 18,
		name: 'Sepolia Ether',
		symbol: 'ETH',
	},
	rpcUrls: {
		default: {
			http: ['https://ethereum-sepolia-rpc.publicnode.com'],
		},
	},
})

export const MAINNET_NETWORK_PROFILE: NetworkProfile = {
	chain: mainnet,
	chainIdHex: '0x1',
	displayName: 'Ethereum Mainnet',
	genesisRepTokenAddress: MAINNET_PROTOCOL_TOKEN_ADDRESSES.genesisRepTokenAddress,
	id: 'mainnet',
	isSupportedAppChain: true,
	repPricingMode: 'uniswap',
	transactionExplorerBaseUrl: 'https://etherscan.io/tx/',
	wethAddress: MAINNET_PROTOCOL_TOKEN_ADDRESSES.wethAddress,
}

export const SEPOLIA_NETWORK_PROFILE: NetworkProfile = {
	chain: sepoliaChain,
	chainIdHex: '0xaa36a7',
	displayName: 'Sepolia',
	genesisRepTokenAddress: SEPOLIA_PROTOCOL_TOKEN_ADDRESSES.genesisRepTokenAddress,
	id: 'sepolia',
	isSupportedAppChain: true,
	repPricingMode: 'unavailable',
	transactionExplorerBaseUrl: 'https://sepolia.etherscan.io/tx/',
	wethAddress: SEPOLIA_PROTOCOL_TOKEN_ADDRESSES.wethAddress,
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

export function formatTransactionNetworkLabel(profile: NetworkProfile) {
	return profile.id === 'simulation' ? `${profile.displayName} · local sandbox` : profile.displayName
}
