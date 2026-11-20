import { retainReportsAndLogs } from '#config/runtime-deployment'
import { canonicalBlockHashWithQuorum, REORG_OVERLAP_BLOCKS } from '#execution/execution-orchestration'
import { pendingCoordinatorReports, pendingCoordinatorReportsWithQuorum } from '#execution/recovery-support'
import { scheduleReportWork } from '#monitoring/report-work'
import { discoverStoredReports } from '#monitoring/report-index'
import { discoverCoordinatorPolicies } from '#monitoring/coordinator-discovery'
import { applyCoordinatorReports, applyLogs, compareLogs, logBlockNumber } from '#monitoring/oracle-log-state'
import { recordOperation } from '#state/operator-state'
import { cursorForHeadScan, fetchLogsWithAdaptiveRanges, initialCursor, latestLogRange, newestFirstScanRanges, type SyncCursor } from '@zoltar/bot-shared/monitoring/block-sync'
import { clearOrphanedDexEvidenceForHeadReplacement } from '@zoltar/bot-shared/monitoring/market-consensus'
import { OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { MAX_LOG_SCAN_RANGE, readEndpoints, type OperatorContext, type OperatorRuntime, type ScanBlock, type ScanPass } from './operator-runtime.ts'

/** The scan either has nothing new at this head, or proceeds to evaluate the discovered reports. */
type ReportDiscovery = { kind: 'head-unchanged' } | { discoversReportsFromCoordinators: boolean; executionReady: boolean; kind: 'scan' }

/** Rebuilds the report set from the OpenOracle logs in the lookback window, newest ranges first. */
async function discoverReportsFromLogs(runtime: OperatorRuntime, context: OperatorContext, scanCursor: SyncCursor, blockNumber: bigint) {
	const { config } = context
	const recentRange = latestLogRange(blockNumber, config.logLookbackBlocks)
	const fromBlock = scanCursor.nextBlock > recentRange.fromBlock ? scanCursor.nextBlock : recentRange.fromBlock
	for (const range of newestFirstScanRanges(fromBlock, blockNumber, MAX_LOG_SCAN_RANGE)) {
		const logs = await fetchLogsWithAdaptiveRanges({ nextBlock: range.fromBlock }, range.toBlock, MAX_LOG_SCAN_RANGE, requestedRange =>
			context.contextualLogRead(requestClient =>
				requestClient.getLogs({
					address: config.openOracle,
					fromBlock: requestedRange.fromBlock,
					toBlock: requestedRange.toBlock,
					topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC]],
				}),
			),
		)
		runtime.cachedLogs = [...runtime.cachedLogs.filter(log => logBlockNumber(log) < range.fromBlock || logBlockNumber(log) > range.toBlock), ...logs].sort(compareLogs)
	}
	runtime.reports.clear()
	applyLogs(runtime.reports, runtime.cachedLogs)
	runtime.cachedLogs = retainReportsAndLogs(runtime.reports, runtime.cachedLogs, runtime.coordinatorPolicies, config.openOracle, blockNumber)
}

/**
 * Discovers coordinator policies at the pinned head, discards DEX evidence from a replaced head, and loads the
 * active reports from coordinators or from the log window. Reports `head-unchanged` when this head was already scanned.
 */
export async function discoverReports(runtime: OperatorRuntime, context: OperatorContext, scan: ScanPass, block: ScanBlock): Promise<ReportDiscovery> {
	const { config, fixedState, state } = context
	const blockNumber = block.number
	const blockHash = block.hash

	runtime.cursor ??= { ...initialCursor(blockNumber, 0n), nextBlock: config.logLookbackBlocks > 0n ? latestLogRange(blockNumber, config.logLookbackBlocks).fromBlock : blockNumber }
	const cursor = runtime.cursor
	const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: cursor.lastHeadHash, number: cursor.lastHeadNumber }, { hash: blockHash, number: blockNumber }, state, previousBlockNumber =>
		canonicalBlockHashWithQuorum(runtime.readClients, readEndpoints(config), 'previous market head', previousBlockNumber, config.rpcQuorum),
	)
	const scanCursor = cursorForHeadScan(cursor, blockNumber, blockHash, REORG_OVERLAP_BLOCKS)
	if (scanCursor === undefined) return { kind: 'head-unchanged' }
	const clients = config.execute ? runtime.readClients : [runtime.client]
	const indexed = await discoverStoredReports(
		clients,
		config,
		blockNumber,
		blockHash,
		replacedMarketHead ? undefined : runtime.reportIndexCursor,
		runtime.positions.map(position => BigInt(position.reportId)),
	)
	runtime.reportBacklog ??= new Map()
	for (const report of indexed.reports) {
		if (!runtime.reportBacklog.has(report.reportId)) runtime.reportBacklog.set(report.reportId, { creator: report.creator })
	}
	for (const report of runtime.reports.values()) {
		const id = report.latest.helper.reportId
		if (report.settled) runtime.reportBacklog.delete(id)
		else runtime.reportBacklog.set(id, { creator: report.latest.helper.creator, settlementAt: report.latest.game.reportTimestamp + report.latest.game.settlementTime, timeType: (report.latest.game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n })
	}
	const work = scheduleReportWork(
		[...runtime.reportBacklog].map(([reportId, entry]) => ({
			...entry,
			reportId,
			urgent: entry.settlementAt === undefined || entry.settlementAt > (entry.timeType ? block.timestamp : blockNumber),
		})),
		runtime.reportWorkCursor,
	)
	const retainedReportIds = work.reports.map(report => report.reportId)
	runtime.coordinatorPolicies = await discoverCoordinatorPolicies(clients, config, blockNumber, blockHash, retainedReportIds, work.reports)
	const authenticated = new Set(runtime.coordinatorPolicies.flatMap(policy => Object.keys(policy.reportEscrows ?? {})))
	for (const report of work.reports) {
		if (!authenticated.has(report.reportId.toString())) runtime.reportBacklog.delete(report.reportId)
	}
	runtime.reportWorkCursor = work.cursor
	config.coordinatorAddresses = runtime.coordinatorPolicies.map(policy => policy.coordinator)
	fixedState.deployment = { ...fixedState.deployment, coordinatorAddresses: config.coordinatorAddresses }
	const executionReady = runtime.positions.every(position => position.historyOutbox === undefined) && scan.nextError === undefined
	const discoversReportsFromCoordinators = config.coordinatorAddresses.length !== 0
	if (discoversReportsFromCoordinators) {
		const pendingReports = config.execute ? await pendingCoordinatorReportsWithQuorum(runtime.readClients, config, blockNumber, runtime.coordinatorPolicies) : await pendingCoordinatorReports(runtime.client, config, blockNumber, runtime.coordinatorPolicies)
		applyCoordinatorReports(runtime.reports, pendingReports)
		runtime.cachedLogs = []
	} else if (config.logLookbackBlocks > 0n) {
		await discoverReportsFromLogs(runtime, context, scanCursor, blockNumber)
	} else {
		runtime.cachedLogs = []
		runtime.reports.clear()
	}
	runtime.reportIndexCursor = indexed.cursor
	if (replacedMarketHead) {
		recordOperation(state, {
			category: 'decision',
			details: `block=${blockNumber.toString()}`,
			level: 'warning',
			message: 'Market evidence reset after canonical head replacement',
			reason: 'DEX evidence from the replaced block was discarded before this poll re-evaluated every report',
			reportId: undefined,
		})
	}
	return { discoversReportsFromCoordinators, executionReady, kind: 'scan' }
}
