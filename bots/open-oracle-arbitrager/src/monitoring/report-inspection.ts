import { formatEther, type Address } from '#ethereum'
import { OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { type Configuration } from '#config/configuration'
import { opportunityDecision } from '#execution/execution-orchestration'
import { gamePolicyMismatch, type CoordinatorGamePolicy } from '#core/game-policy'
import { decimalSignedEth, decimalWeth, type OpportunitySnapshot } from '#state/operator-state'
import { formatTokenAmount } from '#monitoring/market-monitor'
import { requireCanonicalBlock, type MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import { projectedLifecycleGasReserveWethAttoEth } from '#core/safety-controls'
import { calculateNextAmount1, deriveTokenToSwap, executorFunding, fundedCapitalAtRiskWethAttoEth, hedgeWethLimitAttoEth, meetsProfitThreshold, spotTwapDeviationWithinLimit, type ArbitrageQuote } from '#core/strategy'
import type { Venue } from '#core/venue-strategy'
import type { EvaluatedOpportunity, Pool, RawBalances, ReadClient, WriteClient } from '#core/operator-types'
import { evaluate, quoteInput } from '#monitoring/opportunity-evaluation'
import { STANDARD_UNISWAP_FEES } from '#core/uniswap-v4'

const FEES = STANDARD_UNISWAP_FEES

export async function inspectReport(
	client: ReadClient,
	wallet: WriteClient | undefined,
	config: Configuration,
	report: OpenOracleStatePreimage,
	pools: readonly Pool[],
	blockNumber: bigint,
	blockHash: `0x${string}`,
	blockTimestamp: bigint,
	gasPrice: bigint,
	balances: RawBalances | undefined,
	tokenMetadata: { decimals: number; symbol: string },
	executionTokenIsAllowed: boolean,
	executionReady: boolean,
	paused: boolean,
	coordinatorPolicies: readonly CoordinatorGamePolicy[],
	recordDecision: (message: string, reason: string) => void,
): Promise<EvaluatedOpportunity | undefined> {
	const game = report.game
	const policyMismatch = gamePolicyMismatch(report, coordinatorPolicies, config.openOracle)
	if (policyMismatch !== undefined) {
		recordDecision('Skipped report', policyMismatch)
		return
	}
	if (game.token1.toLowerCase() !== config.network.weth.toLowerCase() || !pools.some(pool => pool.token.toLowerCase() === game.token2.toLowerCase())) {
		recordDecision('Skipped report', 'Token pair is not WETH plus a configured token with a usable pool')
		return
	}
	if (config.execute && !executionTokenIsAllowed) {
		recordDecision('Skipped report', 'Report token was observed permissionlessly and is not in the execution allowlist')
		return
	}
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? blockTimestamp : blockNumber
	if (currentTime < game.reportTimestamp + game.disputeDelay || currentTime >= game.reportTimestamp + game.settlementTime) {
		recordDecision('Skipped report', 'Report is outside its dispute window')
		return
	}
	const timeRemaining = game.reportTimestamp + game.settlementTime - currentTime
	const minimumRemaining = timeType ? config.minimumRemainingSeconds : config.minimumRemainingBlocks
	if (timeRemaining < minimumRemaining) {
		console.log(`report=${report.helper.reportId.toString()} skipped=insufficient-inclusion-window remaining=${timeRemaining.toString()}`)
		recordDecision('Skipped report', `Only ${timeRemaining.toString()} ${timeType ? 'seconds' : 'blocks'} remain`)
		return
	}
	let best: { hedgeFee: (typeof FEES)[number]; hedgePool: Address; pool: Pool; quote: ArbitrageQuote; venue: Venue } | undefined
	const dexObservations: MarketConsensusObservation[] = []
	for (const pool of pools) {
		if (pool.token.toLowerCase() !== game.token2.toLowerCase()) continue
		if (!spotTwapDeviationWithinLimit(pool.spotTick, pool.twapTick, config.maxSpotTwapTicks)) continue
		const evaluation = await evaluate(client, config, report, pool, gasPrice, { hash: blockHash, number: blockNumber, observedAt: Number(blockTimestamp) * 1_000 })
		dexObservations.push(...evaluation.observations)
		if (evaluation.candidate === undefined) continue
		if (best === undefined || evaluation.candidate.quote.netProfitWethAttoEth > best.quote.netProfitWethAttoEth) best = { ...evaluation.candidate, pool }
	}
	if (best === undefined) {
		console.log(`report=${report.helper.reportId.toString()} skipped=no-trusted-liquid-pool`)
		recordDecision('Skipped report', 'No active pool passed quote and spot/TWAP checks')
		return
	}
	const newAmount1 = calculateNextAmount1(game)
	const replacementAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, best.pool.token, newAmount1, best.pool.fee, blockNumber)
	await requireCanonicalBlock(blockNumber, blockHash, async canonicalBlockNumber => (await client.getBlock({ blockNumber: canonicalBlockNumber })).hash)
	const replacementTokenToSwap = deriveTokenToSwap(game, newAmount1, replacementAmount2)
	if (replacementTokenToSwap.toLowerCase() !== best.quote.tokenToSwap.toLowerCase()) {
		console.log(`report=${report.helper.reportId.toString()} skipped=replacement-ratio-direction-mismatch`)
		recordDecision('Skipped report', 'Replacement ratio selected a different swap direction')
		return
	}
	const hedgeLimitQuote = best.quote.direction === 'sell-rep' ? best.quote.grossProceedsWethAttoEth : best.quote.hedgeCostWethAttoEth
	const hedgeLimit = hedgeWethLimitAttoEth(best.quote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, replacementAmount2, best.quote.direction === 'buy-rep' ? hedgeLimit : 0n)
	const tokenBalance = balances?.tokens.get(game.token2.toLowerCase())
	const hasRequiredInventory = balances === undefined || tokenBalance === undefined ? undefined : balances.wethAttoEth >= funding.token1 && tokenBalance >= funding.token2
	const capitalAtRiskWethAttoEth = fundedCapitalAtRiskWethAttoEth(funding, best.quote.hedgeAmountAttoRep, hedgeLimitQuote, hedgeLimit)
	const profitable = meetsProfitThreshold(best.quote, config.minimumProfitWethAttoEth, config.minimumProfitBps)
	const decision = opportunityDecision({
		account: wallet?.account.address,
		currentReporter: game.currentReporter,
		execute: config.execute,
		executionReady,
		hasRequiredInventory,
		paused,
		profitable,
	})
	const executableReferenceWeth = best.quote.direction === 'sell-rep' ? best.quote.grossProceedsWethAttoEth : best.quote.hedgeCostWethAttoEth
	const executablePriceRepPerEth = executableReferenceWeth === 0n ? 0n : (best.quote.hedgeAmountAttoRep * 10n ** 18n) / executableReferenceWeth
	console.log([`report=${report.helper.reportId.toString()}`, `direction=${best.quote.direction}`, `venue=${best.venue}`, `pool=${best.hedgePool}`, `fee=${best.hedgeFee.toString()}`, `profitWeth=${formatEther(best.quote.netProfitWethAttoEth)}`, `decision=${decision}`].join(' '))
	const opportunity = {
		centralizedPriceDeviationBps: undefined,
		decision,
		direction: best.quote.direction,
		estimatedNetProfitEth: decimalSignedEth(best.quote.netProfitWethAttoEth),
		estimatedNetProfitWeth: decimalSignedEth(best.quote.netProfitWethAttoEth),
		executablePriceRepPerEth: decimalSignedEth(executablePriceRepPerEth),
		hasRequiredInventory,
		pool: best.hedgePool,
		poolFee: best.hedgeFee,
		reportId: report.helper.reportId.toString(),
		requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
		requiredWeth: decimalWeth(funding.token1),
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
		timeRemaining: timeRemaining.toString(),
		venue: best.venue,
		windowUnit: timeType ? 'seconds' : 'blocks',
	} satisfies OpportunitySnapshot
	const projectedLifecycleGas = projectedLifecycleGasReserveWethAttoEth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveWethAttoEth: config.riskLimits.lifecycleGasReserveWethAttoEth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const candidate = decision === 'eligible' ? { capitalAtRiskWethAttoEth, hedgeFee: best.hedgeFee, hedgePool: best.hedgePool, hedgeVenue: best.venue, opportunity, pool: best.pool, projectedGasCostWethAttoEth: gasPrice * 1_200_000n + projectedLifecycleGas, quote: best.quote, report } : undefined
	return { candidate, dexObservations, opportunity }
}
