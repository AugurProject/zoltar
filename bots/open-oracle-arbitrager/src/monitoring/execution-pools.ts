import type { Configuration } from '#config/configuration'
import { poolAbi } from '#contracts/abi'
import { batchRead, batchValue, type BatchReader } from '#core/batch-read'
import type { Pool, ReadClient } from '#core/operator-types'
import { requiredBigint, requiredBigintArray, requiredTuple } from '#core/rpc-validation'
import { STANDARD_UNISWAP_FEES } from '#core/uniswap-v4'
import type { DiscoveredTokenPools } from '#monitoring/market-monitor'
import { readContractAtBlock, type Address } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'

function meanTick(tickCumulatives: readonly bigint[], seconds: bigint) {
	const oldTick = tickCumulatives[0]
	const newTick = tickCumulatives[1]
	if (oldTick === undefined || newTick === undefined) throw new Error('Uniswap observation returned fewer than two ticks')
	const delta = newTick - oldTick
	let quotient = delta / seconds
	if (delta < 0n && delta % seconds !== 0n) quotient -= 1n
	return quotient
}

export async function loadV3Pool(client: ReadClient, address: Address, token: Address, fee: Pool['fee'], twapSeconds: number, blockNumber?: bigint | undefined): Promise<Extract<Pool, { venue: 'uniswap-v3' }> | undefined> {
	const liquidityParameters = {
		address,
		abi: poolAbi,
		functionName: 'liquidity',
	} as const
	const liquidity = requiredBigint(blockNumber === undefined ? await client.readContract(liquidityParameters) : await readContractAtBlock(client, liquidityParameters, blockNumber), 'Uniswap liquidity')
	if (liquidity === 0n) return undefined
	const slot0Parameters = {
		address,
		abi: poolAbi,
		functionName: 'slot0',
	} as const
	const slot0 = requiredTuple(blockNumber === undefined ? await client.readContract(slot0Parameters) : await readContractAtBlock(client, slot0Parameters, blockNumber), 2, 'Uniswap slot0')
	const observationParameters = {
		address,
		abi: poolAbi,
		functionName: 'observe',
		args: [[twapSeconds, 0]],
	} as const
	const observation = requiredTuple(blockNumber === undefined ? await client.readContract(observationParameters) : await readContractAtBlock(client, observationParameters, blockNumber), 1, 'Uniswap observation')
	const tickCumulatives = requiredBigintArray(observation[0], 'Uniswap tick cumulatives')
	return {
		venue: 'uniswap-v3',
		address,
		fee,
		liquidity,
		spotTick: requiredBigint(slot0[1], 'Uniswap current tick'),
		token,
		twapTick: meanTick(tickCumulatives, BigInt(twapSeconds)),
	}
}

/**
 * Builds independent candidates for each enabled venue. V3 candidates require liquidity and TWAP state;
 * V2 reserves and candidate V4 pool keys are checked by their size-specific quotes.
 */
export async function poolsForTokens(client: BatchReader, config: Pick<Configuration, 'network' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter' | 'twapSeconds'>, discovered: readonly DiscoveredTokenPools[], blockNumber?: bigint) {
	const candidates = config.router === undefined ? [] : discovered.flatMap(entry => entry.v3.map(pool => ({ ...pool, token: entry.token })))
	const results = await batchRead(
		client,
		config.network.multicall3,
		candidates.flatMap(pool => [
			{ address: pool.address, abi: poolAbi, functionName: 'liquidity' },
			{ address: pool.address, abi: poolAbi, functionName: 'slot0' },
			{ address: pool.address, abi: poolAbi, functionName: 'observe', args: [[config.twapSeconds, 0]] },
		]),
		blockNumber,
	)
	const pools: Pool[] = []
	for (const [index, candidate] of candidates.entries()) {
		try {
			const liquidity = requiredBigint(batchValue(results[index * 3], 'Uniswap liquidity'), 'Uniswap liquidity')
			if (liquidity === 0n) continue
			const slot0 = requiredTuple(batchValue(results[index * 3 + 1], 'Uniswap slot0'), 2, 'Uniswap slot0')
			const observation = requiredTuple(batchValue(results[index * 3 + 2], 'Uniswap observation'), 1, 'Uniswap observation')
			pools.push({
				venue: 'uniswap-v3',
				address: candidate.address,
				fee: candidate.fee,
				liquidity,
				spotTick: requiredBigint(slot0[1], 'Uniswap current tick'),
				token: candidate.token,
				twapTick: meanTick(requiredBigintArray(observation[0], 'Uniswap tick cumulatives'), BigInt(config.twapSeconds)),
			})
		} catch (error) {
			console.error(`poolFee=${candidate.fee.toString()} skipped=${errorMessage(error)}`)
		}
	}
	for (const entry of discovered) {
		if (config.v2Router !== undefined) for (const pair of entry.constantProduct.filter(pair => pair.kind === 'uniswap-v2')) pools.push({ address: pair.address, fee: 3_000, token: entry.token, venue: 'uniswap-v2' })
		if (config.v4PoolManager !== undefined && config.v4Quoter !== undefined) for (const fee of STANDARD_UNISWAP_FEES) pools.push({ address: config.v4PoolManager, fee, token: entry.token, venue: 'uniswap-v4' })
	}
	return pools
}
