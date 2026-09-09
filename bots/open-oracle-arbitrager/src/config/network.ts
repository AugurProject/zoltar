import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalNetworkDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { defineChain, getAddress, type Address, type Chain } from '@zoltar/bot-shared/ethereum'
import type { NetworkName } from '#monitoring/connectivity'

export type NetworkConfiguration = {
	chain: Chain
	explorerUrl: string
	factory: Address
	name: NetworkName
	quoter: Address
	rep: Address
	weth: Address
}

const NETWORK_DEFAULTS = {
	mainnet: {
		chainName: 'Ethereum Mainnet',
		explorerUrl: 'https://etherscan.io',
		factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
		quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
		rpcUrl: 'https://ethereum-rpc.publicnode.com',
	},
	sepolia: {
		chainName: 'Sepolia',
		explorerUrl: 'https://sepolia.etherscan.io',
		factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
		quoter: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
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
	const chain = defineChain({
		id: deployment.chainId,
		name: defaults.chainName,
		nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
		rpcUrls: { default: { http: [defaults.rpcUrl] } },
	})
	return {
		chain,
		explorerUrl: defaults.explorerUrl,
		factory: getAddress(overrides.factory ?? defaults.factory),
		name,
		quoter: getAddress(overrides.quoter ?? defaults.quoter),
		rep: deployment.rep,
		weth: deployment.weth,
	}
}

export function networkDeployment(name: NetworkName) {
	return canonicalNetworkDeployment(name === 'mainnet' ? mainnet : sepolia)
}
