import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalNetworkDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { defineChain, getAddress, type Address, type Chain } from '@zoltar/bot-shared/ethereum'
import type { NetworkName } from '#monitoring/connectivity'

export type NetworkConfiguration = {
	chain: Chain
	explorerUrl: string
	factory: Address
	multicall3: Address
	name: NetworkName
	quoter: Address
	rep: Address
	weth: Address
}

const NETWORK_DEFAULTS = {
	mainnet: {
		chainName: 'Ethereum Mainnet',
		explorerUrl: 'https://etherscan.io',
		rpcUrl: 'https://ethereum-rpc.publicnode.com',
	},
	sepolia: {
		chainName: 'Sepolia',
		explorerUrl: 'https://sepolia.etherscan.io',
		rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
	},
} as const

export function parseNetworkName(value: string | undefined): NetworkName {
	if (value === undefined || value === 'mainnet') return 'mainnet'
	if (value === 'sepolia') return 'sepolia'
	throw new Error('network must be mainnet or sepolia')
}

export function defaultRpcUrl(network: NetworkName) {
	return NETWORK_DEFAULTS[network].rpcUrl
}

export function networkConfiguration(
	name: NetworkName,
	overrides: {
		factory?: string | undefined
		quoter?: string | undefined
	},
): NetworkConfiguration {
	const defaults = NETWORK_DEFAULTS[name]
	const deployment = networkDeployment(name)
	const uniswap = canonicalUniswapDeployment(deployment.chainId)
	const chain = defineChain({
		id: deployment.chainId,
		name: defaults.chainName,
		nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
		rpcUrls: { default: { http: [defaults.rpcUrl] } },
	})
	return {
		chain,
		explorerUrl: defaults.explorerUrl,
		factory: getAddress(overrides.factory ?? uniswap.factory),
		multicall3: canonicalCoreDeployment(name === 'mainnet' ? mainnet : sepolia).multicall3,
		name,
		quoter: getAddress(overrides.quoter ?? uniswap.quoter),
		rep: deployment.rep,
		weth: deployment.weth,
	}
}

export function networkDeployment(name: NetworkName) {
	return canonicalNetworkDeployment(name === 'mainnet' ? mainnet : sepolia)
}

export function canonicalZoltar(name: NetworkName) {
	return canonicalCoreDeployment(name === 'mainnet' ? mainnet : sepolia).zoltar
}
