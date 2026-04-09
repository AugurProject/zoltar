import { type Address, zeroAddress } from 'viem'
import type { ReadClient } from './clients.js'

export const UNISWAP_V4_QUOTER_ADDRESS: Address = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203'
// Uniswap V3 QuoterV2 — used as fallback when a V4 pool doesn't exist
const UNISWAP_V3_QUOTER_ADDRESS: Address = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'

// Known token addresses (mainnet)
export const REP_ADDRESS: Address = '0x221657776846890989a759BA2973e427DfF5C9bB'
export const USDC_ADDRESS: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
// WETH — used for V3 quotes (V3 doesn't support native ETH, only WETH)
const WETH_ADDRESS: Address = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
// ETH in Uniswap V4 is represented as address(0)
export const ETH_ADDRESS: Address = zeroAddress

type PoolConfig = {
	fee: number
	tickSpacing: number
	hooks?: Address
}

// Default pool config (0.3% fee, standard tick spacing, no hooks)
export const DEFAULT_POOL_CONFIG: PoolConfig = {
	fee: 3000,
	tickSpacing: 60,
}

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

// Returns how much tokenOut you receive for swapping `amountIn` of tokenIn.
// Use ETH_ADDRESS (zeroAddress) for ETH. Tokens can be in any order — currency0/1
// ordering and zeroForOne direction are derived from the addresses automatically.
export async function quoteExactInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, poolConfig: PoolConfig = DEFAULT_POOL_CONFIG): Promise<bigint> {
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
	return quoteTokenForEth(client, REP_ADDRESS, repAmount)
}

// Convenience: ETH → REP using the default pool config
export async function quoteEthForRep(client: ReadClient, ethAmount: bigint): Promise<bigint> {
	return quoteEthForToken(client, REP_ADDRESS, ethAmount)
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

// Returns how much WETH (= ETH) you receive for `repAmount` REP via Uniswap V3 (1% pool).
export async function quoteRepForEthV3(client: ReadClient, repAmount: bigint): Promise<bigint> {
	return quoteV3ExactInput(client, REP_ADDRESS, WETH_ADDRESS, repAmount, 10000)
}

// ─── Known V4 REP pools ───────────────────────────────────────────────────────
// REP/USDC V4 pool (fee=10001, tickSpacing=200, no hooks)
// Pool ID: 0x75d479eb83b7c9008ab854e74625a01841e5b3e06af40a89c10998ad2664f356
const REP_USDC_V4_POOL: PoolConfig = { fee: 10001, tickSpacing: 200 }

// Returns how much USDC (6 decimals) you receive for `repAmount` REP via the V4 REP/USDC pool.
export async function quoteRepForUsdcV4(client: ReadClient, repAmount: bigint): Promise<bigint> {
	return quoteExactInput(client, REP_ADDRESS, USDC_ADDRESS, repAmount, REP_USDC_V4_POOL)
}
