import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { matchesLocalSearch } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { createDownloadedEntityStore } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { OpenOracleReportSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getOpenOracleReportStatus } from './openOracle.js'

export type BrowseStatusFilter = 'all' | 'Pending' | 'Disputed' | 'Settled'

export function resolveBrowseStatusFilter(value: string): BrowseStatusFilter {
	switch (value) {
		case 'Pending':
		case 'Disputed':
		case 'Settled':
		case 'all':
			return value
		default:
			return 'all'
	}
}

export function getOpenOracleReportEntityId(reportId: bigint) {
	return reportId.toString()
}

/** Browse rows show only summary fields, so an opened report's details are reduced to its summary before caching. */
export function toCachedOpenOracleReportSummary(report: OpenOracleReportSummary): OpenOracleReportSummary {
	return {
		currentAmount1: report.currentAmount1,
		currentAmount2: report.currentAmount2,
		currentReporter: report.currentReporter,
		disputeOccurred: report.disputeOccurred,
		exactToken1Report: report.exactToken1Report,
		isDistributed: report.isDistributed,
		price: report.price,
		reportId: report.reportId,
		reportTimestamp: report.reportTimestamp,
		settlementTimestamp: report.settlementTimestamp,
		timeType: report.timeType,
		token1: report.token1,
		token1Decimals: report.token1Decimals,
		token1Symbol: report.token1Symbol,
		token2: report.token2,
		token2Decimals: report.token2Decimals,
		token2Symbol: report.token2Symbol,
	}
}

function decodeCachedOpenOracleReportSummary(value: unknown) {
	const summary = decodeStoredValue(
		value,
		(read): OpenOracleReportSummary => ({
			currentAmount1: read.bigint('currentAmount1'),
			currentAmount2: read.bigint('currentAmount2'),
			currentReporter: read.address('currentReporter'),
			disputeOccurred: read.boolean('disputeOccurred'),
			exactToken1Report: read.bigint('exactToken1Report'),
			isDistributed: read.boolean('isDistributed'),
			price: read.bigint('price'),
			reportId: read.bigint('reportId'),
			reportTimestamp: read.bigint('reportTimestamp'),
			settlementTimestamp: read.bigint('settlementTimestamp'),
			timeType: read.boolean('timeType'),
			token1: read.address('token1'),
			token1Decimals: read.number('token1Decimals'),
			token1Symbol: read.string('token1Symbol'),
			token2: read.address('token2'),
			token2Decimals: read.number('token2Decimals'),
			token2Symbol: read.string('token2Symbol'),
		}),
	)
	// Every listed report has an atomic initial report; a cached entry without one cannot be given a status.
	if (summary === undefined || summary.reportId <= 0n || summary.reportTimestamp === 0n || summary.currentReporter === zeroAddress) return undefined
	return summary
}

export const openOracleReportDownloadStore = createDownloadedEntityStore(decodeCachedOpenOracleReportSummary)

function reportMatchesSearch(report: OpenOracleReportSummary, normalizedSearchText: string) {
	return matchesLocalSearch(normalizedSearchText, [`#${report.reportId.toString()}`, report.token1Symbol, report.token2Symbol, report.token1, report.token2])
}

/** Status and text filters run over every downloaded report before anything is displayed. */
export function filterOpenOracleReports(reports: readonly OpenOracleReportSummary[], { normalizedSearchText, statusFilter }: { normalizedSearchText: string; statusFilter: BrowseStatusFilter }) {
	return reports.filter(report => (statusFilter === 'all' || getOpenOracleReportStatus(report) === statusFilter) && reportMatchesSearch(report, normalizedSearchText))
}

/** A search that is a plain report ID (optionally written as `#12`) can open that report directly when it is not listed. */
export function parseReportIdSearch(searchText: string) {
	const match = /^#?(\d{1,30})$/.exec(searchText.trim())
	if (match === null) return undefined
	const digits = match[1]
	if (digits === undefined) return undefined
	const reportId = BigInt(digits)
	return reportId > 0n ? reportId : undefined
}
