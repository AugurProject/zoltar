import { plannedGasPriceAttoEth, utcDayGasSpentWeth } from '#core/safety-controls'
import { canonicalBlockHashWithQuorum } from '#execution/execution-orchestration'
import { dateFromBlockTimestamp } from '#execution/recovery-support'
import { appendPriceHistory, missingPricePoints, pricePoints } from '#monitoring/market-monitor'
import { gameCapitalSnapshot } from '#state/operator-state'
import { countOpportunities } from '#state/opportunity-snapshot'
import { archivedUtcDayGasSpentWeth } from '#state/position-store'
import { bigintToSafeNumber } from '@zoltar/bot-shared/ethereum'
import { centralizedMarketConsensusObservations, marketConsensusSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { estimateMarketConsensus, mergeMarketObservations, requireCanonicalBlock } from '@zoltar/bot-shared/monitoring/market-consensus'
import { runDisputeStage } from './dispute-stage.ts'
import { discardDexEvidence, loadHeadMarkets } from './head-markets.ts'
import { readEndpoints, type OperatorContext, type OperatorRuntime, type ScanBlock, type ScanPass } from './operator-runtime.ts'
import { gateReportCandidates, inspectActiveReports } from './report-candidates.ts'
import { finalityAnchorForHead, type FinalityAnchor } from './scan-head.ts'
import { recoverPendingSettlements, runSettlementStage } from './settlement-stage.ts'

/** One head's scan state; `shutdownDuringHead` records that a stop request interrupted the evaluation. */
export type PinnedHeadScan = {
	block: ScanBlock
	discoversReportsFromCoordinators: boolean
	executionReady: boolean
	scan: ScanPass
	shutdownDuringHead: boolean
}

export type CompletedHead = { completedScan: ReturnType<typeof countOpportunities>; finalityAnchor: FinalityAnchor }

/**
 * Evaluates every report, executes at most one dispute, and runs the settlement stage, all pinned to the head block.
 * The canonical hash is revalidated once after the pinned reads. Returns `undefined` when a shutdown interrupted it.
 */
export async function evaluatePinnedHead(runtime: OperatorRuntime, context: OperatorContext, head: PinnedHeadScan): Promise<CompletedHead | undefined> {
	const { config, shutdown, state } = context
	const { block, scan } = head
	const blockNumber = block.number
	const stopHead = () => {
		if (shutdown?.isRequested() !== true) return false
		head.shutdownDuringHead = true
		return true
	}
	const markets = await loadHeadMarkets(runtime, context, block, stopHead)
	if (markets === undefined) return undefined
	const { balances, configuredDexMarkets, tokenMarkets } = markets
	const gasPrice = plannedGasPriceAttoEth(block.baseFeePerGas ?? 0n)
	const inspectedReports = await inspectActiveReports(runtime, context, block, markets, head.executionReady, gasPrice)
	if (stopHead()) return undefined
	// One canonical-hash check after all pinned reads confirms none of them straddled a head replacement.
	const [, headFinalityAnchor] = await Promise.all([
		requireCanonicalBlock(blockNumber, block.hash, async canonicalBlockNumber => canonicalBlockHashWithQuorum(runtime.readClients, readEndpoints(config), 'market snapshot final revalidation', canonicalBlockNumber, config.rpcQuorum)).catch(error => discardDexEvidence(context, error)),
		finalityAnchorForHead(context, blockNumber),
	])
	if (stopHead()) return undefined
	const sampledAt = new Date(bigintToSafeNumber(block.timestamp * 1_000n, 'Price sample block timestamp')).toISOString()
	const samples = missingPricePoints(state.priceHistory, pricePoints(state.tokenMarkets, blockNumber, sampledAt))
	await appendPriceHistory(config.priceHistoryFile, samples, config.network.chain.id)
	state.priceHistory = [...state.priceHistory, ...samples]
	state.marketObservations = mergeMarketObservations(state.marketObservations ?? [], [...centralizedMarketConsensusObservations(state.centralizedMarket), ...configuredDexMarkets.observations], config.centralizedMarkets.maximumObservationAgeMilliseconds)
	// Settlements mined during a crash or receipt timeout must charge their gas before any candidate is judged against today's budget.
	const reconciledSettlements = await recoverPendingSettlements({ blockNumber, config, journal: context.settlementJournal, readClients: runtime.readClients, state })
	const gated = gateReportCandidates(runtime, context, inspectedReports, block, reconciledSettlements, stopHead)
	if (gated === undefined) return undefined
	const { candidates, cycleDexObservations, opportunities } = gated
	state.activeReportCount = inspectedReports.length
	state.marketObservations = mergeMarketObservations(state.marketObservations ?? [], cycleDexObservations, config.centralizedMarkets.maximumObservationAgeMilliseconds)
	state.marketConsensus =
		config.centralizedMarkets.venueConsensus === undefined
			? undefined
			: estimateMarketConsensus(
					(state.marketObservations ?? []).filter(observation => observation.assetId.toLowerCase() === config.network.rep.toLowerCase()),
					marketConsensusSettings(config.centralizedMarkets),
					config.network.rep,
					config.network.chain.id,
				)
	state.reportPaths = head.discoversReportsFromCoordinators
		? []
		: [...runtime.reports.entries()].map(([id, report]) => ({
				reportId: id.toString(),
				settled: report.settled,
				steps: report.steps,
			}))
	state.balances = balances?.snapshot
	state.blockNumber = blockNumber.toString()
	state.blockTimestamp = block.timestamp.toString()
	state.gameCapital = gameCapitalSnapshot(
		[...runtime.reports.values()].filter(report => !report.settled).map(report => report.latest.game),
		config.network.weth,
	)
	state.lastPollAt = new Date().toISOString()
	state.opportunities = opportunities
	const disputeOutcome = await runDisputeStage(runtime, context, scan, candidates, block, reconciledSettlements)
	if (disputeOutcome === 'shutdown') {
		head.shutdownDuringHead = true
		return undefined
	}
	await runSettlementStage({
		block: { baseFeePerGas: block.baseFeePerGas ?? 0n, number: blockNumber, timestamp: block.timestamp },
		client: runtime.client,
		config,
		coordinatorPolicies: runtime.coordinatorPolicies,
		dailyPositionGasSpentAttoWeth: utcDayGasSpentWeth(runtime.positions, dateFromBlockTimestamp(block.timestamp)) + archivedUtcDayGasSpentWeth(runtime.positionJournal.archived, dateFromBlockTimestamp(block.timestamp)),
		executionReady: head.executionReady,
		gasPrice,
		isPaused: () => state.paused || shutdown?.isRequested() === true,
		journal: context.settlementJournal,
		readClients: runtime.readClients,
		reports: runtime.reports.values(),
		state,
		tokenSymbol: token => tokenMarkets.find(market => market.address.toLowerCase() === token.toLowerCase())?.symbol,
		track: context.trackTransaction,
		transactionSlotFree: disputeOutcome !== 'attempted',
		wallet: runtime.wallet,
	})
	state.priceHistory = state.priceHistory.slice(-2_000)
	return { completedScan: countOpportunities(opportunities), finalityAnchor: headFinalityAnchor }
}
