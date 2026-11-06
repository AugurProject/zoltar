import { quoteBestExactInputWithSource } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'

/** Exercise the production route selector with exactly one candidate pool. */
export async function quoteSinglePool(client: Parameters<typeof quoteBestExactInputWithSource>[0], tokenIn: Parameters<typeof quoteBestExactInputWithSource>[1], tokenOut: Parameters<typeof quoteBestExactInputWithSource>[2], amount: bigint, pool = { fee: 3000, tickSpacing: 60 }) {
	return (await quoteBestExactInputWithSource(client, tokenIn, tokenOut, amount, [pool])).amountOut
}
