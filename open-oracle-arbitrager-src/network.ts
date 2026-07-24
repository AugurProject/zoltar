import { defineChain, getAddress, type Address, type Chain } from '@zoltar/shared/ethereum'
import type { NetworkName } from './connectivity.js'

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
		chainId: 1,
		chainName: 'Ethereum Mainnet',
		explorerUrl: 'https://etherscan.io',
		factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
		quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
		rep: '0x221657776846890989a759BA2973e427DfF5C9bB',
		rpcUrl: 'https://ethereum-rpc.publicnode.com',
		weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
	},
	sepolia: {
		chainId: 11_155_111,
		chainName: 'Sepolia',
		explorerUrl: 'https://sepolia.etherscan.io',
		factory: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
		quoter: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
		rep: undefined,
		rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
		weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
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
		rep?: string | undefined
		weth?: string | undefined
	},
): NetworkConfiguration {
	const defaults = NETWORK_DEFAULTS[name]
	const rep = overrides.rep ?? defaults.rep
	if (rep === undefined) throw new Error('Sepolia requires --rep-address=0x... (or REP_ADDRESS)')
	const chain = defineChain({
		id: defaults.chainId,
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
		rep: getAddress(rep),
		weth: getAddress(overrides.weth ?? defaults.weth),
	}
}
