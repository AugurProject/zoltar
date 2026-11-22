import { bigintToSafeNumber, formatEther, formatUnits, type Address } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import type { Configuration } from '#config/configuration'
import { opportunityDecision } from '#execution/execution-orchestration'
import { gamePolicyMismatch, type CoordinatorGamePolicy } from '#core/game-policy'
import { decimalSignedEth } from '#state/operator-state'
import type { EvaluatedOpportunitySnapshot } from '#state/opportunity-snapshot'
import { formatTokenAmount } from '#monitoring/market-monitor'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import { projectedLifecycleGasReserveAttoWeth } from '#core/safety-controls'
import { calculateNextAmount1, deriveTokenToSwap, executableDexPriceRepPerEth, executorFunding, fundedCapitalAtRiskAttoWeth, hedgeReferenceToken1, hedgeWethLimitAttoEth, meetsProfitThreshold, spotTwapDeviationWithinLimit, type ArbitrageQuote } from '#core/strategy'
import { allowlistedCollateral, unlistedCollateralReason } from '#core/collateral-valuation'
import { resolveCollateralValuation } from '#monitoring/collateral-valuation'
import { venueLabel, type Venue } from '#core/venue-strategy'
import type { Pool, RawBalances, ReportInspection, SkippedReport, WriteClient } from '#core/operator-types'
import type { BatchReader } from '#core/batch-read'
import { evaluate, type EvaluationConfiguration } from '#monitoring/opportunity-evaluation'
import { STANDARD_UNISWAP_FEES } from '#core/uniswap-v4'

const FEES = STANDARD_UNISWAP_FEES

export type ReportInspectionConfiguration = EvaluationConfiguration & Pick<Configuration, 'collateralTokens' | 'execute' | 'maxSpotTwapTicks' | 'twapSeconds' | 'minimumProfitAttoWeth' | 'minimumProfitBps' | 'minimumRemainingBlocks' | 'minimumRemainingSeconds' | 'openOracle'>

export async function inspectReport(
	client: BatchReader,
	wallet: Pick<WriteClient, 'account'> | undefined,
	config: ReportInspectionConfiguration,
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
	recordDecision: (message: string, reason: string, details?: string | undefined) => void,
	/** Metadata of a non-WETH report collateral; WETH needs none. */
	collateralMetadata?: { decimals: number; symbol: string } | undefined,
): Promise<ReportInspection | undefined> {
	const game = report.game
	const reportId = report.helper.reportId.toString()
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const windowUnit = timeType ? 'seconds' : 'blocks'
	const currentTime = timeType ? blockTimestamp : blockNumber
	const settlementDeadline = game.reportTimestamp + game.settlementTime
	// A report past its settlement deadline, off its coordinator template, or collateralized by a token the operator did not allowlist is never an opportunity, so it stays log-only.
	if (currentTime >= settlementDeadline) {
		recordDecision('Skipped report', 'Report is outside its dispute window')
		return
	}
	const policyMismatch = gamePolicyMismatch(report, coordinatorPolicies, config.openOracle)
	if (policyMismatch !== undefined) {
		recordDecision('Skipped report', policyMismatch)
		return
	}
	const wethCollateral = game.token1.toLowerCase() === config.network.weth.toLowerCase()
	if (!wethCollateral && allowlistedCollateral(config.collateralTokens, game.token1) === undefined) {
		recordDecision('Skipped report', unlistedCollateralReason(game.token1))
		return
	}
	const collateral = wethCollateral ? { decimals: 18, symbol: 'WETH' } : collateralMetadata
	const timeRemaining = settlementDeadline - currentTime
	// Every later skip is a live report on supported collateral; it stays visible in the scan with its reason instead of surviving only in the operation log.
	const skipped = (reason: string, reasonDetails?: string | undefined): SkippedReport => {
		recordDecision('Skipped report', reason, reasonDetails)
		return {
			candidate: undefined,
			dexObservations: [],
			opportunity: {
				...(wethCollateral || collateral === undefined ? {} : { collateralSymbol: collateral.symbol }),
				decision: 'skipped',
				reason,
				...(reasonDetails === undefined ? {} : { reasonDetails }),
				reportId,
				token: game.token2,
				tokenSymbol: tokenMetadata.symbol,
				timeRemaining: timeRemaining.toString(),
				windowUnit,
			},
		}
	}
	if (collateral === undefined) return skipped(`Collateral token ${game.token1} metadata is unavailable`)
	// Position journals store collateral amounts as decimals with at most 18 places.
	if (collateral.decimals > 18) return skipped(`Collateral token ${collateral.symbol} has more than 18 decimals`)
	const tokenPools = pools.filter(pool => pool.token.toLowerCase() === game.token2.toLowerCase() && pool.quoteToken.toLowerCase() === game.token1.toLowerCase())
	if (tokenPools.length === 0) return skipped(wethCollateral ? `No configured pool can price ${tokenMetadata.symbol}` : `No configured pool can price ${tokenMetadata.symbol} against ${collateral.symbol}`)
	if (config.execute && !executionTokenIsAllowed) return skipped('Report token was observed permissionlessly and is not in the execution allowlist')
	const disputableAt = game.reportTimestamp + game.disputeDelay
	if (currentTime < disputableAt) return skipped(`Dispute delay has not elapsed; disputable in ${(disputableAt - currentTime).toString()} ${windowUnit}`)
	const minimumRemaining = timeType ? config.minimumRemainingSeconds : config.minimumRemainingBlocks
	if (timeRemaining < minimumRemaining) {
		console.log(`report=${reportId} skipped=insufficient-inclusion-window remaining=${timeRemaining.toString()}`)
		return skipped(`Only ${timeRemaining.toString()} ${windowUnit} remain; the strategy requires at least ${minimumRemaining.toString()}`)
	}
	const valuation = await resolveCollateralValuation(client, config, game.token1, blockNumber)
	if (valuation.kind !== 'valued') return skipped(valuation.reason)
	let best: { hedgeFee: (typeof FEES)[number]; hedgePool: Address; pool: Pool; quote: ArbitrageQuote; replacementAmount2: bigint | undefined; replacementQuoteFailure: string | undefined; venue: Venue } | undefined
	const dexObservations: MarketConsensusObservation[] = []
	const marketBlock = { hash: blockHash, number: blockNumber, observedAt: bigintToSafeNumber(blockTimestamp * 1_000n, 'Report block timestamp') }
	const stablePools = tokenPools.filter(pool => pool.venue !== 'uniswap-v3' || spotTwapDeviationWithinLimit(pool.spotTick, pool.twapTick, config.maxSpotTwapTicks))
	const evaluations = await Promise.all(stablePools.map(async pool => ({ evaluation: await evaluate(client, config, report, pool, gasPrice, marketBlock, valuation.valuation), pool })))
	for (const { evaluation, pool } of evaluations) {
		dexObservations.push(...evaluation.observations)
		if (evaluation.candidate === undefined) continue
		if (best === undefined || evaluation.candidate.quote.netProfitAttoWeth > best.quote.netProfitAttoWeth) best = { ...evaluation.candidate, pool, replacementAmount2: evaluation.replacementAmount2, replacementQuoteFailure: evaluation.replacementQuoteFailure }
	}
	if (best === undefined) {
		console.log(`report=${reportId} skipped=no-trusted-liquid-pool`)
		const failure = noVenueReason(tokenPools.length, evaluations, config.maxSpotTwapTicks)
		return skipped(failure.reason, failure.details)
	}
	const newAmount1 = calculateNextAmount1(game)
	const replacementAmount2 = best.replacementAmount2
	if (replacementAmount2 === undefined) throw new Error(`Uniswap replacement exact-input quote failed for pool ${best.pool.address}: ${best.replacementQuoteFailure ?? 'unknown failure'}`)
	const replacementTokenToSwap = deriveTokenToSwap(game, newAmount1, replacementAmount2)
	if (replacementTokenToSwap.toLowerCase() !== best.quote.tokenToSwap.toLowerCase()) {
		console.log(`report=${reportId} skipped=replacement-ratio-direction-mismatch`)
		return skipped('Replacement ratio selected a different swap direction')
	}
	const hedgeLimitQuote = hedgeReferenceToken1(best.quote)
	const hedgeLimit = hedgeWethLimitAttoEth(best.quote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, replacementAmount2, best.quote.direction === 'buy-rep' ? hedgeLimit : 0n)
	const tokenBalance = balances?.tokens.get(game.token2.toLowerCase())
	const collateralBalance = wethCollateral ? balances?.attoWeth : balances?.tokens.get(game.token1.toLowerCase())
	const hasRequiredInventory = collateralBalance === undefined || tokenBalance === undefined ? undefined : collateralBalance >= funding.token1 && tokenBalance >= funding.token2
	const capitalAtRiskAttoWeth = fundedCapitalAtRiskAttoWeth(funding, best.quote.hedgeAmountAttoRep, hedgeLimitQuote, hedgeLimit, best.quote.valuation)
	const profitable = meetsProfitThreshold(best.quote, config.minimumProfitAttoWeth, config.minimumProfitBps)
	const decision = opportunityDecision({
		account: wallet?.account.address,
		currentReporter: game.currentReporter,
		execute: config.execute,
		executionReady,
		hasRequiredInventory,
		paused,
		profitable,
	})
	const executablePriceRepPerEth = executableDexPriceRepPerEth(best.quote)
	console.log([`report=${reportId}`, `direction=${best.quote.direction}`, `venue=${best.venue}`, `pool=${best.hedgePool}`, `fee=${best.hedgeFee.toString()}`, `profitWeth=${formatEther(best.quote.netProfitAttoWeth)}`, `decision=${decision}`].join(' '))
	const opportunity = {
		centralizedPriceDeviationBps: undefined,
		...(wethCollateral ? {} : { collateralSymbol: collateral.symbol }),
		decision,
		direction: best.quote.direction,
		estimatedNetProfitEth: decimalSignedEth(best.quote.netProfitAttoWeth),
		estimatedNetProfitWeth: decimalSignedEth(best.quote.netProfitAttoWeth),
		executablePriceRepPerEth: decimalSignedEth(executablePriceRepPerEth),
		hasRequiredInventory,
		pool: best.hedgePool,
		poolFee: best.hedgeFee,
		reportId,
		requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
		requiredWeth: formatUnits(funding.token1, collateral.decimals),
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
		timeRemaining: timeRemaining.toString(),
		venue: best.venue,
		windowUnit,
	} satisfies EvaluatedOpportunitySnapshot
	const projectedLifecycleGas = projectedLifecycleGasReserveAttoWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const candidate = decision === 'eligible' ? { capitalAtRiskAttoWeth, hedgeFee: best.hedgeFee, hedgePool: best.hedgePool, hedgeVenue: best.venue, opportunity, pool: best.pool, projectedGasCostAttoWeth: gasPrice * 1_200_000n + projectedLifecycleGas, quote: best.quote, report } : undefined
	return { candidate, dexObservations, opportunity }
}

/** Names the concrete gate that left a report without an executable venue so the operator can act on it. */
function noVenueReason(tokenPoolCount: number, evaluations: readonly { evaluation: Awaited<ReturnType<typeof evaluate>>; pool: Pool }[], maxSpotTwapTicks: bigint) {
	const drifted = tokenPoolCount - evaluations.length
	const driftedReason = drifted === 0 ? [] : [`${drifted.toString()} ${drifted === 1 ? 'pool exceeds' : 'pools exceed'} the ${maxSpotTwapTicks.toString()} tick spot/TWAP limit`]
	const failures = evaluations.map(({ evaluation, pool }) => `${venueLabel(pool.venue)} ${pool.address} (fee ${pool.fee.toString()}): ${evaluation.replacementQuoteFailure ?? 'no executable quote'}`)
	const summaries = [...new Set(evaluations.map(({ evaluation, pool }) => `${venueLabel(pool.venue)}: ${evaluation.quoteFailureSummary ?? 'No executable quote'}`))]
	return {
		reason: [...summaries, ...driftedReason].join('; '),
		details: failures.length === 0 ? undefined : failures.join('\n'),
	}
}
