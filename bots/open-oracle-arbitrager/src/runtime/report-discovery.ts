import { retainReportsAndLogs } from '#config/runtime-deployment'
import { canonicalBlockHashWithQuorum, REORG_OVERLAP_BLOCKS } from '#execution/execution-orchestration'
import { pendingCoordinatorReports, pendingCoordinatorReportsWithQuorum } from '#execution/recovery-support'
import { discoverCoordinatorPolicies } from '#monitoring/coordinator-discovery'
import { applyCoordinatorReports, applyLogs, compareLogs, logBlockNumber } from '#monitoring/oracle-log-state'
import { recordOperation } from '#state/operator-state'
import { cursorForHeadScan, fetchLogsWithAdaptiveRanges, initialCursor, latestLogRange, newestFirstScanRanges, type SyncCursor } from '@zoltar/bot-shared/monitoring/block-sync'
import { clearOrphanedDexEvidenceForHeadReplacement } from '@zoltar/bot-shared/monitoring/market-consensus'
import { OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC } from '@zoltar/open-oracle-shared/openOracle/openOracle'
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
	runtime.coordinatorPolicies = await discoverCoordinatorPolicies(config.execute ? runtime.readClients : [runtime.client], config, blockNumber, blockHash)
	config.coordinatorAddresses = runtime.coordinatorPolicies.map(policy => policy.coordinator)
	fixedState.deployment = { ...fixedState.deployment, coordinatorAddresses: config.coordinatorAddresses }
	const executionReady = runtime.positions.every(position => position.historyOutbox === undefined) && scan.nextError === undefined
	const discoversReportsFromCoordinators = config.coordinatorAddresses.length !== 0
	runtime.cursor ??=
		discoversReportsFromCoordinators || config.logLookbackBlocks === 0n
			? initialCursor(blockNumber, 0n)
			: {
					...initialCursor(blockNumber, 0n),
					nextBlock: latestLogRange(blockNumber, config.logLookbackBlocks).fromBlock,
				}
	const cursor = runtime.cursor
	const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: cursor.lastHeadHash, number: cursor.lastHeadNumber }, { hash: blockHash, number: blockNumber }, state, previousBlockNumber =>
		canonicalBlockHashWithQuorum(runtime.readClients, readEndpoints(config), 'previous market head', previousBlockNumber, config.rpcQuorum),
	)
	const scanCursor = cursorForHeadScan(cursor, blockNumber, blockHash, REORG_OVERLAP_BLOCKS)
	if (scanCursor === undefined) return { kind: 'head-unchanged' }
	if (discoversReportsFromCoordinators) {
		const pendingReports = config.execute ? await pendingCoordinatorReportsWithQuorum(runtime.readClients, config, blockNumber) : await pendingCoordinatorReports(runtime.client, config, blockNumber)
		applyCoordinatorReports(runtime.reports, pendingReports)
		runtime.cachedLogs = []
	} else if (config.logLookbackBlocks > 0n) {
		await discoverReportsFromLogs(runtime, context, scanCursor, blockNumber)
	} else {
		runtime.cachedLogs = []
		runtime.reports.clear()
	}
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
