import type { PositionRecord } from '#state/position-store'
import { positionConsumesRisk } from '#core/safety-controls'

export type ReportWorkCursor = { urgent: bigint; settlement: bigint }

export function watchedPositionReportIds(positions: readonly Pick<PositionRecord, 'reportId' | 'status' | 'expiredTransactionAttempts' | 'manualReconciliation'>[]) {
	return [...new Set(positions.filter(position => positionConsumesRisk(position.status) || (position.manualReconciliation === undefined && (position.expiredTransactionAttempts?.length ?? 0) > 0)).map(position => BigInt(position.reportId)))]
}

/** Give live disputes and old settlement work separate budgets, rotating each by report id. */
export function scheduleReportWork<Entry extends { reportId: bigint; urgent: boolean }>(entries: readonly Entry[], cursor?: ReportWorkCursor) {
	const previous = cursor ?? { urgent: 0n, settlement: 0n }
	const page = (urgent: boolean, after: bigint) => {
		const queue = entries
			.filter(entry => entry.urgent === urgent)
			.sort((left, right) => {
				if (left.reportId === right.reportId) return 0
				return left.reportId < right.reportId ? -1 : 1
			})
		const next = queue.findIndex(entry => entry.reportId > after)
		const start = next < 0 ? 0 : next
		const rotated = [...queue.slice(start), ...queue.slice(0, start)].slice(0, 128)
		return { reports: rotated, cursor: rotated.at(-1)?.reportId ?? after }
	}
	const urgent = page(true, previous.urgent)
	const settlement = page(false, previous.settlement)
	return { reports: [...urgent.reports, ...settlement.reports], cursor: { urgent: urgent.cursor, settlement: settlement.cursor } }
}
