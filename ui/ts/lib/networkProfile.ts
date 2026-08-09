import { defineChain, getAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
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
	uniswapPoolExplorerBaseUrl: string
	uniswapV3FactoryAddress: Address
	uniswapV3QuoterAddress: Address
	uniswapV4QuoterAddress: Address
	usdcAddress: Address
	wethAddress: Address
}

export const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address
const MAINNET_USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' satisfies Address
const MAINNET_UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984' satisfies Address
const MAINNET_UNISWAP_V3_QUOTER_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' satisfies Address
const MAINNET_UNISWAP_V4_QUOTER_ADDRESS = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203' satisfies Address

const SEPOLIA_USDC_ADDRESS = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
const SEPOLIA_UNISWAP_V3_FACTORY_ADDRESS = getAddress('0x0227628f3F023bb0B980b67D528571c95c6DaC1c')
const SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS = getAddress('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3')
const SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS = getAddress('0x61b3f2011a92d183c7dbadbda940a7555ccf9227')

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
	uniswapPoolExplorerBaseUrl: 'https://app.uniswap.org/explore/pools/ethereum',
	uniswapV3FactoryAddress: MAINNET_UNISWAP_V3_FACTORY_ADDRESS,
	uniswapV3QuoterAddress: MAINNET_UNISWAP_V3_QUOTER_ADDRESS,
	uniswapV4QuoterAddress: MAINNET_UNISWAP_V4_QUOTER_ADDRESS,
	usdcAddress: MAINNET_USDC_ADDRESS,
	wethAddress: MAINNET_WETH_ADDRESS,
}

export const SEPOLIA_NETWORK_PROFILE: NetworkProfile = {
	chain: sepoliaChain,
	chainIdHex: '0xaa36a7',
	displayName: 'Sepolia',
	genesisRepTokenAddress: SEPOLIA_GENESIS_REP_ADDRESS,
	id: 'sepolia',
	isSupportedAppChain: true,
	repPricingMode: 'uniswap',
	transactionExplorerBaseUrl: 'https://sepolia.etherscan.io/tx/',
	uniswapPoolExplorerBaseUrl: 'https://app.uniswap.org/explore/pools/ethereum_sepolia',
	uniswapV3FactoryAddress: SEPOLIA_UNISWAP_V3_FACTORY_ADDRESS,
	uniswapV3QuoterAddress: SEPOLIA_UNISWAP_V3_QUOTER_ADDRESS,
	uniswapV4QuoterAddress: SEPOLIA_UNISWAP_V4_QUOTER_ADDRESS,
	usdcAddress: SEPOLIA_USDC_ADDRESS,
	wethAddress: SEPOLIA_WETH_ADDRESS,
}

export function getPublicNetworkProfile(network: string | undefined) {
	const normalizedNetwork = network?.trim().toLowerCase()
	if (normalizedNetwork === undefined || normalizedNetwork === '' || normalizedNetwork === 'mainnet') return MAINNET_NETWORK_PROFILE
	if (normalizedNetwork === 'sepolia') return SEPOLIA_NETWORK_PROFILE
	throw new RangeError(`Unsupported network "${network}". Use "mainnet" or "sepolia".`)
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
		uniswapPoolExplorerBaseUrl: MAINNET_NETWORK_PROFILE.uniswapPoolExplorerBaseUrl,
		uniswapV3FactoryAddress: MAINNET_NETWORK_PROFILE.uniswapV3FactoryAddress,
		uniswapV3QuoterAddress: MAINNET_NETWORK_PROFILE.uniswapV3QuoterAddress,
		uniswapV4QuoterAddress: MAINNET_NETWORK_PROFILE.uniswapV4QuoterAddress,
		usdcAddress: MAINNET_NETWORK_PROFILE.usdcAddress,
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
