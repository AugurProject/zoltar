import type { Configuration } from '#config/configuration'
import { constantProductPairAbi, erc20Abi, poolAbi } from '#contracts/abi'
import { uniswapV3QuoterAbi, uniswapV4QuoterAbi } from '@zoltar/core-shared/evm/uniswapAbis'
import { batchRead, batchValue, type BatchCall, type BatchReader } from '#core/batch-read'
import type { Pool } from '#core/operator-types'
import { requiredBigint, requiredTuple } from '#core/rpc-validation'
import { v4QuotePlan } from '#core/uniswap-v4'
import { constantProductExactInput, constantProductExactOutput } from '#core/venue-strategy'
import { encodeAbiParameters, keccak256, getAddress } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'

type QuoteConfiguration = Pick<Configuration, 'network' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter' | 'maxPriceImpactBps'>
/** `buyAmount` and `sellAmount` are report-token units; `replacementAmount1` is the replacement report's `token1` amount in the pool's quote token. */
type QuoteAmounts = { sellAmount: bigint; buyAmount: bigint; replacementAmount1: bigint }

const extsloadAbi = [{ type: 'function', name: 'extsload', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bytes32' }] }] as const

function withinImpact(actual: bigint, expected: bigint, maximumBps: bigint) {
	return expected > 0n && (actual > expected ? actual - expected : expected - actual) * 10_000n <= expected * maximumBps
}

function sqrtRatio(sqrtPriceX96: bigint, tokenIsFirst: boolean) {
	if (sqrtPriceX96 <= 0n) throw new Error('Venue marginal price is unavailable')
	const squared = sqrtPriceX96 * sqrtPriceX96
	return tokenIsFirst ? { tokenUnits: 2n ** 192n, quoteUnits: squared } : { tokenUnits: squared, quoteUnits: 2n ** 192n }
}

/** Replacement reports use the marginal reserve/slot0 price, never an impact-inclusive swap output. Quotes are in `pool.quoteToken` units. */
export async function quoteVenue(client: BatchReader, config: QuoteConfiguration, pool: Pool, amounts: QuoteAmounts, blockNumber: bigint) {
	const maximumBps = config.maxPriceImpactBps ?? 100n
	if (maximumBps < 0n || maximumBps > 1_000n) throw new Error('Maximum price impact must be from 0 to 1000 bps')
	let failure: string | undefined
	const settle = (read: () => bigint) => {
		try {
			const amount = read()
			if (amount <= 0n) throw new Error('Venue quote must be positive')
			return amount
		} catch (error) {
			failure = errorMessage(error)
			return undefined
		}
	}
	let sell: bigint | undefined
	let buy: bigint | undefined
	let replacement: bigint | undefined
	let replacementSwap: bigint | undefined
	let ratio: { tokenUnits: bigint; quoteUnits: bigint } | undefined
	try {
		if (pool.venue === 'uniswap-v2') {
			if (config.v2Router === undefined) throw new Error('Uniswap V2 is disabled or unavailable')
			const results = await batchRead(
				client,
				config.network.multicall3,
				[
					{ address: pool.address, abi: constantProductPairAbi, functionName: 'token0' },
					{ address: pool.address, abi: constantProductPairAbi, functionName: 'getReserves' },
				],
				blockNumber,
			)
			const token0 = batchValue(results[0], 'Uniswap V2 token0')
			if (typeof token0 !== 'string') throw new Error('Uniswap V2 token0 is invalid')
			const firstToken = getAddress(token0).toLowerCase()
			if (firstToken !== pool.token.toLowerCase() && firstToken !== pool.quoteToken.toLowerCase()) throw new Error('Uniswap V2 pair has an unexpected token')
			const reserves = requiredTuple(batchValue(results[1], 'Uniswap V2 reserves'), 2, 'Uniswap V2 reserves')
			const reserve0 = requiredBigint(reserves[0], 'Uniswap V2 reserve0')
			const reserve1 = requiredBigint(reserves[1], 'Uniswap V2 reserve1')
			const [reserveToken, reserveQuote] = firstToken === pool.token.toLowerCase() ? [reserve0, reserve1] : [reserve1, reserve0]
			sell = settle(() => constantProductExactInput(amounts.sellAmount, reserveToken, reserveQuote))
			buy = settle(() => constantProductExactOutput(amounts.buyAmount, reserveQuote, reserveToken))
			replacementSwap = settle(() => constantProductExactInput(amounts.replacementAmount1, reserveQuote, reserveToken))
			ratio = { tokenUnits: reserveToken, quoteUnits: reserveQuote }
		} else {
			let calls: BatchCall[]
			if (pool.venue === 'uniswap-v3') {
				if (config.router === undefined) throw new Error('Uniswap V3 is disabled')
				calls = [
					{ address: config.network.quoter, abi: uniswapV3QuoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: pool.token, tokenOut: pool.quoteToken, amountIn: amounts.sellAmount, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
					{ address: config.network.quoter, abi: uniswapV3QuoterAbi, functionName: 'quoteExactOutputSingle', args: [{ tokenIn: pool.quoteToken, tokenOut: pool.token, amount: amounts.buyAmount, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
					{ address: config.network.quoter, abi: uniswapV3QuoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: pool.quoteToken, tokenOut: pool.token, amountIn: amounts.replacementAmount1, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
					{ address: pool.address, abi: poolAbi, functionName: 'slot0' },
				]
			} else {
				if (config.v4PoolManager === undefined || config.v4Quoter === undefined || pool.address.toLowerCase() !== config.v4PoolManager.toLowerCase()) throw new Error('Uniswap V4 is disabled or has an unexpected PoolManager')
				if (pool.quoteToken.toLowerCase() !== config.network.weth.toLowerCase()) throw new Error('Uniswap V4 hedges settle only against native ETH for WETH collateral')
				const plan = v4QuotePlan(pool.token, pool.fee, amounts.sellAmount, amounts.buyAmount)
				const replacementPlan = v4QuotePlan(pool.token, pool.fee, amounts.sellAmount, amounts.replacementAmount1)
				const key = plan.buy.poolKey
				const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]))
				// Uniswap v4 StateLibrary.POOLS_SLOT = 6; slot0 occupies its first word.
				const stateSlot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [poolId, 6n]))
				calls = [
					{ address: config.v4Quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactInputSingle', args: [plan.sell] },
					{ address: config.v4Quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactOutputSingle', args: [plan.buy] },
					{ address: config.v4Quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactInputSingle', args: [replacementPlan.buy] },
					{ address: config.v4PoolManager, abi: extsloadAbi, functionName: 'extsload', args: [stateSlot] },
				]
			}
			const results = await batchRead(client, config.network.multicall3, calls, blockNumber)
			const amount = (index: number) => requiredBigint(requiredTuple(batchValue(results[index], 'Venue quote'), 1, 'Venue quote')[0], 'Venue quote amount')
			sell = settle(() => amount(0))
			buy = settle(() => amount(1))
			replacementSwap = settle(() => amount(2))
			if (pool.venue === 'uniswap-v3') {
				const slot0 = requiredTuple(batchValue(results[3], 'Venue marginal price'), 1, 'Venue slot0')
				ratio = sqrtRatio(requiredBigint(slot0[0], 'Venue sqrtPriceX96'), BigInt(pool.token) < BigInt(pool.quoteToken))
			} else {
				const slot0 = batchValue(results[3], 'Venue marginal price')
				if (typeof slot0 !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(slot0)) throw new Error('Invalid v4 slot0')
				ratio = sqrtRatio(BigInt(slot0) & (2n ** 160n - 1n), false)
			}
		}
	} catch (error) {
		failure = errorMessage(error)
	}
	if (ratio !== undefined && ratio.quoteUnits > 0n && ratio.tokenUnits > 0n) replacement = settle(() => (amounts.replacementAmount1 * ratio.tokenUnits) / ratio.quoteUnits)
	const withinPriceImpact =
		ratio !== undefined &&
		replacement !== undefined &&
		replacementSwap !== undefined &&
		sell !== undefined &&
		buy !== undefined &&
		withinImpact(replacementSwap, replacement, maximumBps) &&
		withinImpact(sell, (amounts.sellAmount * ratio.quoteUnits) / ratio.tokenUnits, maximumBps) &&
		withinImpact(buy, (amounts.buyAmount * ratio.quoteUnits + ratio.tokenUnits - 1n) / ratio.tokenUnits, maximumBps)
	if (failure === undefined && !withinPriceImpact) failure = 'Venue full-size quote exceeds maximum price impact from marginal price'
	let failureSummary = failure === undefined ? undefined : 'Venue quote unavailable'
	if (failure?.includes('PoolNotInitialized()')) failureSummary = 'Pool is not initialized'
	if (pool.venue === 'uniswap-v3' && config.router !== undefined && buy === undefined && failure !== undefined) {
		try {
			const balance = await batchRead(client, config.network.multicall3, [{ address: pool.token, abi: erc20Abi, functionName: 'balanceOf', args: [pool.address] }], blockNumber)
			const available = requiredBigint(batchValue(balance[0], 'Pool token balance'), 'Pool token balance')
			if (amounts.buyAmount > available) {
				failureSummary = 'Not enough token liquidity'
				failure += `; exact-output buy requires ${amounts.buyAmount.toString()} token base units; pool holds ${available.toString()}`
			}
		} catch (error) {
			// A failed diagnostic read must never turn an unknown quote failure into a liquidity claim.
			failure += `; pool token balance could not be checked: ${errorMessage(error)}`
		}
	}
	return { sell, buy, replacement, failure, failureSummary, withinPriceImpact }
}

/** Selection and final validation require the same complete quote set; valuation may use partial quotes. */
export function executableVenueQuotes(quotes: Awaited<ReturnType<typeof quoteVenue>>) {
	const { sell, buy, replacement } = quotes
	if (!quotes.withinPriceImpact || sell === undefined || buy === undefined || replacement === undefined) return undefined
	return { sell, buy, replacement }
}
