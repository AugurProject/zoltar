import type { Configuration } from '#config/configuration'
import { erc20Abi, openOracleAbi } from '#contracts/abi'
import type { BatchReader } from '#core/batch-read'
import type { ExecutionCandidate, Pool, ReadClient } from '#core/operator-types'
import { requiredBigint, requiredHash } from '#core/rpc-validation'
import { adjustedNetProfitWeth, positionRiskLimitMismatch, projectedLifecycleGasReserveAttoWeth, type RiskLimits } from '#core/safety-controls'
import { calculateFee, calculateNextAmount1, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, hedgeReferenceToken1, hedgeSlippageReserveToken1, type ArbitrageQuote } from '#core/strategy'
import { attoWethValue, type CollateralValuation } from '#core/collateral-valuation'
import { resolveCollateralValuation } from '#monitoring/collateral-valuation'
import type { Venue } from '#core/venue-strategy'
import { selectBestExecution, settledExecutionSnapshotWithQuorum } from '#execution/execution-orchestration'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'
import { loadV3Pool } from '#monitoring/execution-pools'
import { executableVenueQuotes, quoteVenue } from '#monitoring/venue-quotes'
import type { PositionRecord } from '#state/position-store'
import { readContractAtBlock, type Address } from '@zoltar/bot-shared/ethereum'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

export function candidateRiskMismatch(candidate: ExecutionCandidate, positions: readonly PositionRecord[], limits: RiskLimits, now = new Date(), archivedDailyGasSpentAttoWeth = 0n) {
	return positionRiskLimitMismatch({ archivedDailyGasSpentAttoWeth, capitalAtRiskAttoWeth: candidate.capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: candidate.projectedGasCostAttoWeth }, limits, now)
}

export function safetyAdjustedQuote(quote: ArbitrageQuote, gasCost: bigint, lifecycleGasReserveAttoWeth: bigint, config: Pick<Configuration, 'maxHedgeSlippageBps'>) {
	const slippageReserveAttoWeth = attoWethValue(quote.valuation, hedgeSlippageReserveToken1(quote.direction, hedgeReferenceToken1(quote), config.maxHedgeSlippageBps), 'up')
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

export type EvaluationConfiguration = Pick<Configuration, 'maxPriceImpactBps' | 'maxHedgeSlippageBps' | 'network' | 'riskLimits' | 'submission' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter'>

/**
 * Quotes one pool against the report's collateral. Profits are valued in WETH with `valuation`; only WETH-quoted pools
 * contribute REP/ETH market observations, because a collateral pool's price would depend on the valuation pool rather
 * than being independent evidence.
 */
export async function evaluate(client: BatchReader, config: EvaluationConfiguration, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint, marketBlock: { hash: `0x${string}`; number: bigint; observedAt: number }, valuation: CollateralValuation) {
	const game = report.game
	const quotes = await quoteVenue(client, config, pool, { sellAmount: game.currentAmount2, buyAmount: game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee), replacementAmount1: calculateNextAmount1(game) }, marketBlock.number)
	const reserve = projectedLifecycleGasReserveAttoWeth({ callbackGasLimit: BigInt(game.callbackGasLimit), configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth, gasPrice, submissionMode: config.submission.mode })
	const adjusted = (quote: ArbitrageQuote) => safetyAdjustedQuote(quote, gasPrice * 1_200_000n, reserve, config)
	const sell = quotes.sell === undefined ? undefined : adjusted(evaluateSellRep(game, quotes.sell, 0n, valuation))
	const buy = quotes.buy === undefined ? undefined : adjusted(evaluateBuyRep(game, quotes.buy, 0n, valuation))
	const observations: MarketConsensusObservation[] = []
	if (pool.quoteToken.toLowerCase() === config.network.weth.toLowerCase() && sell !== undefined && buy !== undefined && sell.grossProceedsToken1 > 0n && buy.hedgeCostToken1 > 0n)
		observations.push({
			assetId: game.token2,
			askDepthAttoEth: buy.hedgeCostToken1,
			bidDepthAttoEth: sell.grossProceedsToken1,
			blockHash: marketBlock.hash,
			blockNumber: marketBlock.number,
			chainId: config.network.chain.id,
			kind: 'dex',
			marketId: pool.address,
			observationId: `${config.network.chain.id.toString()}:${marketBlock.number.toString()}:${marketBlock.hash.toLowerCase()}`,
			observedAt: marketBlock.observedAt,
			priceRepPerEth: ((game.currentAmount2 * 10n ** 18n) / sell.grossProceedsToken1 + ((game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)) * 10n ** 18n) / buy.hedgeCostToken1) / 2n,
			sourceId: pool.venue,
		})
	const replacementToken = quotes.replacement === undefined ? undefined : deriveTokenToSwap(game, calculateNextAmount1(game), quotes.replacement)
	const quote = selectBestExecution(
		[...(sell === undefined ? [] : [sell]), ...(buy === undefined ? [] : [buy])].filter(candidate => candidate.tokenToSwap.toLowerCase() === replacementToken?.toLowerCase()),
		candidate => candidate.netProfitAttoWeth,
	)
	return { candidate: quote === undefined || executableVenueQuotes(quotes) === undefined ? undefined : { hedgeFee: pool.fee, hedgePool: pool.address, quote, venue: pool.venue }, observations, replacementAmount2: quotes.replacement, replacementQuoteFailure: quotes.failure, quoteFailureSummary: quotes.failureSummary }
}

export async function executionReadQuorum(
	clients: readonly ReadClient[],
	config: Pick<Configuration, 'collateralTokens' | 'network' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter' | 'connectivity' | 'quorumRpcUrls' | 'rpcQuorum' | 'executor' | 'openOracle' | 'twapSeconds' | 'maxPriceImpactBps' | 'maxSpotTwapTicks'>,
	report: OpenOracleStatePreimage,
	pool: Pool,
	hedgeVenue: Venue,
	hedgeFee: Pool['fee'],
	blockNumber: bigint,
	account: Address,
) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const executor = config.executor
	if (executor === undefined) throw new Error('Execution quorum requires the authenticated executor')
	const game = report.game
	const newAmount1 = calculateNextAmount1(game)
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	const observations = clients.map(async (readClient, index) => {
		if (pool.venue !== hedgeVenue || pool.fee !== hedgeFee) throw new Error('Execution venue does not match the selected pool')
		if (pool.quoteToken.toLowerCase() !== game.token1.toLowerCase()) throw new Error('Execution pool does not trade the report collateral')
		const collateral = await resolveCollateralValuation(readClient, config, game.token1, blockNumber)
		if (collateral.kind !== 'valued') throw new Error(`Report collateral cannot be valued: ${collateral.reason}`)
		const quotes = await quoteVenue(readClient, config, pool, { sellAmount: game.currentAmount2, buyAmount: repWithFees, replacementAmount1: newAmount1 }, blockNumber)
		const executable = executableVenueQuotes(quotes)
		if (executable === undefined) throw new Error(`Selected venue quote failed: ${quotes.failure ?? 'missing quote'}`)
		const [block, stateHash, v3State, nonce, eth, token1, token, allowance1, allowance2, internalAllowance1, internalAllowance2] = await Promise.all([
			readClient.getBlock({ blockNumber }),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'oracleGame', args: [report.helper.reportId] }, blockNumber),
			pool.venue === 'uniswap-v3' ? loadV3Pool(readClient, pool.address, pool.token, pool.quoteToken, pool.fee, config.twapSeconds, blockNumber) : undefined,
			readClient.getTransactionCount({ address: account, blockNumber }),
			readClient.getBalance({ address: account, blockNumber }),
			readContractAtBlock(readClient, { address: game.token1, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			readContractAtBlock(readClient, { address: game.token2, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			readContractAtBlock(readClient, { address: game.token1, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
			readContractAtBlock(readClient, { address: game.token2, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token1] }, blockNumber),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token2] }, blockNumber),
		])
		if (block.hash == null || (pool.venue === 'uniswap-v3' && v3State === undefined)) throw new Error('RPC quorum snapshot is missing a canonical block or active pool')
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
				buyHedgeQuote: executable.buy,
				eth: requiredBigint(eth, 'Execution account ETH balance'),
				nonce,
				v3State,
				replacementAmount2: executable.replacement,
				sellHedgeQuote: executable.sell,
				stateHash: requiredHash(stateHash, 'OpenOracle report state'),
				token: requiredBigint(token, 'Execution account report-token balance'),
				token1: requiredBigint(token1, 'Execution account collateral balance'),
				valuation: collateral.valuation,
			},
		}
	})
	return settledExecutionSnapshotWithQuorum(blockNumber, observations, config.rpcQuorum)
}
