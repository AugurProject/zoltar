import { defineChain, type Address, type Hash } from '@zoltar/shared/ethereum'
import { mainnet, type Chain } from '@zoltar/shared/ethereum'
import { SEPOLIA_GENESIS_REP_ADDRESS, SEPOLIA_WETH_ADDRESS } from './sepoliaDeploymentConfig.js'

export type NetworkProfile = {
	chain: Chain
	chainIdHex: string
	displayName: string
	genesisRepTokenAddress: Address
	id: 'mainnet' | 'sepolia' | 'simulation'
	isSupportedAppChain: boolean
	repPricingMode: 'unavailable' | 'uniswap' | 'mock'
	transactionExplorerBaseUrl?: string
	wethAddress: Address
}

export const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address

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

export const SEPOLIA_NETWORK_PROFILE: NetworkProfile = {
	chain: sepoliaChain,
	chainIdHex: '0xaa36a7',
	displayName: 'Sepolia',
	genesisRepTokenAddress: SEPOLIA_GENESIS_REP_ADDRESS,
	id: 'sepolia',
	isSupportedAppChain: true,
	repPricingMode: 'unavailable',
	transactionExplorerBaseUrl: 'https://sepolia.etherscan.io/tx/',
	wethAddress: SEPOLIA_WETH_ADDRESS,
}

export function getPublicNetworkProfile(network: string | undefined) {
	return network?.toLowerCase() === 'sepolia' ? SEPOLIA_NETWORK_PROFILE : MAINNET_NETWORK_PROFILE
}

export function getNetworkSwitchTarget(profile: NetworkProfile) {
	return profile.id === 'mainnet' ? 'Ethereum mainnet' : profile.displayName
}

let runtimeNetworkProfile: NetworkProfile = MAINNET_NETWORK_PROFILE

export function getRuntimeNetworkProfile() {
	return runtimeNetworkProfile
}

export function setRuntimeNetworkProfile(profile: NetworkProfile) {
	runtimeNetworkProfile = profile
}

export function resetRuntimeNetworkProfile() {
	runtimeNetworkProfile = MAINNET_NETWORK_PROFILE
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
