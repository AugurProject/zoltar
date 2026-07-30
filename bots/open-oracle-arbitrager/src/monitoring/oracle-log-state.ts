import type { TransactionLog } from '#ethereum'
import { decodeOpenOracleStatePreimage, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import type { DisputeStepSnapshot } from '#state/operator-state'

export type ActiveReport = {
	latest: OpenOracleStatePreimage
	settled: boolean
	steps: DisputeStepSnapshot[]
}

export function reportId(log: TransactionLog) {
	const topic = log.topics[1]
	if (topic === undefined) throw new Error('OpenOracle event missing report id')
	return BigInt(topic)
}

export function logBlockNumber(log: TransactionLog): bigint {
	if (log.blockNumber === null || log.blockNumber === undefined) throw new Error('OpenOracle log is missing its block number')
	return log.blockNumber
}

export function applyLogs(reports: Map<bigint, ActiveReport>, logs: readonly TransactionLog[]) {
	for (const log of logs) {
		if (log.removed === true) continue
		const id = reportId(log)
		const signature = log.topics[0]?.toLowerCase()
		if (signature === OPEN_ORACLE_REPORT_SETTLED_TOPIC.toLowerCase()) {
			const current = reports.get(id)
			if (current !== undefined) {
				current.settled = true
				current.steps.push({
					amount1: undefined,
					amount2: undefined,
					blockNumber: logBlockNumber(log).toString(),
					event: 'settled',
					reporter: undefined,
					transactionHash: log.transactionHash ?? undefined,
				})
			}
			continue
		}
		if (signature !== OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() && signature !== OPEN_ORACLE_REPORT_DISPUTED_TOPIC.toLowerCase()) continue
		const latest = decodeOpenOracleStatePreimage(log.data, id)
		const previous = reports.get(id)
		reports.set(id, {
			latest,
			settled: false,
			steps: [
				...(previous?.steps ?? []),
				{
					amount1: latest.game.currentAmount1.toString(),
					amount2: latest.game.currentAmount2.toString(),
					blockNumber: logBlockNumber(log).toString(),
					event: signature === OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() ? 'submitted' : 'disputed',
					reporter: latest.game.currentReporter,
					transactionHash: log.transactionHash ?? undefined,
				},
			],
		})
	}
}

export function compareLogs(left: TransactionLog, right: TransactionLog) {
	const leftBlock = logBlockNumber(left)
	const rightBlock = logBlockNumber(right)
	if (leftBlock < rightBlock) return -1
	if (leftBlock > rightBlock) return 1
	const leftIndex = BigInt(left.logIndex ?? 0)
	const rightIndex = BigInt(right.logIndex ?? 0)
	if (leftIndex < rightIndex) return -1
	if (leftIndex > rightIndex) return 1
	return 0
}
