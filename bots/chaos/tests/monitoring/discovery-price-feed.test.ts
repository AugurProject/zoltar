import { expect, test } from 'bun:test'
import { sharedReportSizingExposure } from '../../src/monitoring/discovery-price-feed.ts'

test('a fresh accepted exposure limit raises shared report sizing above the live exposure', () => {
	expect(sharedReportSizingExposure(10n ** 18n, 3n * 10n ** 18n, true)).toBe(3n * 10n ** 18n)
})

test('a stale accepted price sizes shared reports from the live exposure alone', () => {
	expect(sharedReportSizingExposure(10n ** 18n, 3n * 10n ** 18n, false)).toBe(10n ** 18n)
	expect(sharedReportSizingExposure(4n * 10n ** 18n, 3n * 10n ** 18n, true)).toBe(4n * 10n ** 18n)
})
