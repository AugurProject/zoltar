import type { ExecutionCandidate } from '#core/operator-types'
import { executeDispute } from '#execution/dispute-execution'
import { canonicalBlockHashWithQuorum, executionFailureDecision, selectBestExecution } from '#execution/execution-orchestration'
import { dateFromBlockTimestamp } from '#execution/recovery-support'
import { archivedUtcDayGasSpentWeth } from '#state/position-store'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { logEvent } from '@zoltar/bot-shared/infrastructure/log-event'
import { requireCurrentConstantProductMarketEvidence } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { discardDexMarketObservations, requireCanonicalDexEvidence } from '@zoltar/bot-shared/monitoring/market-consensus'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import { flushHistoryOutboxes, readEndpoints, type OperatorContext, type OperatorRuntime, type ScanBlock, type ScanPass } from './operator-runtime.ts'
import type { ReconciledSettlementJournal } from './settlement-stage.ts'

/**
 * `attempted` means a dispute owned this poll's transaction slot, even when it failed; `shutdown` means a stop request
 * interrupted the attempt and the head must not complete.
 */
type DisputeStageOutcome = 'attempted' | 'idle' | 'shutdown'

/** Revalidates the selected candidate's market evidence right before submission; stale DEX evidence is discarded. */
async function marketEvidenceStillCurrent(runtime: OperatorRuntime, context: OperatorContext, selected: ExecutionCandidate) {
	const { config, state } = context
	try {
		await requireCanonicalDexEvidence(selected.marketConsensus, evidenceBlockNumber => canonicalBlockHashWithQuorum(runtime.readClients, readEndpoints(config), 'market evidence', evidenceBlockNumber, config.rpcQuorum))
		await requireCurrentConstantProductMarketEvidence(config.centralizedMarkets, selected.report.game.token2, config.network.weth, selected.marketConsensus, context.readConfiguredDexPair)
		return true
	} catch (error) {
		if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
		state.marketObservations = discardDexMarketObservations(state.marketObservations ?? [])
		state.marketConsensus = undefined
		selected.marketConsensus = undefined
		return false
	}
}

/** Submits the most profitable candidate when a signer is available, recording its outcome on the opportunity. */
export async function runDisputeStage(runtime: OperatorRuntime, context: OperatorContext, scan: ScanPass, candidates: readonly ExecutionCandidate[], block: ScanBlock, reconciledSettlements: ReconciledSettlementJournal): Promise<DisputeStageOutcome> {
	const { config, shutdown, state } = context
	const selected = selectBestExecution(candidates, candidate => candidate.quote.netProfitAttoWeth)
	const wallet = runtime.wallet
	if (selected === undefined || wallet === undefined) return 'idle'
	selected.opportunity.decision = 'selected'
	try {
		const metadata = state.tokenMarkets.find(market => market.address.toLowerCase() === selected.report.game.token2.toLowerCase())
		if (metadata === undefined) throw new Error('Token metadata is unavailable')
		const record = await executeDispute(
			runtime.client,
			runtime.readClients,
			wallet,
			config,
			selected.report,
			selected.quote,
			selected.pool,
			selected.hedgeVenue,
			selected.hedgeFee,
			metadata,
			runtime.positions,
			state.centralizedMarket,
			selected.marketConsensus,
			async () => await marketEvidenceStillCurrent(runtime, context, selected),
			() => state.paused || shutdown?.isRequested() === true,
			context.trackTransaction,
			context.persistPosition,
			archivedUtcDayGasSpentWeth(runtime.positionJournal.archived, dateFromBlockTimestamp(block.timestamp)) + reconciledSettlements.gasSpentAttoEthOnUtcDay(dateFromBlockTimestamp(block.timestamp)),
		)
		selected.opportunity.decision = 'submitted'
		if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
		try {
			await flushHistoryOutboxes(runtime, context)
		} catch (error) {
			if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
			const message = `Confirmed dispute ${record.transactionHash} is visible but history persistence failed: ${errorMessage(error)}`
			scan.nextError = message
			logEvent('arbitrager', 'historyPersistenceFailed', { error: message }, 'error')
		}
	} catch (error) {
		if (shutdown?.isRequested()) return 'shutdown'
		if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
		const message = errorMessage(error)
		const reportId = selected.report.helper.reportId.toString()
		selected.opportunity.decision = executionFailureDecision(error)
		if (selected.opportunity.decision === 'execution-failed') {
			scan.nextError = `Report ${reportId} execution failed: ${message}`
		}
		logEvent('arbitrager', 'executionFailed', { report: reportId, error: message }, 'error')
	}
	return 'attempted'
}
