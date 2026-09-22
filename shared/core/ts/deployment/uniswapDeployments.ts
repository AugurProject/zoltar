import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'

type UniswapNetworkAddresses = {
	uniswapV3FactoryAddress: Address
	uniswapV3QuoterAddress: Address
	uniswapV3SwapRouterAddress: Address
	uniswapV4PoolManagerAddress: Address
	uniswapV4QuoterAddress: Address
	wethAddress: Address
}

/**
 * `published`: Uniswap's own deployment on that chain; the testnet deployer verifies it and never deploys it.
 * `deterministic`: no Uniswap deployment exists, so the testnet deployer installs the vendored Uniswap
 * bytecode and WETH9 through the canonical proxy deployer at these CREATE2 addresses.
 */
export type UniswapNetworkDeployment = UniswapNetworkAddresses & {
	kind: 'published' | 'deterministic'
	uniswapV2RouterAddress: Address | undefined
}

export const MAINNET_CHAIN_ID = 1
export const SEPOLIA_CHAIN_ID = 11_155_111

// https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments
// https://developers.uniswap.org/docs/protocols/v4/deployments
const MAINNET_UNISWAP_DEPLOYMENT: UniswapNetworkDeployment = {
	kind: 'published',
	uniswapV2RouterAddress: getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'),
	uniswapV3FactoryAddress: getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984'),
	uniswapV3QuoterAddress: getAddress('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
	uniswapV3SwapRouterAddress: getAddress('0xE592427A0AEce92De3Edee1F18E0157C05861564'),
	uniswapV4PoolManagerAddress: getAddress('0x000000000004444c5dc75cB358380D2e3dE08A90'),
	uniswapV4QuoterAddress: getAddress('0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'),
	wethAddress: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
}

// Uniswap publishes no SwapRouter (v1) on Sepolia; the testnet deployer installs a deterministic
// SwapRouter bound to the published factory and WETH for the arbitrage executor.
const SEPOLIA_UNISWAP_DEPLOYMENT: UniswapNetworkDeployment = {
	kind: 'published',
	uniswapV2RouterAddress: undefined,
	uniswapV3FactoryAddress: getAddress('0x0227628f3F023bb0B980b67D528571c95c6DaC1c'),
	uniswapV3QuoterAddress: getAddress('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'),
	uniswapV3SwapRouterAddress: getAddress('0xa277024D80f829d58471239f4359933Dd6f18155'),
	uniswapV4PoolManagerAddress: getAddress('0xE03A1074c86CFeDd5C142C4F04F1a1536e203543'),
	uniswapV4QuoterAddress: getAddress('0x61b3f2011a92d183c7dbadbda940a7555ccf9227'),
	wethAddress: getAddress('0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'),
}

// CREATE2 addresses of the vendored Uniswap bytecode and WETH9 through the canonical proxy deployer.
// tooling/contracts/uniswap-deployment.test.ts derives these from the pinned artifact.
const DETERMINISTIC_UNISWAP_DEPLOYMENT: UniswapNetworkDeployment = {
	kind: 'deterministic',
	uniswapV2RouterAddress: undefined,
	uniswapV3FactoryAddress: getAddress('0xEf09Be426F8d6D2786cADEA7D3A8b0D09cEB79B4'),
	uniswapV3QuoterAddress: getAddress('0x6Aa53e5023fFDa81f7EEE31bdA5D35437A5DD841'),
	uniswapV3SwapRouterAddress: getAddress('0xC0a0e58Ae39603398D474BFd49d2904dE1464C99'),
	uniswapV4PoolManagerAddress: getAddress('0x9C27Fce9ad85dE98C7e95031Bf3F0B3D2CD677ad'),
	uniswapV4QuoterAddress: getAddress('0x29322b72F451C5f4eba5b3C862C76896470c059A'),
	wethAddress: getAddress('0x65156FD21726b8efcB627fa38c506E3f3542F601'),
}

const PUBLISHED_UNISWAP_DEPLOYMENTS: ReadonlyMap<number, UniswapNetworkDeployment> = new Map([
	[MAINNET_CHAIN_ID, MAINNET_UNISWAP_DEPLOYMENT],
	[SEPOLIA_CHAIN_ID, SEPOLIA_UNISWAP_DEPLOYMENT],
])

/** Resolves the Uniswap deployment every UI, bot, and deployer uses on a chain. */
export function getUniswapNetworkDeployment(chainId: number): UniswapNetworkDeployment {
	return PUBLISHED_UNISWAP_DEPLOYMENTS.get(chainId) ?? DETERMINISTIC_UNISWAP_DEPLOYMENT
}
