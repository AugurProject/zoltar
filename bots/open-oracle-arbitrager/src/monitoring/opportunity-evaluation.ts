import type { Configuration } from '#config/configuration'
import { erc20Abi, openOracleAbi } from '#contracts/abi'
import type { BatchReader } from '#core/batch-read'
import type { ExecutionCandidate, Pool, ReadClient } from '#core/operator-types'
import { requiredBigint, requiredHash } from '#core/rpc-validation'
import { adjustedNetProfitWeth, positionRiskLimitMismatch, projectedLifecycleGasReserveAttoWeth, type RiskLimits } from '#core/safety-controls'
import { calculateFee, calculateNextAmount1, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, hedgeSlippageReserveAttoWeth, type ArbitrageQuote } from '#core/strategy'
import type { Venue } from '#core/venue-strategy'
import { selectBestExecution, settledExecutionSnapshotWithQuorum } from '#execution/execution-orchestration'
import { endpointLabel } from '#monitoring/connectivity'
import { loadV3Pool } from '#monitoring/execution-pools'
import { quoteVenue } from '#monitoring/venue-quotes'
import type { PositionRecord } from '#state/position-store'
import { readContractAtBlock, type Address } from '@zoltar/bot-shared/ethereum'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

export function candidateRiskMismatch(candidate: ExecutionCandidate, positions: readonly PositionRecord[], limits: RiskLimits, now = new Date(), archivedDailyGasSpentAttoWeth = 0n) {
	return positionRiskLimitMismatch({ archivedDailyGasSpentAttoWeth, capitalAtRiskAttoWeth: candidate.capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: candidate.projectedGasCostAttoWeth }, limits, now)
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

export type EvaluationConfiguration = Pick<Configuration, 'maxHedgeSlippageBps' | 'network' | 'riskLimits' | 'submission' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter'>

export async function evaluate(client: BatchReader, config: EvaluationConfiguration, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint, marketBlock: { hash: `0x${string}`; number: bigint; observedAt: number }) {
	const game = report.game
	const quotes = await quoteVenue(client, config, pool, { sellAmount: game.currentAmount2, buyAmount: game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee), replacementAttoWeth: calculateNextAmount1(game) }, marketBlock.number)
	const reserve = projectedLifecycleGasReserveAttoWeth({ callbackGasLimit: BigInt(game.callbackGasLimit), configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth, gasPrice, submissionMode: config.submission.mode })
	const adjusted = (quote: ArbitrageQuote) => safetyAdjustedQuote(quote, gasPrice * 1_200_000n, reserve, config)
	const sell = quotes.sell === undefined ? undefined : adjusted(evaluateSellRep(game, quotes.sell, 0n))
	const buy = quotes.buy === undefined ? undefined : adjusted(evaluateBuyRep(game, quotes.buy, 0n))
	const observations: MarketConsensusObservation[] = []
	if (sell !== undefined && buy !== undefined && sell.grossProceedsAttoWeth > 0n && buy.hedgeCostAttoWeth > 0n)
		observations.push({
			assetId: game.token2,
			askDepthAttoEth: buy.hedgeCostAttoWeth,
			bidDepthAttoEth: sell.grossProceedsAttoWeth,
			blockHash: marketBlock.hash,
			blockNumber: marketBlock.number,
			chainId: config.network.chain.id,
			kind: 'dex',
			marketId: pool.address,
			observationId: `${config.network.chain.id.toString()}:${marketBlock.number.toString()}:${marketBlock.hash.toLowerCase()}`,
			observedAt: marketBlock.observedAt,
			priceRepPerEth: ((game.currentAmount2 * 10n ** 18n) / sell.grossProceedsAttoWeth + ((game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)) * 10n ** 18n) / buy.hedgeCostAttoWeth) / 2n,
			sourceId: pool.venue,
		})
	const replacementToken = quotes.replacement === undefined ? undefined : deriveTokenToSwap(game, calculateNextAmount1(game), quotes.replacement)
	const quote = selectBestExecution(
		[...(sell === undefined ? [] : [sell]), ...(buy === undefined ? [] : [buy])].filter(candidate => candidate.tokenToSwap.toLowerCase() === replacementToken?.toLowerCase()),
		candidate => candidate.netProfitAttoWeth,
	)
	return { candidate: quote === undefined || quotes.replacement === undefined ? undefined : { hedgeFee: pool.fee, hedgePool: pool.address, quote, venue: pool.venue }, observations, replacementAmount2: quotes.replacement, replacementQuoteFailure: quotes.failure }
}

export async function executionReadQuorum(
	clients: readonly ReadClient[],
	config: Pick<Configuration, 'network' | 'router' | 'v2Router' | 'v4PoolManager' | 'v4Quoter' | 'connectivity' | 'quorumRpcUrls' | 'executor' | 'openOracle' | 'twapSeconds'>,
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
		const quotes = await quoteVenue(readClient, config, pool, { sellAmount: game.currentAmount2, buyAmount: repWithFees, replacementAttoWeth: newAmount1 }, blockNumber)
		if (quotes.sell === undefined || quotes.buy === undefined || quotes.replacement === undefined) throw new Error(`Selected venue quote failed: ${quotes.failure ?? 'missing quote'}`)
		const [block, stateHash, v3State, nonce, eth, weth, token, allowance1, allowance2, internalAllowance1, internalAllowance2] = await Promise.all([
			readClient.getBlock({ blockNumber }),
			readContractAtBlock(readClient, { address: config.openOracle, abi: openOracleAbi, functionName: 'oracleGame', args: [report.helper.reportId] }, blockNumber),
			pool.venue === 'uniswap-v3' ? loadV3Pool(readClient, pool.address, pool.token, pool.fee, config.twapSeconds, blockNumber) : undefined,
			readClient.getTransactionCount({ address: account, blockNumber }),
			readClient.getBalance({ address: account, blockNumber }),
			readContractAtBlock(readClient, { address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
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
				buyHedgeQuote: quotes.buy,
				eth: requiredBigint(eth, 'Execution account ETH balance'),
				nonce,
				v3State,
				replacementAmount2: quotes.replacement,
				sellHedgeQuote: quotes.sell,
				stateHash: requiredHash(stateHash, 'OpenOracle report state'),
				token: requiredBigint(token, 'Execution account report-token balance'),
				weth: requiredBigint(weth, 'Execution account WETH balance'),
			},
		}
	})
	return settledExecutionSnapshotWithQuorum(blockNumber, observations)
}
