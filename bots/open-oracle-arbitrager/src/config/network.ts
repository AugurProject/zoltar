import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { canonicalCoreDeployment, canonicalNetworkDeployment, canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import { defineChain, type Address, type Chain } from '@zoltar/bot-shared/ethereum'
import { mainnet as mainnetChain, sepolia as sepoliaChain } from '@zoltar/core-shared/evm/ethereum'
import type { NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'

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

function networkDefaults(chain: typeof mainnetChain | typeof sepoliaChain) {
	const [rpcUrl] = chain.rpcUrls.default.http
	if (rpcUrl === undefined) throw new Error(`The shared ${chain.name} chain has no default RPC URL`)
	return { chainName: chain.name, explorerUrl: chain.blockExplorers.default.url, rpcUrl }
}

// Chain names, default RPC endpoints, and block explorers come from the shared chain definitions.
const NETWORK_DEFAULTS = {
	mainnet: networkDefaults(mainnetChain),
	sepolia: networkDefaults(sepoliaChain),
}

export function parseNetworkName(value: string | undefined): NetworkName {
	if (value === undefined || value === 'mainnet') return 'mainnet'
	if (value === 'sepolia') return 'sepolia'
	throw new Error('network must be mainnet or sepolia')
}

export function defaultRpcUrl(network: NetworkName) {
	return NETWORK_DEFAULTS[network].rpcUrl
}

export function networkConfiguration(name: NetworkName): NetworkConfiguration {
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
		factory: uniswap.factory,
		multicall3: canonicalCoreDeployment(name === 'mainnet' ? mainnet : sepolia).multicall3,
		name,
		quoter: uniswap.quoter,
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

export function canonicalSecurityPoolFactory(name: NetworkName) {
	return canonicalCoreDeployment(name === 'mainnet' ? mainnet : sepolia).securityPoolFactory
}
