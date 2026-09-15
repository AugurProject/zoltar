import type { Configuration } from '#config/configuration'
import { constantProductPairAbi, quoterAbi, v4QuoterAbi } from '#contracts/abi'
import { batchRead, batchValue, type BatchCall, type BatchReader } from '#core/batch-read'
import type { Pool } from '#core/operator-types'
import { requiredBigint, requiredTuple } from '#core/rpc-validation'
import { v4QuotePlan } from '#core/uniswap-v4'
import { constantProductExactInput, constantProductExactOutput } from '#core/venue-strategy'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'

type QuoteConfiguration = Pick<Configuration, 'network' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter'>
type QuoteAmounts = { sellAmount: bigint; buyAmount: bigint; replacementAttoWeth: bigint }

/** All three amounts come from the selected venue at the same block, including the replacement report ratio. */
export async function quoteVenue(client: BatchReader, config: QuoteConfiguration, pool: Pool, amounts: QuoteAmounts, blockNumber: bigint) {
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
			if (firstToken !== pool.token.toLowerCase() && firstToken !== config.network.weth.toLowerCase()) throw new Error('Uniswap V2 pair has an unexpected token')
			const reserves = requiredTuple(batchValue(results[1], 'Uniswap V2 reserves'), 2, 'Uniswap V2 reserves')
			const reserve0 = requiredBigint(reserves[0], 'Uniswap V2 reserve0')
			const reserve1 = requiredBigint(reserves[1], 'Uniswap V2 reserve1')
			const [reserveToken, reserveWeth] = firstToken === pool.token.toLowerCase() ? [reserve0, reserve1] : [reserve1, reserve0]
			sell = settle(() => constantProductExactInput(amounts.sellAmount, reserveToken, reserveWeth))
			buy = settle(() => constantProductExactOutput(amounts.buyAmount, reserveWeth, reserveToken))
			replacement = settle(() => constantProductExactInput(amounts.replacementAttoWeth, reserveWeth, reserveToken))
		} else {
			let calls: BatchCall[]
			if (pool.venue === 'uniswap-v3') {
				if (config.router === undefined) throw new Error('Uniswap V3 is disabled')
				calls = [
					{ address: config.network.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: pool.token, tokenOut: config.network.weth, amountIn: amounts.sellAmount, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
					{ address: config.network.quoter, abi: quoterAbi, functionName: 'quoteExactOutputSingle', args: [{ tokenIn: config.network.weth, tokenOut: pool.token, amount: amounts.buyAmount, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
					{ address: config.network.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: config.network.weth, tokenOut: pool.token, amountIn: amounts.replacementAttoWeth, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
				]
			} else {
				if (config.v4PoolManager === undefined || config.v4Quoter === undefined || pool.address.toLowerCase() !== config.v4PoolManager.toLowerCase()) throw new Error('Uniswap V4 is disabled or has an unexpected PoolManager')
				const plan = v4QuotePlan(pool.token, pool.fee, amounts.sellAmount, amounts.buyAmount)
				const replacementPlan = v4QuotePlan(pool.token, pool.fee, amounts.sellAmount, amounts.replacementAttoWeth)
				calls = [
					{ address: config.v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [plan.sell] },
					{ address: config.v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactOutputSingle', args: [plan.buy] },
					{ address: config.v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [replacementPlan.buy] },
				]
			}
			const results = await batchRead(client, config.network.multicall3, calls, blockNumber)
			const amount = (index: number) => requiredBigint(requiredTuple(batchValue(results[index], 'Venue quote'), 1, 'Venue quote')[0], 'Venue quote amount')
			sell = settle(() => amount(0))
			buy = settle(() => amount(1))
			replacement = settle(() => amount(2))
		}
	} catch (error) {
		failure = errorMessage(error)
	}
	return { sell, buy, replacement, failure }
}
