import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex, zeroAddress } from 'viem'
import { DEFAULT_NETWORK_KEY, getNetworkConfig, getNetworkConfigByChainId, type SupportedNetworkConfig } from '../shared/networkConfig.js'
import type { ReadClient } from './clients.js'

export const ETH_ADDRESS: Address = zeroAddress

type PoolConfig = {
	fee: number
	tickSpacing: number
	hooks?: Address
}

type ReadClientWithChain = Pick<ReadClient, 'readContract' | 'simulateContract'> & {
	chain?:
		| {
				id: number
		  }
		| undefined
}

type UniswapV4QuoteSource = {
	poolConfig: PoolConfig
	poolId: Hex
	poolUrl: string | undefined
	protocol: 'v4'
}

type UniswapV3QuoteSource = {
	fee: number
	poolAddress: Address | undefined
	poolUrl: string | undefined
	protocol: 'v3'
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
	fee: 3000,
	tickSpacing: 60,
}

const COMMON_V4_POOL_CONFIGS: readonly PoolConfig[] = [
	{ fee: 100, tickSpacing: 1 },
	{ fee: 500, tickSpacing: 10 },
	{ fee: 3000, tickSpacing: 60 },
	{ fee: 10000, tickSpacing: 200 },
]

const V3_FACTORY_ABI = [
	{
		name: 'getPool',
		type: 'function',
		stateMutability: 'view',
		inputs: [
			{ name: 'tokenA', type: 'address' },
			{ name: 'tokenB', type: 'address' },
			{ name: 'fee', type: 'uint24' },
		],
		outputs: [{ name: 'pool', type: 'address' }],
	},
] as const

const QUOTER_ABI = [
	{
		name: 'quoteExactInputSingle',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{
						name: 'poolKey',
						type: 'tuple',
						components: [
							{ name: 'currency0', type: 'address' },
							{ name: 'currency1', type: 'address' },
							{ name: 'fee', type: 'uint24' },
							{ name: 'tickSpacing', type: 'int24' },
							{ name: 'hooks', type: 'address' },
						],
					},
					{ name: 'zeroForOne', type: 'bool' },
					{ name: 'exactAmount', type: 'uint128' },
					{ name: 'hookData', type: 'bytes' },
				],
			},
		],
		outputs: [
			{ name: 'amountOut', type: 'uint256' },
			{ name: 'gasEstimate', type: 'uint256' },
		],
	},
] as const

const V3_QUOTER_ABI = [
	{
		name: 'quoteExactInputSingle',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'amountIn', type: 'uint256' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'sqrtPriceLimitX96', type: 'uint160' },
				],
			},
		],
		outputs: [
			{ name: 'amountOut', type: 'uint256' },
			{ name: 'sqrtPriceX96After', type: 'uint160' },
			{ name: 'initializedTicksCrossed', type: 'uint32' },
			{ name: 'gasEstimate', type: 'uint256' },
		],
	},
] as const

function chainIdToHex(chainId: number) {
	return `0x${chainId.toString(16)}`
}

function getClientNetworkConfig(client: ReadClientWithChain): SupportedNetworkConfig {
	const chainIdHex = client.chain?.id === undefined ? undefined : chainIdToHex(client.chain.id)
	return chainIdHex === undefined ? getNetworkConfig(DEFAULT_NETWORK_KEY) : (getNetworkConfigByChainId(chainIdHex) ?? getNetworkConfig(DEFAULT_NETWORK_KEY))
}

function sortTokenPair(tokenA: Address, tokenB: Address): [Address, Address] {
	return BigInt(tokenA) < BigInt(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA]
}

function buildUniswapPoolExplorerUrl(poolIdentifier: string, networkConfig: SupportedNetworkConfig) {
	return networkConfig.uniswapPoolExplorerBaseUrl === undefined ? undefined : `${networkConfig.uniswapPoolExplorerBaseUrl}/${poolIdentifier}`
}

export function buildUniswapV4PoolId(tokenA: Address, tokenB: Address, poolConfig: PoolConfig): Hex {
	const [currency0, currency1] = sortTokenPair(tokenA, tokenB)
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [currency0, currency1, poolConfig.fee, poolConfig.tickSpacing, poolConfig.hooks ?? zeroAddress]))
}

export function buildUniswapV4PoolUrl(tokenA: Address, tokenB: Address, poolConfig: PoolConfig, networkConfig: SupportedNetworkConfig = getNetworkConfig(DEFAULT_NETWORK_KEY)) {
	return buildUniswapPoolExplorerUrl(buildUniswapV4PoolId(tokenA, tokenB, poolConfig), networkConfig)
}

export function buildUniswapV3PoolUrl(poolAddress: Address, networkConfig: SupportedNetworkConfig = getNetworkConfig(DEFAULT_NETWORK_KEY)) {
	return buildUniswapPoolExplorerUrl(poolAddress, networkConfig)
}

export async function quoteExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
	const networkConfig = getClientNetworkConfig(client)
	const tokenInBig = BigInt(tokenIn)
	const tokenOutBig = BigInt(tokenOut)
	const zeroForOne = tokenInBig < tokenOutBig
	const [currency0, currency1] = zeroForOne ? [tokenIn, tokenOut] : [tokenOut, tokenIn]

	const { result } = await client.simulateContract({
		address: networkConfig.uniswapV4QuoterAddress,
		abi: QUOTER_ABI,
		functionName: 'quoteExactInputSingle',
		args: [
			{
				poolKey: {
					currency0,
					currency1,
					fee: poolConfig.fee,
					tickSpacing: poolConfig.tickSpacing,
					hooks: poolConfig.hooks ?? zeroAddress,
				},
				zeroForOne,
				exactAmount: amountIn,
				hookData: '0x',
			},
		],
	})
	return result[0]
}

export async function quoteBestExactInputWithSource(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfigs: readonly PoolConfig[] = COMMON_V4_POOL_CONFIGS): Promise<{ amountOut: bigint; source: UniswapV4QuoteSource }> {
	const networkConfig = getClientNetworkConfig(client)
	let bestAmountOut: bigint | undefined
	let bestPoolConfig: PoolConfig | undefined
	let lastError: unknown

	for (const poolConfig of poolConfigs) {
		try {
			const amountOut = await quoteExactInput(client, tokenIn, tokenOut, amountIn, poolConfig)
			if (bestAmountOut === undefined || amountOut > bestAmountOut) {
				bestAmountOut = amountOut
				bestPoolConfig = poolConfig
			}
		} catch (error) {
			lastError = error
		}
	}

	if (bestAmountOut === undefined || bestPoolConfig === undefined) {
		if (lastError !== undefined) throw lastError
		throw new Error('No Uniswap V4 quote was available for the tested pool configurations')
	}

	const poolId = buildUniswapV4PoolId(tokenIn, tokenOut, bestPoolConfig)
	return {
		amountOut: bestAmountOut,
		source: {
			poolConfig: bestPoolConfig,
			poolId,
			poolUrl: buildUniswapV4PoolUrl(tokenIn, tokenOut, bestPoolConfig, networkConfig),
			protocol: 'v4',
		},
	}
}

export async function quoteBestExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfigs: readonly PoolConfig[] = COMMON_V4_POOL_CONFIGS): Promise<bigint> {
	const result = await quoteBestExactInputWithSource(client, tokenIn, tokenOut, amountIn, poolConfigs)
	return result.amountOut
}

export async function quoteTokenForEth(client: ReadClient, token: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
	return quoteExactInput(client, token, ETH_ADDRESS, amountIn, poolConfig)
}

export async function quoteEthForToken(client: ReadClient, token: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
	return quoteExactInput(client, ETH_ADDRESS, token, amountIn, poolConfig)
}

export async function quoteRepForEth(client: ReadClient, repAmount: bigint): Promise<bigint> {
	const networkConfig = getClientNetworkConfig(client)
	return quoteBestExactInput(client, networkConfig.genesisRepTokenAddress, ETH_ADDRESS, repAmount, networkConfig.repEthV4PoolConfigs)
}

export async function quoteEthForRep(client: ReadClient, ethAmount: bigint): Promise<bigint> {
	const networkConfig = getClientNetworkConfig(client)
	return quoteBestExactInput(client, ETH_ADDRESS, networkConfig.genesisRepTokenAddress, ethAmount, networkConfig.repEthV4PoolConfigs)
}

async function quoteV3ExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): Promise<bigint> {
	const networkConfig = getClientNetworkConfig(client)
	const { result } = await client.simulateContract({
		address: networkConfig.uniswapV3QuoterV2Address,
		abi: V3_QUOTER_ABI,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	})
	return result[0]
}

function normalizeV3Token(token: Address, networkConfig: SupportedNetworkConfig) {
	return token === ETH_ADDRESS ? networkConfig.wethAddress : token
}

async function loadUniswapV3PoolAddress(client: ReadClient, tokenIn: Address, tokenOut: Address, fee: number): Promise<Address | undefined> {
	const networkConfig = getClientNetworkConfig(client)
	const [token0, token1] = sortTokenPair(normalizeV3Token(tokenIn, networkConfig), normalizeV3Token(tokenOut, networkConfig))

	try {
		const poolAddress = await client.readContract({
			address: networkConfig.uniswapV3FactoryAddress,
			abi: V3_FACTORY_ABI,
			functionName: 'getPool',
			args: [token0, token1, fee],
		})
		if (poolAddress === zeroAddress) return undefined
		return getAddress(poolAddress)
	} catch {
		return undefined
	}
}

export async function quoteBestV3ExactInputWithSource(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fees?: readonly number[]): Promise<{ amountOut: bigint; source: UniswapV3QuoteSource }> {
	const networkConfig = getClientNetworkConfig(client)
	const normalizedTokenIn = normalizeV3Token(tokenIn, networkConfig)
	const normalizedTokenOut = normalizeV3Token(tokenOut, networkConfig)
	const quoteFees = fees ?? networkConfig.repV3FallbackFees

	let bestAmountOut: bigint | undefined
	let bestFee: number | undefined
	let lastError: unknown

	for (const fee of quoteFees) {
		try {
			const amountOut = await quoteV3ExactInput(client, normalizedTokenIn, normalizedTokenOut, amountIn, fee)
			if (bestAmountOut === undefined || amountOut > bestAmountOut) {
				bestAmountOut = amountOut
				bestFee = fee
			}
		} catch (error) {
			lastError = error
		}
	}

	if (bestAmountOut === undefined || bestFee === undefined) {
		if (lastError !== undefined) throw lastError
		throw new Error('No Uniswap V3 quote was available for the tested fee tiers')
	}

	const poolAddress = await loadUniswapV3PoolAddress(client, tokenIn, tokenOut, bestFee)
	return {
		amountOut: bestAmountOut,
		source: {
			fee: bestFee,
			poolAddress,
			poolUrl: poolAddress === undefined ? undefined : buildUniswapV3PoolUrl(poolAddress, networkConfig),
			protocol: 'v3',
		},
	}
}

export async function quoteBestV3ExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fees?: readonly number[]): Promise<bigint> {
	const result = await quoteBestV3ExactInputWithSource(client, tokenIn, tokenOut, amountIn, fees)
	return result.amountOut
}

export async function quoteRepForEthV3(client: ReadClient, repAmount: bigint): Promise<bigint> {
	const networkConfig = getClientNetworkConfig(client)
	return quoteBestV3ExactInput(client, networkConfig.genesisRepTokenAddress, ETH_ADDRESS, repAmount, networkConfig.repV3FallbackFees)
}

export async function quoteRepForUsdcV4WithSource(client: ReadClient, repAmount: bigint) {
	const networkConfig = getClientNetworkConfig(client)
	return await quoteBestExactInputWithSource(client, networkConfig.genesisRepTokenAddress, networkConfig.usdcAddress, repAmount, networkConfig.repUsdcV4PoolConfigs)
}
