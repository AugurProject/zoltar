import { expect, test } from 'bun:test'
import { diagnosticSummary, groupedOperations } from '#dashboard/operation-log'
import type { PublicOperationEntry } from '#state/operator-state'

const entry: PublicOperationEntry = { category: 'decision', level: 'info', message: 'Skipped report', reason: 'Not enough token liquidity', reportId: '8', timestamp: '2026-10-02T06:50:00Z' }

test('groups repeated decisions while keeping distinct reports, reasons and severities visible', () => {
	const groups = groupedOperations([entry, { ...entry, timestamp: '2026-10-02T06:49:00Z' }, { ...entry, reportId: '9' }, { ...entry, reason: 'Venue quote unavailable' }, { ...entry, level: 'warning' }, { ...entry, category: 'scan' }])
	expect(groups).toHaveLength(4)
	expect(groups[0]).toEqual({ operation: entry, occurrences: 2 })
})

test('keeps short reasons and hides long provider payloads behind a useful summary', () => {
	expect(diagnosticSummary(entry.reason ?? '')).toBe('Not enough token liquidity')
	expect(diagnosticSummary(`Venue quotes failed: 0x${'a'.repeat(300)}`)).toBe('Venue quotes failed')
	expect(diagnosticSummary(`0x${'a'.repeat(100)}`)).toBe('Request failed')
})
