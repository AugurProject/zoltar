import { defineChain, zeroAddress, type Address } from 'viem'

export type NetworkPoolConfig = {
	fee: number
	tickSpacing: number
	hooks?: Address
}

type NetworkConfigShape = {
	key: string
	label: string
	chainId: number
	chainIdHex: string
	defaultRpcUrl: string
	genesisRepTokenAddress: Address
	repEthV4PoolConfigs: readonly NetworkPoolConfig[]
	repUsdcV4PoolConfigs: readonly NetworkPoolConfig[]
	repV3FallbackFees: readonly number[]
	uniswapPoolExplorerBaseUrl: string | undefined
	uniswapV3FactoryAddress: Address
	uniswapV3QuoterV2Address: Address
	uniswapV4QuoterAddress: Address
	usdcAddress: Address
	wethAddress: Address
}

const DEFAULT_REP_ETH_V4_POOL_CONFIGS = [{ fee: 3000, tickSpacing: 60 }] as const
const DEFAULT_REP_USDC_V4_POOL_CONFIGS = [{ fee: 10001, tickSpacing: 200 }] as const
const DEFAULT_REP_V3_FALLBACK_FEES = [100, 500, 3000, 10000] as const

export const SUPPORTED_NETWORKS = {
	ethereum: {
		key: 'ethereum',
		label: 'Ethereum mainnet',
		chainId: 1,
		chainIdHex: '0x1',
		defaultRpcUrl: 'https://ethereum.dark.florist',
		genesisRepTokenAddress: '0x221657776846890989a759BA2973e427DfF5C9bB',
		wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
		usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		uniswapV3FactoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
		uniswapV3QuoterV2Address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
		uniswapV4QuoterAddress: '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203',
		uniswapPoolExplorerBaseUrl: 'https://app.uniswap.org/explore/pools/ethereum',
		repEthV4PoolConfigs: DEFAULT_REP_ETH_V4_POOL_CONFIGS,
		repUsdcV4PoolConfigs: DEFAULT_REP_USDC_V4_POOL_CONFIGS,
		repV3FallbackFees: DEFAULT_REP_V3_FALLBACK_FEES,
	},
	sepolia: {
		key: 'sepolia',
		label: 'Sepolia',
		chainId: 11155111,
		chainIdHex: '0xaa36a7',
		defaultRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
		genesisRepTokenAddress: zeroAddress,
		wethAddress: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
		usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
		uniswapV3FactoryAddress: '0x0227628f3F023bb0B980b67D528571c95c6DaC1c',
		uniswapV3QuoterV2Address: '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
		uniswapV4QuoterAddress: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227',
		uniswapPoolExplorerBaseUrl: undefined,
		repEthV4PoolConfigs: DEFAULT_REP_ETH_V4_POOL_CONFIGS,
		repUsdcV4PoolConfigs: DEFAULT_REP_USDC_V4_POOL_CONFIGS,
		repV3FallbackFees: DEFAULT_REP_V3_FALLBACK_FEES,
	},
} as const satisfies Record<string, NetworkConfigShape>

export type SupportedNetworkKey = keyof typeof SUPPORTED_NETWORKS
export type SupportedNetworkConfig = (typeof SUPPORTED_NETWORKS)[SupportedNetworkKey]
export const DEFAULT_NETWORK_KEY: SupportedNetworkKey = 'ethereum'

export function getNetworkConfig(key: SupportedNetworkKey) {
	return SUPPORTED_NETWORKS[key]
}

export function getSupportedNetworkConfigs() {
	const networkConfigs: SupportedNetworkConfig[] = []
	for (const networkKey in SUPPORTED_NETWORKS) {
		networkConfigs.push(SUPPORTED_NETWORKS[networkKey as SupportedNetworkKey])
	}
	return networkConfigs
}

export function getSupportedNetworkKeys() {
	return getSupportedNetworkConfigs().map(networkConfig => networkConfig.key)
}

export function getNetworkConfigByChainId(chainIdHex: string | undefined) {
	if (chainIdHex === undefined) return undefined

	for (const networkConfig of getSupportedNetworkConfigs()) {
		if (networkConfig.chainIdHex === chainIdHex) {
			return networkConfig
		}
	}

	return undefined
}

export function isSupportedNetworkKey(value: string): value is SupportedNetworkKey {
	return Object.hasOwn(SUPPORTED_NETWORKS, value)
}

export function isMainnetNetworkKey(networkKey: SupportedNetworkKey) {
	return getNetworkConfig(networkKey).chainId === 1
}

export function createViemChain(networkKey: SupportedNetworkKey) {
	const networkConfig = getNetworkConfig(networkKey)
	return defineChain({
		id: networkConfig.chainId,
		name: networkConfig.label,
		network: networkConfig.key,
		nativeCurrency: {
			decimals: 18,
			name: 'Ether',
			symbol: 'ETH',
		},
		rpcUrls: {
			default: {
				http: [networkConfig.defaultRpcUrl],
			},
		},
	})
}
