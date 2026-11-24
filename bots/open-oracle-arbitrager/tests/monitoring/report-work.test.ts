import { expect, test } from 'bun:test'
import { scheduleReportWork, watchedPositionReportIds, type ReportWorkCursor } from '#monitoring/report-work'

test('retained closed positions leave room for live disputes in the urgent queue', () => {
	const closed = Array.from({ length: 500 }, (_, index) => ({ reportId: String(index + 1), status: 'closed' as const, manualReconciliation: undefined }))
	const watched = watchedPositionReportIds([...closed, { reportId: '501', status: 'open-pending-finality', manualReconciliation: undefined }])
	expect(scheduleReportWork(watched.map(reportId => ({ reportId, urgent: true }))).reports.map(report => report.reportId)).toEqual([501n])
})

test('#1447: old settlement backlog is bounded and cannot starve current disputes', () => {
	const entries = Array.from({ length: 1000 }, (_, index) => ({ reportId: BigInt(index + 1), urgent: false }))
	entries.push({ reportId: 1001n, urgent: true })
	const seen = new Set<bigint>()
	let cursor: ReportWorkCursor | undefined
	for (let scan = 0; scan < 8; scan++) {
		const scheduled = scheduleReportWork(entries, cursor)
		expect(scheduled.reports.length).toBeLessThanOrEqual(256)
		expect(scheduled.reports.some(entry => entry.reportId === 1001n)).toBeTrue()
		for (const entry of scheduled.reports) seen.add(entry.reportId)
		cursor = scheduled.cursor
	}
	expect(seen.size).toBe(1001)
})
