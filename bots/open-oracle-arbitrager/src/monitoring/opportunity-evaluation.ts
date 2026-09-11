import { getAddress, readContractAtBlock, type Address } from '@zoltar/bot-shared/ethereum'
import { batchRead, batchValue, type BatchCall, type BatchReader, type BatchResult } from '#core/batch-read'
import type { DiscoveredTokenPools } from '#monitoring/market-monitor'
import { constantProductPairAbi, erc20Abi, openOracleAbi, poolAbi, quoterAbi, v4QuoterAbi } from '#contracts/abi'
import type { Configuration } from '#config/configuration'
import { selectBestExecution, settledExecutionSnapshotWithQuorum } from '#execution/execution-orchestration'
import type { ExecutionCandidate, Pool, ReadClient } from '#core/operator-types'
import { errorMessage, requiredBigint, requiredBigintArray, requiredHash, requiredTuple } from '#core/rpc-validation'
import { adjustedNetProfitWeth, positionRiskLimitMismatch, projectedLifecycleGasReserveAttoWeth, type RiskLimits } from '#core/safety-controls'
import { calculateFee, calculateNextAmount1, evaluateBuyRep, evaluateSellRep, hedgeSlippageReserveAttoWeth, type ArbitrageQuote } from '#core/strategy'
import { STANDARD_UNISWAP_FEES, standardV4QuotePlans, v4QuotePlan } from '#core/uniswap-v4'
import { constantProductExactInput, constantProductExactOutput, type Venue } from '#core/venue-strategy'
import type { PositionRecord } from '#state/position-store'
import { endpointLabel } from '#monitoring/connectivity'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

const FEES = STANDARD_UNISWAP_FEES

export function candidateRiskMismatch(candidate: ExecutionCandidate, positions: readonly PositionRecord[], limits: RiskLimits, now = new Date(), archivedDailyGasSpentAttoWeth = 0n) {
	return positionRiskLimitMismatch({ archivedDailyGasSpentAttoWeth, capitalAtRiskAttoWeth: candidate.capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: candidate.projectedGasCostAttoWeth }, limits, now)
}

function meanTick(tickCumulatives: readonly bigint[], seconds: bigint) {
	const oldTick = tickCumulatives[0]
	const newTick = tickCumulatives[1]
	if (oldTick === undefined || newTick === undefined) throw new Error('Uniswap observation returned fewer than two ticks')
	const delta = newTick - oldTick
	let quotient = delta / seconds
	if (delta < 0n && delta % seconds !== 0n) quotient -= 1n
	return quotient
}

async function loadPool(client: ReadClient, address: Address, token: Address, fee: Pool['fee'], twapSeconds: number, blockNumber?: bigint | undefined): Promise<Pool | undefined> {
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
		address,
		fee,
		liquidity,
		spotTick: requiredBigint(slot0[1], 'Uniswap current tick'),
		token,
		twapTick: meanTick(tickCumulatives, BigInt(twapSeconds)),
	}
}

/**
 * Loads liquidity, spot, and TWAP state for every discovered Uniswap V3 pool in one batched read.
 * Pools without liquidity are dropped; a pool whose reads fail is logged and skipped like before.
 */
export async function poolsForTokens(client: BatchReader, config: Pick<Configuration, 'network' | 'v2Router' | 'twapSeconds'>, discovered: readonly DiscoveredTokenPools[], blockNumber?: bigint) {
	const candidates = discovered.flatMap(entry => {
		const v2Pair = config.v2Router === undefined ? undefined : entry.constantProduct.find(pool => pool.kind === 'uniswap-v2')?.address
		return entry.v3.map(pool => ({ ...pool, token: entry.token, v2Pair }))
	})
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
				address: candidate.address,
				fee: candidate.fee,
				liquidity,
				spotTick: requiredBigint(slot0[1], 'Uniswap current tick'),
				token: candidate.token,
				twapTick: meanTick(requiredBigintArray(observation[0], 'Uniswap tick cumulatives'), BigInt(config.twapSeconds)),
				v2Pair: candidate.v2Pair,
			})
		} catch (error) {
			console.error(`poolFee=${candidate.fee.toString()} skipped=${errorMessage(error)}`)
		}
	}
	return pools
}

async function quoteInput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number, blockNumber?: bigint | undefined) {
	const parameters = {
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(parameters) : await readContractAtBlock(client, parameters, blockNumber), 1, 'Uniswap exact-input quote')
	return requiredBigint(result[0], 'Uniswap exact-input amount')
}

async function quoteOutput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amount: bigint, fee: number, blockNumber?: bigint | undefined) {
	const parameters = {
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [{ tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96: 0n }],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(parameters) : await readContractAtBlock(client, parameters, blockNumber), 1, 'Uniswap exact-output quote')
	return requiredBigint(result[0], 'Uniswap exact-output amount')
}

function constantProductReservesFor(token0: unknown, reserves: readonly unknown[], token: Address) {
	const reserve0 = requiredBigint(reserves[0], 'Uniswap V2 reserve0')
	const reserve1 = requiredBigint(reserves[1], 'Uniswap V2 reserve1')
	if (typeof token0 !== 'string') throw new Error('Uniswap V2 token0 is invalid')
	return getAddress(token0).toLowerCase() === token.toLowerCase() ? { reserveToken: reserve0, reserveWeth: reserve1 } : { reserveToken: reserve1, reserveWeth: reserve0 }
}

async function constantProductReserves(client: ReadClient, pair: Address, token: Address, blockNumber?: bigint | undefined) {
	const token0Parameters = { address: pair, abi: constantProductPairAbi, functionName: 'token0' } as const
	const reservesParameters = { address: pair, abi: constantProductPairAbi, functionName: 'getReserves' } as const
	const [token0, reservesValue] = await Promise.all([blockNumber === undefined ? client.readContract(token0Parameters) : readContractAtBlock(client, token0Parameters, blockNumber), blockNumber === undefined ? client.readContract(reservesParameters) : readContractAtBlock(client, reservesParameters, blockNumber)])
	return constantProductReservesFor(token0, requiredTuple(reservesValue, 2, 'Uniswap V2 reserves'), token)
}

async function quoteV4ExactInput(client: ReadClient, quoter: Address, parameters: ReturnType<typeof v4QuotePlan>['sell'], blockNumber?: bigint | undefined) {
	const contractParameters = {
		address: quoter,
		abi: v4QuoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [parameters],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(contractParameters) : await readContractAtBlock(client, contractParameters, blockNumber), 1, 'Uniswap V4 exact-input quote')
	return requiredBigint(result[0], 'Uniswap V4 exact-input amount')
}

async function quoteV4ExactOutput(client: ReadClient, quoter: Address, parameters: ReturnType<typeof v4QuotePlan>['buy'], blockNumber?: bigint | undefined) {
	const contractParameters = {
		address: quoter,
		abi: v4QuoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [parameters],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(contractParameters) : await readContractAtBlock(client, contractParameters, blockNumber), 1, 'Uniswap V4 exact-output quote')
	return requiredBigint(result[0], 'Uniswap V4 exact-output amount')
}

export function safetyAdjustedQuote(quote: ArbitrageQuote, gasCost: bigint, lifecycleGasReserveAttoWeth: bigint, config: Pick<Configuration, 'maxHedgeSlippageBps'>) {
	const slippageReserveAttoWeth = hedgeSlippageReserveAttoWeth(quote.direction, quote.direction === 'sell-rep' ? quote.grossProceedsAttoWeth : quote.hedgeCostAttoWeth, config.maxHedgeSlippageBps)
	return {
		...quote,
		netProfitAttoWeth: adjustedNetProfitWeth({
			entryGasCostAttoWeth: gasCost,
			hedgeSlippageReserveAttoWeth: slippageReserveAttoWeth,
			lifecycleGasReserveAttoWeth,
			profitBeforeGasAttoWeth: quote.profitBeforeGasAttoWeth,
		}),
	}
}

function quoteAmount(result: BatchResult | undefined, description: string) {
	const value = requiredTuple(batchValue(result, description), 1, description)
	return requiredBigint(value[0], `${description} amount`)
}

/**
 * Quotes every hedge venue for one pool plus the replacement-ratio quote in a single batched read.
 * Individual venue quotes may revert (for example a fee tier without a V4 pool) without failing the pool.
 */
export type EvaluationConfiguration = Pick<Configuration, 'maxHedgeSlippageBps' | 'network' | 'riskLimits' | 'submission' | 'v4PoolManager' | 'v4Quoter'>

export async function evaluate(client: BatchReader, config: EvaluationConfiguration, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint, marketBlock: { hash: `0x${string}`; number: bigint; observedAt: number }) {
	const game = report.game
	const gasCost = gasPrice * 1_200_000n
	const lifecycleGasReserveAttoWeth = projectedLifecycleGasReserveAttoWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	const newAmount1 = calculateNextAmount1(game)
	const candidates: { hedgeFee: (typeof FEES)[number]; hedgePool: Address; quote: ArbitrageQuote; venue: Venue }[] = []
	const observations: MarketConsensusObservation[] = []
	const observeVenue = (venue: Venue, marketId: Address, sell: ArbitrageQuote | undefined, buy: ArbitrageQuote | undefined) => {
		if (sell === undefined || buy === undefined || sell.grossProceedsAttoWeth <= 0n || buy.hedgeCostAttoWeth <= 0n) return
		const sellPrice = (game.currentAmount2 * 10n ** 18n) / sell.grossProceedsAttoWeth
		const buyPrice = (repWithFees * 10n ** 18n) / buy.hedgeCostAttoWeth
		observations.push({
			assetId: game.token2,
			askDepthAttoEth: buy.hedgeCostAttoWeth,
			bidDepthAttoEth: sell.grossProceedsAttoWeth,
			blockHash: marketBlock.hash,
			blockNumber: marketBlock.number,
			chainId: config.network.chain.id,
			kind: 'dex',
			marketId,
			observationId: `${config.network.chain.id.toString()}:${marketBlock.number.toString()}:${marketBlock.hash.toLowerCase()}`,
			observedAt: marketBlock.observedAt,
			priceRepPerEth: (sellPrice + buyPrice) / 2n,
			sourceId: venue,
		})
	}
	const adjusted = (quote: ArbitrageQuote) => safetyAdjustedQuote(quote, gasCost, lifecycleGasReserveAttoWeth, config)
	const settledQuote = (compute: () => ArbitrageQuote, onFailure: (message: string) => void) => {
		try {
			return adjusted(compute())
		} catch (error) {
			onFailure(errorMessage(error))
			return undefined
		}
	}
	const v4Plans = config.v4PoolManager !== undefined && config.v4Quoter !== undefined ? standardV4QuotePlans(pool.token, game.currentAmount2, repWithFees) : []
	const v4Quoter = config.v4Quoter
	const calls: BatchCall[] = [
		{ address: config.network.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: pool.token, tokenOut: config.network.weth, amountIn: game.currentAmount2, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
		{ address: config.network.quoter, abi: quoterAbi, functionName: 'quoteExactOutputSingle', args: [{ tokenIn: config.network.weth, tokenOut: pool.token, amount: repWithFees, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
		{ address: config.network.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: config.network.weth, tokenOut: pool.token, amountIn: newAmount1, fee: pool.fee, sqrtPriceLimitX96: 0n }] },
		...(pool.v2Pair === undefined
			? []
			: [
					{ address: pool.v2Pair, abi: constantProductPairAbi, functionName: 'token0' },
					{ address: pool.v2Pair, abi: constantProductPairAbi, functionName: 'getReserves' },
				]),
		...(v4Quoter === undefined
			? []
			: v4Plans.flatMap(plan => [
					{ address: v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactInputSingle', args: [plan.sell] },
					{ address: v4Quoter, abi: v4QuoterAbi, functionName: 'quoteExactOutputSingle', args: [plan.buy] },
				])),
	]
	const results = await batchRead(client, config.network.multicall3, calls, marketBlock.number)
	const v3Sell = settledQuote(
		() => evaluateSellRep(game, quoteAmount(results[0], 'Uniswap exact-input quote'), 0n),
		message => console.error(`pool=${pool.address} quoteSkipped=${message}`),
	)
	const v3Buy = settledQuote(
		() => evaluateBuyRep(game, quoteAmount(results[1], 'Uniswap exact-output quote'), 0n),
		message => console.error(`pool=${pool.address} quoteSkipped=${message}`),
	)
	// The replacement quote only matters for the pool that wins; a failed quote is reported when that pool is chosen.
	const replacementQuote = results[2]
	const replacementAmount2 = replacementQuote === undefined || replacementQuote.status === 'failure' ? undefined : quoteAmount(replacementQuote, 'Uniswap replacement exact-input quote')
	let replacementQuoteFailure: string | undefined = 'missing batched quote'
	if (replacementQuote !== undefined) replacementQuoteFailure = replacementQuote.status === 'failure' ? replacementQuote.error.message : undefined
	const v3 = selectBestExecution([...(v3Sell === undefined ? [] : [v3Sell]), ...(v3Buy === undefined ? [] : [v3Buy])], candidate => candidate.netProfitAttoWeth)
	observeVenue('uniswap-v3', pool.address, v3Sell, v3Buy)
	if (v3 !== undefined) candidates.push({ hedgeFee: pool.fee, hedgePool: pool.address, quote: v3, venue: 'uniswap-v3' })
	let cursor = 3
	if (pool.v2Pair !== undefined) {
		const v2Pair = pool.v2Pair
		try {
			const token0 = batchValue(results[cursor], 'Uniswap V2 token0')
			const reservesValue = requiredTuple(batchValue(results[cursor + 1], 'Uniswap V2 reserves'), 2, 'Uniswap V2 reserves')
			const reserves = constantProductReservesFor(token0, reservesValue, pool.token)
			const v2Sell = adjusted(evaluateSellRep(game, constantProductExactInput(game.currentAmount2, reserves.reserveToken, reserves.reserveWeth), 0n))
			const v2Buy = adjusted(evaluateBuyRep(game, constantProductExactOutput(repWithFees, reserves.reserveWeth, reserves.reserveToken), 0n))
			const v2 = selectBestExecution([v2Sell, v2Buy], candidate => candidate.netProfitAttoWeth)
			observeVenue('uniswap-v2', v2Pair, v2Sell, v2Buy)
			if (v2 !== undefined) candidates.push({ hedgeFee: 3_000, hedgePool: v2Pair, quote: v2, venue: 'uniswap-v2' })
		} catch (error) {
			console.error(`pool=${v2Pair} quoteSkipped=${errorMessage(error)}`)
		}
		cursor += 2
	}
	if (config.v4PoolManager !== undefined && v4Quoter !== undefined) {
		const v4PoolManager = config.v4PoolManager
		for (const plan of v4Plans) {
			const failure = (message: string) => console.error(`poolManager=${v4PoolManager} fee=${plan.fee.toString()} quoteSkipped=${message}`)
			const v4Sell = settledQuote(() => evaluateSellRep(game, quoteAmount(results[cursor], 'Uniswap V4 exact-input quote'), 0n), failure)
			const v4Buy = settledQuote(() => evaluateBuyRep(game, quoteAmount(results[cursor + 1], 'Uniswap V4 exact-output quote'), 0n), failure)
			cursor += 2
			const v4 = selectBestExecution([...(v4Sell === undefined ? [] : [v4Sell]), ...(v4Buy === undefined ? [] : [v4Buy])], candidate => candidate.netProfitAttoWeth)
			observeVenue('uniswap-v4', v4PoolManager, v4Sell, v4Buy)
			if (v4 !== undefined) candidates.push({ hedgeFee: plan.fee, hedgePool: v4PoolManager, quote: v4, venue: 'uniswap-v4' })
		}
	}
	return { candidate: selectBestExecution(candidates, candidate => candidate.quote.netProfitAttoWeth), observations, replacementAmount2, replacementQuoteFailure }
}

export async function executionReadQuorum(clients: readonly ReadClient[], config: Configuration, report: OpenOracleStatePreimage, pool: Pool, hedgeVenue: Venue, hedgeFee: (typeof FEES)[number], blockNumber: bigint, account: Address) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const executor = config.executor
	if (executor === undefined) throw new Error('Execution quorum requires the authenticated executor')
	const game = report.game
	const newAmount1 = calculateNextAmount1(game)
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	const observations = clients.map(async (readClient, index) => {
		let hedgeQuotes: Promise<{ buyHedgeQuote: bigint; sellHedgeQuote: bigint }>
		if (hedgeVenue === 'uniswap-v2') {
			hedgeQuotes = (async () => {
				if (pool.v2Pair === undefined) throw new Error('Uniswap V2 execution is missing its authenticated pair')
				const reserves = await constantProductReserves(readClient, pool.v2Pair, pool.token, blockNumber)
				return {
					buyHedgeQuote: constantProductExactOutput(repWithFees, reserves.reserveWeth, reserves.reserveToken),
					sellHedgeQuote: constantProductExactInput(game.currentAmount2, reserves.reserveToken, reserves.reserveWeth),
				}
			})()
		} else if (hedgeVenue === 'uniswap-v4') {
			hedgeQuotes = (async () => {
				if (config.v4Quoter === undefined) throw new Error('Uniswap V4 execution is missing its authenticated quoter')
				const plan = v4QuotePlan(pool.token, hedgeFee, game.currentAmount2, repWithFees)
				return {
					buyHedgeQuote: await quoteV4ExactOutput(readClient, config.v4Quoter, plan.buy, blockNumber),
					sellHedgeQuote: await quoteV4ExactInput(readClient, config.v4Quoter, plan.sell, blockNumber),
				}
			})()
		} else {
			hedgeQuotes = Promise.all([quoteInput(readClient, config.network.quoter, pool.token, config.network.weth, game.currentAmount2, pool.fee, blockNumber), quoteOutput(readClient, config.network.quoter, config.network.weth, pool.token, repWithFees, pool.fee, blockNumber)]).then(([sellHedgeQuote, buyHedgeQuote]) => ({
				buyHedgeQuote,
				sellHedgeQuote,
			}))
		}
		const [block, stateHash, refreshedPool, replacementAmount2, refreshedHedgeQuotes, nonce, eth, weth, token, allowance1, allowance2, internalAllowance1, internalAllowance2] = await Promise.all([
			readClient.getBlock({ blockNumber }),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'oracleGame', args: [report.helper.reportId] }, blockNumber),
			loadPool(readClient, pool.address, pool.token, pool.fee, config.twapSeconds, blockNumber),
			quoteInput(readClient, config.network.quoter, config.network.weth, pool.token, newAmount1, pool.fee, blockNumber),
			hedgeQuotes,
			readClient.getTransactionCount({ address: account, blockNumber }),
			readClient.getBalance({ address: account, blockNumber }),
			readContractAtBlock(readClient, { address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			readContractAtBlock(readClient, { address: game.token2, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			readContractAtBlock(readClient, { address: game.token1, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
			readContractAtBlock(readClient, { address: game.token2, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token1] }, blockNumber),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token2] }, blockNumber),
		])
		if (block.hash == null || refreshedPool === undefined) throw new Error('RPC quorum snapshot is missing a canonical block or active pool')
		return {
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: {
				allowance1: requiredBigint(allowance1, 'Executor token1 allowance'),
				allowance2: requiredBigint(allowance2, 'Executor token2 allowance'),
				internalAllowance1: requiredBigint(internalAllowance1, 'Executor internal token1 allowance'),
				internalAllowance2: requiredBigint(internalAllowance2, 'Executor internal token2 allowance'),
				baseFeePerGas: block.baseFeePerGas ?? 0n,
				blockHash: block.hash,
				blockTimestamp: block.timestamp,
				buyHedgeQuote: refreshedHedgeQuotes.buyHedgeQuote,
				eth: requiredBigint(eth, 'Execution account ETH balance'),
				nonce,
				poolLiquidity: refreshedPool.liquidity,
				poolSpotTick: refreshedPool.spotTick,
				poolTwapTick: refreshedPool.twapTick,
				replacementAmount2,
				sellHedgeQuote: refreshedHedgeQuotes.sellHedgeQuote,
				stateHash: requiredHash(stateHash, 'OpenOracle report state'),
				token: requiredBigint(token, 'Execution account report-token balance'),
				weth: requiredBigint(weth, 'Execution account WETH balance'),
			},
		}
	})
	return settledExecutionSnapshotWithQuorum(blockNumber, observations)
}
