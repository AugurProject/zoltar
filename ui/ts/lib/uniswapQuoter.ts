import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex, zeroAddress } from 'viem'
import type { ReadClient } from './clients.js'
import { getActiveNetworkProfile, getActiveSimulationController } from './activeEnvironment.js'
import { MAINNET_WETH_ADDRESS } from './networkProfile.js'

export const UNISWAP_V4_QUOTER_ADDRESS: Address = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
// Uniswap V3 QuoterV2 — used as fallback when a V4 pool doesn't exist
const UNISWAP_V3_QUOTER_ADDRESS: Address = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
const UNISWAP_V3_FACTORY_ADDRESS: Address = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
const UNISWAP_POOL_EXPLORER_BASE_URL = 'https://app.uniswap.org/explore/pools/ethereum'

// Known token addresses (mainnet)
export const REP_ADDRESS: Address = '0x221657776846890989a759BA2973e427DfF5C9bB'
export const USDC_ADDRESS: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
// WETH — used for V3 quotes (V3 doesn't support native ETH, only WETH)
export const WETH_ADDRESS: Address = MAINNET_WETH_ADDRESS
// ETH in Uniswap V4 is represented as address(0)
export const ETH_ADDRESS: Address = zeroAddress

type PoolConfig = {
	fee: number
	tickSpacing: number
	hooks?: Address
}

type UniswapV4QuoteSource = {
	poolConfig: PoolConfig
	poolId: Hex
	poolUrl: string
	protocol: 'v4'
}

type UniswapV3QuoteSource = {
	fee: number
	poolAddress: Address | undefined
	poolUrl: string | undefined
	protocol: 'v3'
}

type MockQuoteSource = {
	label: 'MOCK'
	poolUrl: undefined
	protocol: 'mock'
}

// Default pool config (0.3% fee, standard tick spacing, no hooks)
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

const COMMON_V3_FEES = [100, 500, 3000, 10000] as const
const ERC20_SYMBOL_ABI = [
	{
		name: 'symbol',
		type: 'function',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ name: '', type: 'string' }],
	},
] as const

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

function sortTokenPair(tokenA: Address, tokenB: Address): [Address, Address] {
	return BigInt(tokenA) < BigInt(tokenB) ? [tokenA, tokenB] : [tokenB, tokenA]
}

function buildUniswapPoolExplorerUrl(poolIdentifier: string) {
	return `${UNISWAP_POOL_EXPLORER_BASE_URL}/${poolIdentifier}`
}

export function getWethAddress() {
	return getActiveNetworkProfile().wethAddress
}

export function getRepAddress() {
	return getActiveNetworkProfile().genesisRepTokenAddress
}

export function isRepPricingEnabled() {
	return getActiveNetworkProfile().repPricingMode === 'uniswap' || getActiveNetworkProfile().repPricingMode === 'mock'
}

function isMockRepPricingEnabled() {
	return getActiveNetworkProfile().repPricingMode === 'mock'
}

function assertRepPricingEnabled() {
	if (isRepPricingEnabled()) return
	throw new Error('Uniswap pricing is unavailable in simulation mode.')
}

async function isRepToken(client: ReadClient, token: Address) {
	if (token === ETH_ADDRESS || token === getWethAddress()) return false
	try {
		const symbol = await client.readContract({
			address: token,
			abi: ERC20_SYMBOL_ABI,
			functionName: 'symbol',
		})
		return symbol === 'REP'
	} catch (_error) {
		return false
	}
}

function getMockRepPrice() {
	const controller = getActiveSimulationController()
	if (controller === undefined) throw new Error('Simulation REP/ETH mock pricing is unavailable')
	return controller.repPerEthPrice
}

function getMockRepUsdcPrice() {
	const controller = getActiveSimulationController()
	if (controller === undefined) throw new Error('Simulation REP/USDC mock pricing is unavailable')
	return controller.repPerUsdcPrice
}

function calculateMockAmountOut(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
	const repPerEthPrice = getMockRepPrice()
	const tokenInIsEth = tokenIn === ETH_ADDRESS || tokenIn === getWethAddress()
	const tokenOutIsEth = tokenOut === ETH_ADDRESS || tokenOut === getWethAddress()

	if (tokenInIsEth && !tokenOutIsEth) return (amountIn * repPerEthPrice) / 10n ** 18n
	if (!tokenInIsEth && tokenOutIsEth) return (amountIn * 10n ** 18n) / repPerEthPrice
	throw new Error('Simulation REP/ETH mock pricing only supports REP paired with ETH or WETH')
}

function calculateMockUsdcAmountOut(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
	const repPerUsdcPrice = getMockRepUsdcPrice()
	const tokenInIsUsdc = tokenIn === USDC_ADDRESS
	const tokenOutIsUsdc = tokenOut === USDC_ADDRESS

	if (!tokenInIsUsdc && tokenOutIsUsdc) return (amountIn * repPerUsdcPrice) / 10n ** 18n
	if (tokenInIsUsdc && !tokenOutIsUsdc) return (amountIn * 10n ** 18n) / repPerUsdcPrice
	throw new Error('Simulation REP/USDC mock pricing only supports REP paired with USDC')
}

async function maybeQuoteMockRepPair(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<{ amountOut: bigint; source: MockQuoteSource } | undefined> {
	if (!isMockRepPricingEnabled()) return undefined

	const tokenInIsEth = tokenIn === ETH_ADDRESS || tokenIn === getWethAddress()
	const tokenOutIsEth = tokenOut === ETH_ADDRESS || tokenOut === getWethAddress()
	const tokenInIsUsdc = tokenIn === USDC_ADDRESS
	const tokenOutIsUsdc = tokenOut === USDC_ADDRESS

	if (!tokenInIsEth && !tokenOutIsEth && !tokenInIsUsdc && !tokenOutIsUsdc) return undefined
	if ((tokenInIsEth || tokenOutIsEth) && (tokenInIsUsdc || tokenOutIsUsdc)) return undefined
	if (tokenInIsEth === tokenOutIsEth && tokenInIsUsdc === tokenOutIsUsdc) return undefined

	const repToken = tokenInIsEth || tokenInIsUsdc ? tokenOut : tokenIn
	if (!(await isRepToken(client, repToken))) return undefined

	return {
		amountOut: tokenInIsUsdc || tokenOutIsUsdc ? calculateMockUsdcAmountOut(tokenIn, tokenOut, amountIn) : calculateMockAmountOut(tokenIn, tokenOut, amountIn),
		source: {
			label: 'MOCK',
			poolUrl: undefined,
			protocol: 'mock',
		},
	}
}

async function assertMockPairSupported(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint) {
	if (!isMockRepPricingEnabled()) return undefined
	const mockResult = await maybeQuoteMockRepPair(client, tokenIn, tokenOut, amountIn)
	if (mockResult !== undefined) return mockResult
	throw new Error('Simulation mock pricing only supports REP / ETH, REP / WETH, and REP / USDC pairs.')
}

export function buildUniswapV4PoolId(tokenA: Address, tokenB: Address, poolConfig: PoolConfig): Hex {
	const [currency0, currency1] = sortTokenPair(tokenA, tokenB)
	return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [currency0, currency1, poolConfig.fee, poolConfig.tickSpacing, poolConfig.hooks ?? zeroAddress]))
}

export function buildUniswapV4PoolUrl(tokenA: Address, tokenB: Address, poolConfig: PoolConfig) {
	return buildUniswapPoolExplorerUrl(buildUniswapV4PoolId(tokenA, tokenB, poolConfig))
}

export function buildUniswapV3PoolUrl(poolAddress: Address) {
	return buildUniswapPoolExplorerUrl(poolAddress)
}

// Returns how much tokenOut you receive for swapping `amountIn` of tokenIn.
// Use ETH_ADDRESS (zeroAddress) for ETH. Tokens can be in any order — currency0/1
// ordering and zeroForOne direction are derived from the addresses automatically.
export async function quoteExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
	assertRepPricingEnabled()
	const mockResult = await assertMockPairSupported(client, tokenIn, tokenOut, amountIn)
	if (mockResult !== undefined) return mockResult.amountOut
	const tokenInBig = BigInt(tokenIn)
	const tokenOutBig = BigInt(tokenOut)
	const zeroForOne = tokenInBig < tokenOutBig
	const [currency0, currency1] = zeroForOne ? [tokenIn, tokenOut] : [tokenOut, tokenIn]

	const { result } = await client.simulateContract({
		address: UNISWAP_V4_QUOTER_ADDRESS,
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

export async function quoteBestExactInputWithSource(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfigs: readonly PoolConfig[] = COMMON_V4_POOL_CONFIGS): Promise<{ amountOut: bigint; source: UniswapV4QuoteSource | MockQuoteSource }> {
	assertRepPricingEnabled()
	const mockResult = await assertMockPairSupported(client, tokenIn, tokenOut, amountIn)
	if (mockResult !== undefined) return mockResult
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
			poolUrl: buildUniswapV4PoolUrl(tokenIn, tokenOut, bestPoolConfig),
			protocol: 'v4',
		},
	}
}

export async function quoteBestExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfigs: readonly PoolConfig[] = COMMON_V4_POOL_CONFIGS): Promise<bigint> {
	const result = await quoteBestExactInputWithSource(client, tokenIn, tokenOut, amountIn, poolConfigs)
	return result.amountOut
}

// Returns how much ETH (in wei) you receive for swapping `amountIn` of `token`
export async function quoteTokenForEth(client: ReadClient, token: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
	return quoteExactInput(client, token, ETH_ADDRESS, amountIn, poolConfig)
}

// Returns how much `token` (in token's native units) you receive for swapping `amountIn` ETH (in wei)
export async function quoteEthForToken(client: ReadClient, token: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
	return quoteExactInput(client, ETH_ADDRESS, token, amountIn, poolConfig)
}

// Convenience: REP → ETH using the default pool config
export async function quoteRepForEth(client: ReadClient, repAmount: bigint): Promise<bigint> {
	return quoteBestExactInput(client, getRepAddress(), ETH_ADDRESS, repAmount)
}

// Convenience: ETH → REP using the default pool config
export async function quoteEthForRep(client: ReadClient, ethAmount: bigint): Promise<bigint> {
	return quoteBestExactInput(client, ETH_ADDRESS, getRepAddress(), ethAmount)
}

// ─── Uniswap V3 ───────────────────────────────────────────────────────────────

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

// Returns how much tokenOut you receive for swapping `amountIn` of tokenIn via Uniswap V3.
// Use WETH_ADDRESS for ETH (V3 does not support native ETH).
async function quoteV3ExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): Promise<bigint> {
	const { result } = await client.simulateContract({
		address: UNISWAP_V3_QUOTER_ADDRESS,
		abi: V3_QUOTER_ABI,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	})
	return result[0]
}

function normalizeV3Token(token: Address) {
	return token === ETH_ADDRESS ? getWethAddress() : token
}

async function loadUniswapV3PoolAddress(client: ReadClient, tokenIn: Address, tokenOut: Address, fee: number): Promise<Address | undefined> {
	const [token0, token1] = sortTokenPair(normalizeV3Token(tokenIn), normalizeV3Token(tokenOut))

	try {
		const poolAddress = await client.readContract({
			address: UNISWAP_V3_FACTORY_ADDRESS,
			abi: V3_FACTORY_ABI,
			functionName: 'getPool',
			args: [token0, token1, fee],
		})
		if (poolAddress === zeroAddress) return undefined
		return getAddress(poolAddress)
	} catch (_error) {
		return undefined
	}
}

export async function quoteBestV3ExactInputWithSource(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fees: readonly number[] = COMMON_V3_FEES): Promise<{ amountOut: bigint; source: UniswapV3QuoteSource | MockQuoteSource }> {
	assertRepPricingEnabled()
	const mockResult = await assertMockPairSupported(client, tokenIn, tokenOut, amountIn)
	if (mockResult !== undefined) return mockResult
	const normalizedTokenIn = normalizeV3Token(tokenIn)
	const normalizedTokenOut = normalizeV3Token(tokenOut)

	let bestAmountOut: bigint | undefined
	let bestFee: number | undefined
	let lastError: unknown

	for (const fee of fees) {
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
			poolUrl: poolAddress === undefined ? undefined : buildUniswapV3PoolUrl(poolAddress),
			protocol: 'v3',
		},
	}
}

export async function quoteBestV3ExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fees: readonly number[] = COMMON_V3_FEES): Promise<bigint> {
	const result = await quoteBestV3ExactInputWithSource(client, tokenIn, tokenOut, amountIn, fees)
	return result.amountOut
}

// Returns how much WETH (= ETH) you receive for `repAmount` REP via Uniswap V3 (1% pool).
export async function quoteRepForEthV3(client: ReadClient, repAmount: bigint): Promise<bigint> {
	return quoteBestV3ExactInput(client, getRepAddress(), ETH_ADDRESS, repAmount)
}

// ─── Known V4 REP pools ───────────────────────────────────────────────────────
// REP/USDC V4 pool (fee=10001, tickSpacing=200, no hooks)
// Pool ID: 0x75d479eb83b7c9008ab854e74625a01841e5b3e06af40a89c10998ad2664f356
const REP_USDC_V4_POOL: PoolConfig = { fee: 10001, tickSpacing: 200 }

export async function quoteRepForUsdcV4WithSource(client: ReadClient, repAmount: bigint) {
	return await quoteBestExactInputWithSource(client, getRepAddress(), USDC_ADDRESS, repAmount, [REP_USDC_V4_POOL])
}
