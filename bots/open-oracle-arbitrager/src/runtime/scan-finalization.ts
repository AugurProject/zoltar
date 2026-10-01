import { REORG_OVERLAP_BLOCKS } from '#execution/execution-orchestration'
import { reportId } from '#monitoring/oracle-log-state'
import type { startScanReport } from '@zoltar/core-shared/monitoring/scanStatus'
import { withFinalityAnchor, type SyncCursor } from '@zoltar/bot-shared/monitoring/block-sync'
import type { CompletedHead } from './head-evaluation.ts'
import { reportCompletedScan } from './operator-reporting.ts'
import type { OperatorContext, OperatorRuntime, ScanPass } from './operator-runtime.ts'
import { completeSuccessfulPoll } from './poll-completion.ts'

export type ScanReport = ReturnType<typeof startScanReport>

/** Forgets reports whose settlement is buried deeper than the reorg overlap, together with their cached logs. */
function pruneSettledReports(runtime: OperatorRuntime, blockNumber: bigint) {
	const settledReportIds = new Set(
		[...runtime.reports.entries()]
			.filter(([, report]) => {
				const settlement = report.steps.findLast(step => step.event === 'settled')
				return report.settled && settlement !== undefined && blockNumber > BigInt(settlement.blockNumber) + REORG_OVERLAP_BLOCKS
			})
			.map(([id]) => id),
	)
	if (settledReportIds.size === 0) return
	for (const id of settledReportIds) runtime.reports.delete(id)
	runtime.cachedLogs = runtime.cachedLogs.filter(log => !settledReportIds.has(reportId(log)))
}

/** Advances the cursor to the completed head with its finality anchor, prunes settled reports, and reports the scan. */
export function finalizeScan(runtime: OperatorRuntime, context: OperatorContext, scan: ScanPass, scanReport: ScanReport, blockNumber: bigint, completedCursor: SyncCursor, completed: CompletedHead) {
	const { config, state } = context
	runtime.cursor = withFinalityAnchor(completedCursor, completed.finalityAnchor.number, completed.finalityAnchor.hash)
	pruneSettledReports(runtime, blockNumber)
	scanReport.update({ status: state.paused ? 'paused' : 'live', details: { activeReports: state.activeReportCount, opportunities: completed.completedScan.evaluated, skipped: completed.completedScan.skipped } })
	reportCompletedScan(state, blockNumber, completed.completedScan, scan.nextError)
	return completeSuccessfulPoll(state, scan.nextError, config.once)
}
