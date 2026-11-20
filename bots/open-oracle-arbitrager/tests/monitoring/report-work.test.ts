import { expect, test } from 'bun:test'
import { scheduleReportWork, type ReportWorkCursor } from '#monitoring/report-work'

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
