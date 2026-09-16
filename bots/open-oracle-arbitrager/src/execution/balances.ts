import type { Configuration } from '#config/configuration'
import { erc20Abi, multicall3Abi } from '#contracts/abi'
import { batchRead, batchValue, type BatchReader } from '#core/batch-read'
import type { Pool, WriteClient } from '#core/operator-types'
import { requiredBigint } from '#core/rpc-validation'
import { quoteVenue } from '#monitoring/venue-quotes'
import { decimalWeth, type BalanceSnapshot } from '#state/operator-state'
import type { Address } from '@zoltar/bot-shared/ethereum'

/** Reads wallet inventory in one batched call at the scanned block, then values the REP balance across the enabled venue candidates. */
export async function loadBalances(client: BatchReader, wallet: Pick<WriteClient, 'account'> | undefined, config: Pick<Configuration, 'network' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter'>, tokens: readonly Address[], pools: readonly Pool[], blockNumber: bigint) {
	if (wallet === undefined) return undefined
	const address = wallet.account.address
	const results = await batchRead(
		client,
		config.network.multicall3,
		[
			{ address: config.network.multicall3, abi: multicall3Abi, functionName: 'getEthBalance', args: [address] },
			{ address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
			{ address: config.network.rep, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
			...tokens.map(token => ({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })),
		],
		blockNumber,
	)
	const ethAttoEth = requiredBigint(batchValue(results[0], 'Wallet ETH balance'), 'Wallet ETH balance')
	const attoWeth = requiredBigint(batchValue(results[1], 'Wallet WETH balance'), 'Wallet WETH balance')
	const repAttoRep = requiredBigint(batchValue(results[2], 'Wallet REP balance'), 'Wallet REP balance')
	const tokenBalances = new Map<string, bigint>()
	for (const [index, token] of tokens.entries()) {
		const result = results[3 + index]
		if (result === undefined || result.status === 'failure') {
			console.error(`token=${token} balanceUnavailable=${result === undefined ? 'missing balance read' : result.error.message}`)
			continue
		}
		tokenBalances.set(token.toLowerCase(), requiredBigint(result.result, `Token ${token} balance`))
	}
	const raw = { ethAttoEth, repAttoRep, tokens: tokenBalances, attoWeth }
	let repValueAttoWeth: bigint | undefined
	if (repAttoRep === 0n) repValueAttoWeth = 0n
	else {
		const quotes = await Promise.all(pools.filter(pool => pool.token.toLowerCase() === config.network.rep.toLowerCase()).map(pool => quoteVenue(client, config, pool, { sellAmount: repAttoRep, buyAmount: 1n, replacementAttoWeth: 1n }, blockNumber)))
		for (const quote of quotes) if (quote.sell !== undefined && (repValueAttoWeth === undefined || quote.sell > repValueAttoWeth)) repValueAttoWeth = quote.sell
	}
	const snapshot: BalanceSnapshot = {
		availableEth: decimalWeth(ethAttoEth),
		availableRep: decimalWeth(repAttoRep),
		availableWeth: decimalWeth(attoWeth),
		repValueWeth: repValueAttoWeth === undefined ? undefined : decimalWeth(repValueAttoWeth),
		totalValueWeth: repValueAttoWeth === undefined ? undefined : decimalWeth(ethAttoEth + attoWeth + repValueAttoWeth),
	}
	return { raw, snapshot }
}
