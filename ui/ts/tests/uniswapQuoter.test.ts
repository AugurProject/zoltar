/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from 'viem'
import {
	DEFAULT_POOL_CONFIG,
	ETH_ADDRESS,
	REP_ADDRESS,
	UNISWAP_V4_QUOTER_ADDRESS,
	WETH_ADDRESS,
	buildUniswapV3PoolUrl,
	buildUniswapV4PoolId,
	buildUniswapV4PoolUrl,
	quoteBestExactInput,
	quoteBestExactInputWithSource,
	quoteBestV3ExactInput,
	quoteBestV3ExactInputWithSource,
	quoteEthForRep,
	quoteEthForToken,
	quoteExactInput,
	quoteRepForEth,
	quoteTokenForEth,
} from '../lib/uniswapQuoter.js'
import type { ReadClient } from '../lib/clients.js'

type SimulateArgs = Parameters<ReadClient['simulateContract']>[0]

type RawSimulateParam = {
	poolKey: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }
	zeroForOne: boolean
	exactAmount: bigint
}

type CapturedCall = {
	address: string
	zeroForOne: boolean
	currency0: string
	currency1: string
	fee: number
	tickSpacing: number
	hooks: string
	exactAmount: bigint
}

function extractParams(args: SimulateArgs): CapturedCall {
	const [param] = args.args as unknown as [RawSimulateParam]
	return {
		address: args.address,
		zeroForOne: param.zeroForOne,
		currency0: param.poolKey.currency0,
		currency1: param.poolKey.currency1,
		fee: param.poolKey.fee,
		tickSpacing: param.poolKey.tickSpacing,
		hooks: param.poolKey.hooks,
		exactAmount: param.exactAmount,
	}
}

function createCapturingClient(amountOut: bigint): { client: ReadClient; captured: CapturedCall } {
	const captured: CapturedCall = { address: '', zeroForOne: false, currency0: '', currency1: '', fee: 0, tickSpacing: 0, hooks: '', exactAmount: 0n }
	const client = {
		simulateContract: async (args: SimulateArgs) => {
			Object.assign(captured, extractParams(args))
			return { result: [amountOut, 100000n] }
		},
	} as unknown as ReadClient
	return { client, captured }
}

function createPoolAwareClient(amountsByFee: Partial<Record<number, bigint>>): ReadClient {
	return {
		simulateContract: async (args: SimulateArgs) => {
			const { fee } = extractParams(args)
			const amountOut = amountsByFee[fee]
			if (amountOut === undefined) {
				throw new Error(`no pool for fee ${fee}`)
			}
			return { result: [amountOut, 100000n] }
		},
	} as unknown as ReadClient
}

function createV3FeeAwareClient(amountsByFee: Partial<Record<number, bigint>>): ReadClient {
	return {
		simulateContract: async (args: SimulateArgs) => {
			const [param] = args.args as unknown as [{ tokenIn: string; tokenOut: string; amountIn: bigint; fee: number; sqrtPriceLimitX96: bigint }]
			const amountOut = amountsByFee[param.fee]
			if (amountOut === undefined) {
				throw new Error(`no v3 pool for fee ${param.fee}`)
			}
			return { result: [amountOut, 0n, 0, 0n] }
		},
	} as unknown as ReadClient
}

void describe('quoteExactInput', () => {
	void test('returns amountOut from the quoter result', async () => {
		const { client } = createCapturingClient(500000000000000000n)
		const result = await quoteExactInput(client, REP_ADDRESS, ETH_ADDRESS, 1000000000000000000n)
		expect(result).toBe(500000000000000000n)
	})

	void test('calls the Uniswap V4 Quoter contract address', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)
		expect(captured.address).toBe(UNISWAP_V4_QUOTER_ADDRESS)
	})

	void test('sets zeroForOne = true when tokenIn is numerically lower (ETH → REP)', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)
		expect(captured.zeroForOne).toBe(true)
	})

	void test('sets zeroForOne = false when tokenIn is numerically higher (REP → ETH)', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, REP_ADDRESS, ETH_ADDRESS, 1n)
		expect(captured.zeroForOne).toBe(false)
	})

	void test('always places the lower address as currency0 (ETH → REP swap)', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)
		expect(captured.currency0).toBe(ETH_ADDRESS)
		expect(captured.currency1).toBe(REP_ADDRESS)
	})

	void test('always places the lower address as currency0 (REP → ETH swap)', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, REP_ADDRESS, ETH_ADDRESS, 1n)
		expect(captured.currency0).toBe(ETH_ADDRESS)
		expect(captured.currency1).toBe(REP_ADDRESS)
	})

	void test('passes pool config fee and tickSpacing', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n, { fee: 500, tickSpacing: 10 })
		expect(captured.fee).toBe(500)
		expect(captured.tickSpacing).toBe(10)
	})

	void test('defaults hooks to zeroAddress when not specified', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n, { fee: 3000, tickSpacing: 60 })
		expect(captured.hooks).toBe(zeroAddress)
	})

	void test('passes amountIn as exactAmount', async () => {
		const { client, captured } = createCapturingClient(1n)
		const amountIn = 7500000000000000000n
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, amountIn)
		expect(captured.exactAmount).toBe(amountIn)
	})

	void test('uses DEFAULT_POOL_CONFIG when no pool config is provided', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)
		expect(captured.fee).toBe(DEFAULT_POOL_CONFIG.fee)
		expect(captured.tickSpacing).toBe(DEFAULT_POOL_CONFIG.tickSpacing)
	})
})

void describe('quoteBestExactInput', () => {
	void test('returns the best successful quote across tested V4 pool configs', async () => {
		const client = createPoolAwareClient({
			100: 9n,
			500: 12n,
			3000: 7n,
		})

		const result = await quoteBestExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)
		expect(result).toBe(12n)
	})

	void test('throws when every tested V4 pool config fails', async () => {
		const client = createPoolAwareClient({})
		await expect(quoteBestExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)).rejects.toThrow('no pool for fee 10000')
	})
})

void describe('quoteBestExactInputWithSource', () => {
	void test('returns the best successful quote together with exact V4 pool metadata', async () => {
		const poolConfigs = [
			{ fee: 100, tickSpacing: 1 },
			{ fee: 500, tickSpacing: 10 },
			{ fee: 3000, tickSpacing: 60 },
		] as const
		const client = createPoolAwareClient({
			100: 9n,
			500: 12n,
			3000: 7n,
		})

		const result = await quoteBestExactInputWithSource(client, ETH_ADDRESS, REP_ADDRESS, 1n, poolConfigs)

		expect(result).toEqual({
			amountOut: 12n,
			source: {
				poolConfig: poolConfigs[1],
				poolId: buildUniswapV4PoolId(ETH_ADDRESS, REP_ADDRESS, poolConfigs[1]),
				poolUrl: buildUniswapV4PoolUrl(ETH_ADDRESS, REP_ADDRESS, poolConfigs[1]),
				protocol: 'v4',
			},
		})
	})
})

void describe('quoteBestV3ExactInput', () => {
	void test('returns the best successful quote across tested V3 fee tiers', async () => {
		const client = createV3FeeAwareClient({
			500: 9n,
			3000: 12n,
			10000: 7n,
		})

		const result = await quoteBestV3ExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)
		expect(result).toBe(12n)
	})

	void test('normalizes ETH to WETH for V3 quotes', async () => {
		const captured: { tokenIn?: string; tokenOut?: string } = {}
		const client = {
			simulateContract: async (args: SimulateArgs) => {
				const [param] = args.args as unknown as [{ tokenIn: string; tokenOut: string; amountIn: bigint; fee: number; sqrtPriceLimitX96: bigint }]
				captured.tokenIn = param.tokenIn
				captured.tokenOut = param.tokenOut
				return { result: [1n, 0n, 0, 0n] }
			},
		} as unknown as ReadClient

		await quoteBestV3ExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n, [100])
		expect(captured.tokenIn).toBe(WETH_ADDRESS)
		expect(captured.tokenOut).toBe(REP_ADDRESS)
	})

	void test('throws when every tested V3 fee tier fails', async () => {
		const client = createV3FeeAwareClient({})
		await expect(quoteBestV3ExactInput(client, ETH_ADDRESS, REP_ADDRESS, 1n)).rejects.toThrow('no v3 pool for fee 10000')
	})
})

void describe('quoteBestV3ExactInputWithSource', () => {
	void test('returns the best successful quote together with exact V3 pool metadata from the factory', async () => {
		const poolAddress = getAddress('0x0000000000000000000000000000000000000abc')
		const factoryCalls: Array<{ fee: number; tokenA: Address; tokenB: Address }> = []
		const client = {
			simulateContract: async (args: SimulateArgs) => {
				const [param] = args.args as unknown as [{ tokenIn: string; tokenOut: string; amountIn: bigint; fee: number; sqrtPriceLimitX96: bigint }]
				const amountOut = param.fee === 500 ? 9n : param.fee === 3000 ? 12n : undefined
				if (amountOut === undefined) {
					throw new Error(`no v3 pool for fee ${param.fee}`)
				}
				return { result: [amountOut, 0n, 0, 0n] }
			},
			readContract: async (args: { args?: unknown[] }) => {
				const [tokenA, tokenB, fee] = args.args as [Address, Address, number]
				factoryCalls.push({ fee, tokenA, tokenB })
				return poolAddress
			},
		} as unknown as ReadClient

		const result = await quoteBestV3ExactInputWithSource(client, ETH_ADDRESS, REP_ADDRESS, 1n, [500, 3000])

		expect(result).toEqual({
			amountOut: 12n,
			source: {
				fee: 3000,
				poolAddress,
				poolUrl: buildUniswapV3PoolUrl(poolAddress),
				protocol: 'v3',
			},
		})
		expect(factoryCalls).toEqual([
			{
				fee: 3000,
				tokenA: REP_ADDRESS,
				tokenB: WETH_ADDRESS,
			},
		])
	})
})

void describe('quoteTokenForEth', () => {
	void test('returns ETH amount out for the given token amount', async () => {
		const { client } = createCapturingClient(400000000000000000n)
		const result = await quoteTokenForEth(client, REP_ADDRESS, 1000000000000000000n)
		expect(result).toBe(400000000000000000n)
	})

	void test('routes token → ETH (zeroForOne = false for REP)', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteTokenForEth(client, REP_ADDRESS, 1n)
		expect(captured.zeroForOne).toBe(false)
	})

	void test('uses the provided token as currency1 when it is numerically higher than ETH', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteTokenForEth(client, REP_ADDRESS, 1n)
		expect(captured.currency1).toBe(REP_ADDRESS)
		expect(captured.currency0).toBe(ETH_ADDRESS)
	})
})

void describe('quoteEthForToken', () => {
	void test('returns token amount out for the given ETH amount', async () => {
		const { client } = createCapturingClient(12000000000000000000n)
		const result = await quoteEthForToken(client, REP_ADDRESS, 1000000000000000000n)
		expect(result).toBe(12000000000000000000n)
	})

	void test('routes ETH → token (zeroForOne = true for REP)', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteEthForToken(client, REP_ADDRESS, 1n)
		expect(captured.zeroForOne).toBe(true)
	})
})

void describe('quoteRepForEth', () => {
	void test('returns ETH amount out for REP input', async () => {
		const { client } = createCapturingClient(300000000000000000n)
		const result = await quoteRepForEth(client, 1000000000000000000n)
		expect(result).toBe(300000000000000000n)
	})

	void test('uses REP_ADDRESS as the input token', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteRepForEth(client, 1n)
		expect(captured.currency1).toBe(REP_ADDRESS)
		expect(captured.zeroForOne).toBe(false)
	})
})

void describe('quoteEthForRep', () => {
	void test('returns REP amount out for ETH input', async () => {
		const { client } = createCapturingClient(8000000000000000000n)
		const result = await quoteEthForRep(client, 1000000000000000000n)
		expect(result).toBe(8000000000000000000n)
	})

	void test('uses REP_ADDRESS as the output token', async () => {
		const { client, captured } = createCapturingClient(1n)
		await quoteEthForRep(client, 1n)
		expect(captured.currency1).toBe(REP_ADDRESS)
		expect(captured.zeroForOne).toBe(true)
	})
})

void describe('ETH_ADDRESS', () => {
	void test('is the zero address (Uniswap V4 ETH convention)', () => {
		expect(ETH_ADDRESS).toBe(zeroAddress)
	})
})
