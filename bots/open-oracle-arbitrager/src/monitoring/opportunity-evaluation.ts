import { getAddress, getBalanceAtBlock, getTransactionCountAtBlock, readContractAtBlock, type Address, zeroAddress } from '#ethereum'
import { constantProductFactoryAbi, constantProductPairAbi, erc20Abi, factoryAbi, openOracleAbi, poolAbi, quoterAbi, v4QuoterAbi } from '#contracts/abi'
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
import type { OpenOracleStatePreimage } from '@zoltar/shared/openOracle'

const FEES = STANDARD_UNISWAP_FEES
const UNISWAP_V2_FACTORY = getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f')

export function candidateRiskMismatch(candidate: ExecutionCandidate, positions: readonly PositionRecord[], limits: RiskLimits, now = new Date()) {
	return positionRiskLimitMismatch({ capitalAtRiskAttoWeth: candidate.capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: candidate.projectedGasCostAttoWeth }, limits, now)
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
	const liquidity = requiredBigint(blockNumber === undefined ? await client.readContract(liquidityParameters) : await readContractAtBlock(client.transport, liquidityParameters, blockNumber), 'Uniswap liquidity')
	if (liquidity === 0n) return undefined
	const slot0Parameters = {
		address,
		abi: poolAbi,
		functionName: 'slot0',
	} as const
	const slot0 = requiredTuple(blockNumber === undefined ? await client.readContract(slot0Parameters) : await readContractAtBlock(client.transport, slot0Parameters, blockNumber), 2, 'Uniswap slot0')
	const observationParameters = {
		address,
		abi: poolAbi,
		functionName: 'observe',
		args: [[twapSeconds, 0]],
	} as const
	const observation = requiredTuple(blockNumber === undefined ? await client.readContract(observationParameters) : await readContractAtBlock(client.transport, observationParameters, blockNumber), 1, 'Uniswap observation')
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

export async function poolsForToken(client: ReadClient, config: Configuration, token: Address) {
	const pools: Pool[] = []
	let v2Pair: Address | undefined
	if (config.v2Router !== undefined && config.network.chain.id === 1) {
		try {
			const pair = await client.readContract({
				address: UNISWAP_V2_FACTORY,
				abi: constantProductFactoryAbi,
				functionName: 'getPair',
				args: [config.network.weth, token],
			})
			if (pair !== zeroAddress) v2Pair = pair
		} catch (error) {
			console.error(`venue=uniswap-v2 skipped=${errorMessage(error)}`)
		}
	}
	for (const fee of FEES) {
		try {
			const address = await client.readContract({
				address: config.network.factory,
				abi: factoryAbi,
				functionName: 'getPool',
				args: [config.network.weth, token, fee],
			})
			if (address === zeroAddress) continue
			const pool = await loadPool(client, address, token, fee, config.twapSeconds)
			if (pool !== undefined) pools.push({ ...pool, v2Pair })
		} catch (error) {
			console.error(`poolFee=${fee.toString()} skipped=${errorMessage(error)}`)
		}
	}
	return pools
}

export async function quoteInput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number, blockNumber?: bigint | undefined) {
	const parameters = {
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(parameters) : await readContractAtBlock(client.transport, parameters, blockNumber), 1, 'Uniswap exact-input quote')
	return requiredBigint(result[0], 'Uniswap exact-input amount')
}

async function quoteOutput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amount: bigint, fee: number, blockNumber?: bigint | undefined) {
	const parameters = {
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [{ tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96: 0n }],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(parameters) : await readContractAtBlock(client.transport, parameters, blockNumber), 1, 'Uniswap exact-output quote')
	return requiredBigint(result[0], 'Uniswap exact-output amount')
}

async function constantProductReserves(client: ReadClient, pair: Address, token: Address, blockNumber?: bigint | undefined) {
	const token0Parameters = { address: pair, abi: constantProductPairAbi, functionName: 'token0' } as const
	const reservesParameters = { address: pair, abi: constantProductPairAbi, functionName: 'getReserves' } as const
	const [token0, reservesValue] = await Promise.all([
		blockNumber === undefined ? client.readContract(token0Parameters) : readContractAtBlock(client.transport, token0Parameters, blockNumber),
		blockNumber === undefined ? client.readContract(reservesParameters) : readContractAtBlock(client.transport, reservesParameters, blockNumber),
	])
	const reserves = requiredTuple(reservesValue, 2, 'Uniswap V2 reserves')
	const reserve0 = requiredBigint(reserves[0], 'Uniswap V2 reserve0')
	const reserve1 = requiredBigint(reserves[1], 'Uniswap V2 reserve1')
	if (typeof token0 !== 'string') throw new Error('Uniswap V2 token0 is invalid')
	return getAddress(token0).toLowerCase() === token.toLowerCase() ? { reserveToken: reserve0, reserveWeth: reserve1 } : { reserveToken: reserve1, reserveWeth: reserve0 }
}

async function quoteV4ExactInput(client: ReadClient, quoter: Address, parameters: ReturnType<typeof v4QuotePlan>['sell'], blockNumber?: bigint | undefined) {
	const contractParameters = {
		address: quoter,
		abi: v4QuoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [parameters],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(contractParameters) : await readContractAtBlock(client.transport, contractParameters, blockNumber), 1, 'Uniswap V4 exact-input quote')
	return requiredBigint(result[0], 'Uniswap V4 exact-input amount')
}

async function quoteV4ExactOutput(client: ReadClient, quoter: Address, parameters: ReturnType<typeof v4QuotePlan>['buy'], blockNumber?: bigint | undefined) {
	const contractParameters = {
		address: quoter,
		abi: v4QuoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [parameters],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(contractParameters) : await readContractAtBlock(client.transport, contractParameters, blockNumber), 1, 'Uniswap V4 exact-output quote')
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

export async function evaluate(client: ReadClient, config: Configuration, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint, marketBlock: { hash: `0x${string}`; number: bigint; observedAt: number }) {
	const game = report.game
	const gasCost = gasPrice * 1_200_000n
	const lifecycleGasReserveAttoWeth = projectedLifecycleGasReserveAttoWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
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
	const v3Settled = await Promise.allSettled([
		(async () => safetyAdjustedQuote(evaluateSellRep(game, await quoteInput(client, config.network.quoter, pool.token, config.network.weth, game.currentAmount2, pool.fee, marketBlock.number), 0n), gasCost, lifecycleGasReserveAttoWeth, config))(),
		(async () => safetyAdjustedQuote(evaluateBuyRep(game, await quoteOutput(client, config.network.quoter, config.network.weth, pool.token, repWithFees, pool.fee, marketBlock.number), 0n), gasCost, lifecycleGasReserveAttoWeth, config))(),
	])
	for (const result of v3Settled) if (result.status === 'rejected') console.error(`pool=${pool.address} quoteSkipped=${errorMessage(result.reason)}`)
	const v3Sell = v3Settled[0]?.status === 'fulfilled' ? v3Settled[0].value : undefined
	const v3Buy = v3Settled[1]?.status === 'fulfilled' ? v3Settled[1].value : undefined
	const v3 = selectBestExecution([...(v3Sell === undefined ? [] : [v3Sell]), ...(v3Buy === undefined ? [] : [v3Buy])], candidate => candidate.netProfitAttoWeth)
	observeVenue('uniswap-v3', pool.address, v3Sell, v3Buy)
	if (v3 !== undefined) candidates.push({ hedgeFee: pool.fee, hedgePool: pool.address, quote: v3, venue: 'uniswap-v3' })
	if (pool.v2Pair !== undefined) {
		try {
			const reserves = await constantProductReserves(client, pool.v2Pair, pool.token, marketBlock.number)
			const v2Sell = safetyAdjustedQuote(evaluateSellRep(game, constantProductExactInput(game.currentAmount2, reserves.reserveToken, reserves.reserveWeth), 0n), gasCost, lifecycleGasReserveAttoWeth, config)
			const v2Buy = safetyAdjustedQuote(evaluateBuyRep(game, constantProductExactOutput(repWithFees, reserves.reserveWeth, reserves.reserveToken), 0n), gasCost, lifecycleGasReserveAttoWeth, config)
			const v2 = selectBestExecution([v2Sell, v2Buy], candidate => candidate.netProfitAttoWeth)
			observeVenue('uniswap-v2', pool.v2Pair, v2Sell, v2Buy)
			if (v2 !== undefined) candidates.push({ hedgeFee: 3_000, hedgePool: pool.v2Pair, quote: v2, venue: 'uniswap-v2' })
		} catch (error) {
			console.error(`pool=${pool.v2Pair} quoteSkipped=${errorMessage(error)}`)
		}
	}
	if (config.v4PoolManager !== undefined && config.v4Quoter !== undefined) {
		const v4Quoter = config.v4Quoter
		for (const plan of standardV4QuotePlans(pool.token, game.currentAmount2, repWithFees)) {
			const v4Settled = await Promise.allSettled([
				(async () => safetyAdjustedQuote(evaluateSellRep(game, await quoteV4ExactInput(client, v4Quoter, plan.sell, marketBlock.number), 0n), gasCost, lifecycleGasReserveAttoWeth, config))(),
				(async () => safetyAdjustedQuote(evaluateBuyRep(game, await quoteV4ExactOutput(client, v4Quoter, plan.buy, marketBlock.number), 0n), gasCost, lifecycleGasReserveAttoWeth, config))(),
			])
			for (const result of v4Settled) if (result.status === 'rejected') console.error(`poolManager=${config.v4PoolManager} fee=${plan.fee.toString()} quoteSkipped=${errorMessage(result.reason)}`)
			const v4Sell = v4Settled[0]?.status === 'fulfilled' ? v4Settled[0].value : undefined
			const v4Buy = v4Settled[1]?.status === 'fulfilled' ? v4Settled[1].value : undefined
			const v4 = selectBestExecution([...(v4Sell === undefined ? [] : [v4Sell]), ...(v4Buy === undefined ? [] : [v4Buy])], candidate => candidate.netProfitAttoWeth)
			observeVenue('uniswap-v4', config.v4PoolManager, v4Sell, v4Buy)
			if (v4 !== undefined) candidates.push({ hedgeFee: plan.fee, hedgePool: config.v4PoolManager, quote: v4, venue: 'uniswap-v4' })
		}
	}
	return { candidate: selectBestExecution(candidates, candidate => candidate.quote.netProfitAttoWeth), observations }
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
			readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'oracleGame', args: [report.helper.reportId] }, blockNumber),
			loadPool(readClient, pool.address, pool.token, pool.fee, config.twapSeconds, blockNumber),
			quoteInput(readClient, config.network.quoter, config.network.weth, pool.token, newAmount1, pool.fee, blockNumber),
			hedgeQuotes,
			getTransactionCountAtBlock(readClient.transport, { address: account, blockNumber }),
			getBalanceAtBlock(readClient.transport, { address: account, blockNumber }),
			readContractAtBlock(readClient.transport, { address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			readContractAtBlock(readClient.transport, { address: game.token2, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			readContractAtBlock(readClient.transport, { address: game.token1, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
			readContractAtBlock(readClient.transport, { address: game.token2, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
			readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token1] }, blockNumber),
			readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token2] }, blockNumber),
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
