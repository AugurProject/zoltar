import type { ExecutionCandidate } from '#core/operator-types'
import { executionTokenAllowed } from '#execution/execution-orchestration'
import { dateFromBlockTimestamp } from '#execution/recovery-support'
import { logMarketDiscoveryFailure } from '#monitoring/market-discovery-status'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import { candidateRiskMismatch } from '#monitoring/opportunity-evaluation'
import { inspectReport } from '#monitoring/report-inspection'
import { decimalSignedEth, recordOperation, type OperatorState } from '#state/operator-state'
import type { OpportunitySnapshot } from '#state/opportunity-snapshot'
import { archivedUtcDayGasSpentWeth } from '#state/position-store'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution, centralizedPriceDeviationBps, marketConsensusSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { estimateMarketConsensus, marketConsensusAllowsExecution, marketConsensusDeviationBps, type MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { HeadMarkets } from './head-markets.ts'
import { recordScanDecision } from './operator-execution-state.ts'
import type { OperatorContext, OperatorRuntime, ScanBlock } from './operator-runtime.ts'
import type { ReconciledSettlementJournal } from './settlement-stage.ts'

type InspectedReport = { evaluated: Awaited<ReturnType<typeof inspectReport>>; report: ActiveReport }
type EvaluatedReport = NonNullable<InspectedReport['evaluated']>

function recordReportEvaluationFailure(state: OperatorState, reportId: string, error: unknown) {
	logMarketDiscoveryFailure(`report=${reportId} skipped=`, error)
	recordOperation(state, {
		category: 'decision',
		details: undefined,
		level: 'warning',
		message: 'Report evaluation failed',
		reason: errorMessage(error),
		reportId,
	})
}

/** Inspects every unsettled report against the pinned head; any failed inspection fails the whole head. */
export async function inspectActiveReports(runtime: OperatorRuntime, context: OperatorContext, block: ScanBlock, markets: HeadMarkets, executionReady: boolean, gasPrice: bigint): Promise<InspectedReport[]> {
	const { config, state } = context
	return await Promise.all(
		[...runtime.reports.values()]
			.filter(report => !report.settled)
			.map(async report => {
				const reportId = report.latest.helper.reportId.toString()
				try {
					const metadata = markets.tokenMarkets.find(market => market.address.toLowerCase() === report.latest.game.token2.toLowerCase())
					if (metadata === undefined) throw new Error('Token metadata is unavailable')
					const evaluated = await inspectReport(
						runtime.client,
						runtime.wallet,
						config,
						report.latest,
						markets.pools,
						block.number,
						block.hash,
						block.timestamp,
						gasPrice,
						markets.balances?.raw,
						metadata,
						executionTokenAllowed(markets.executionTokens, report.latest.game.token2),
						executionReady,
						state.paused,
						runtime.coordinatorPolicies,
						(message, reason, details) =>
							recordOperation(state, {
								category: 'decision',
								details,
								level: 'info',
								message,
								reason,
								reportId,
							}),
					)
					return { evaluated, report }
				} catch (error) {
					recordReportEvaluationFailure(state, reportId, error)
					throw error
				}
			}),
	)
}

/**
 * Applies the market-consensus guard and the risk limits to one inspected candidate, recording why it was blocked.
 * Returns the candidate only when both allow execution.
 */
function gateCandidate(runtime: OperatorRuntime, context: OperatorContext, evaluated: EvaluatedReport, block: ScanBlock, reconciledSettlements: ReconciledSettlementJournal): ExecutionCandidate | undefined {
	const { config, state } = context
	const candidate = evaluated.candidate
	if (candidate === undefined) return undefined
	const referenceWeth = candidate.quote.direction === 'sell-rep' ? candidate.quote.grossProceedsAttoWeth : candidate.quote.hedgeCostAttoWeth
	const dexPriceRepPerEth = referenceWeth === 0n ? 0n : (candidate.quote.hedgeAmountAttoRep * 10n ** 18n) / referenceWeth
	const primaryRep = candidate.report.game.token2.toLowerCase() === config.network.rep.toLowerCase()
	evaluated.opportunity.centralizedPriceDeviationBps = state.centralizedMarket === undefined ? undefined : centralizedPriceDeviationBps(dexPriceRepPerEth, state.centralizedMarket, candidate.report.game.token2)?.toString()
	const venueConsensus = config.centralizedMarkets.venueConsensus
	const consensusEstimate =
		venueConsensus === undefined
			? undefined
			: estimateMarketConsensus(
					[...(state.marketObservations ?? []), ...evaluated.dexObservations].filter(observation => observation.assetId.toLowerCase() === evaluated.candidate?.report.game.token2.toLowerCase() && observation.marketId?.toLowerCase() !== evaluated.candidate?.hedgePool.toLowerCase()),
					marketConsensusSettings(config.centralizedMarkets),
					candidate.report.game.token2,
					config.network.chain.id,
					Date.now(),
					candidate.hedgeVenue,
					candidate.hedgePool,
				)
	let marketAllowed = false
	if (centralizedMarketConfigurationAllowsExecution(config.centralizedMarkets)) {
		if (consensusEstimate === undefined) {
			marketAllowed = !config.centralizedMarkets.requiredForExecution && centralizedPriceAllowsExecution(dexPriceRepPerEth, state.centralizedMarket, config.centralizedMarkets, candidate.report.game.token2)
		} else {
			marketAllowed = marketConsensusAllowsExecution(
				dexPriceRepPerEth,
				consensusEstimate,
				{
					maximumDeviationBps: config.centralizedMarkets.maximumDexDeviationBps,
					maximumObservationAgeMilliseconds: config.centralizedMarkets.maximumObservationAgeMilliseconds,
					requiredForExecution: config.centralizedMarkets.requiredForExecution,
				},
				candidate.report.game.token2,
				config.network.chain.id,
			)
		}
	}
	if (consensusEstimate !== undefined) evaluated.opportunity.centralizedPriceDeviationBps = marketConsensusDeviationBps(dexPriceRepPerEth, consensusEstimate, candidate.report.game.token2)?.toString()
	candidate.marketConsensus = consensusEstimate
	if (!marketAllowed) {
		evaluated.opportunity.decision = 'market-risk'
		recordOperation(state, {
			category: 'decision',
			details: `dexRepPerEth=${decimalSignedEth(dexPriceRepPerEth)}`,
			level: 'warning',
			message: 'Market consensus guard blocked report',
			reason: primaryRep ? 'Executable price was not confirmed by independent CEX and leave-one-out DEX consensus' : 'Required market consensus is unavailable for this REP token',
			reportId: evaluated.opportunity.reportId,
		})
		return undefined
	}
	const riskDate = dateFromBlockTimestamp(block.timestamp)
	const mismatch = candidateRiskMismatch(candidate, runtime.positions, config.riskLimits, riskDate, archivedUtcDayGasSpentWeth(runtime.positionJournal.archived, riskDate) + reconciledSettlements.gasSpentAttoEthOnUtcDay(riskDate))
	if (mismatch === undefined) return candidate
	evaluated.opportunity.decision = 'risk-limit'
	recordOperation(state, {
		category: 'decision',
		details: undefined,
		level: 'warning',
		message: 'Risk limit blocked report',
		reason: mismatch,
		reportId: evaluated.opportunity.reportId,
	})
	return undefined
}

/**
 * Records each inspected report's decision and gates its candidate. Returns `undefined` when `stopHead` reports a
 * shutdown between reports; otherwise the opportunities, the executable candidates, and this cycle's DEX observations.
 */
export function gateReportCandidates(runtime: OperatorRuntime, context: OperatorContext, inspectedReports: readonly InspectedReport[], block: ScanBlock, reconciledSettlements: ReconciledSettlementJournal, stopHead: () => boolean) {
	const opportunities: OpportunitySnapshot[] = []
	const candidates: ExecutionCandidate[] = []
	const cycleDexObservations: MarketConsensusObservation[] = []
	for (const { evaluated, report } of inspectedReports) {
		if (stopHead()) return undefined
		try {
			if (evaluated !== undefined) {
				cycleDexObservations.push(...evaluated.dexObservations)
				opportunities.push(evaluated.opportunity)
				recordScanDecision(context.state, evaluated.opportunity)
				const candidate = gateCandidate(runtime, context, evaluated, block, reconciledSettlements)
				if (candidate !== undefined) candidates.push(candidate)
			}
		} catch (error) {
			recordReportEvaluationFailure(context.state, report.latest.helper.reportId.toString(), error)
			throw error
		}
	}
	return { candidates, cycleDexObservations, opportunities }
}
