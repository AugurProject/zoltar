import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { matchesLocalSearch } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { createDownloadedEntityStore } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { OpenOracleReportSummary } from '../../../types/contracts.js'
import { getOpenOracleReportProgress, OPEN_ORACLE_REPORT_PROGRESS_ORDER, type OpenOracleReportProgress } from './openOracle.js'

export type BrowseStatusFilter = 'all' | OpenOracleReportProgress

export function resolveBrowseStatusFilter(value: string): BrowseStatusFilter {
	return OPEN_ORACLE_REPORT_PROGRESS_ORDER.find(progress => progress === value) ?? 'all'
}

/** A downloaded summary with the lifecycle timing needed for a time-based status; summaries cached before timing was recorded lack it. */
export type OpenOracleBrowseReport = OpenOracleReportSummary & { disputeDelay?: bigint | undefined; settlementTime?: bigint | undefined }

/** Loaded summaries and opened reports carry lifecycle timing at runtime even where their declared type does not. */
function readOpenOracleReportTiming(report: OpenOracleReportSummary) {
	return {
		disputeDelay: 'disputeDelay' in report && typeof report.disputeDelay === 'bigint' ? report.disputeDelay : undefined,
		settlementTime: 'settlementTime' in report && typeof report.settlementTime === 'bigint' ? report.settlementTime : undefined,
	}
}

export function getOpenOracleReportEntityId(reportId: bigint) {
	return reportId.toString()
}

/** Browse rows show only summary fields and lifecycle timing, so an opened report's details are reduced to them before caching. */
export function toCachedOpenOracleReportSummary(report: OpenOracleReportSummary): OpenOracleBrowseReport {
	const { disputeDelay, settlementTime } = readOpenOracleReportTiming(report)
	return {
		currentAmount1: report.currentAmount1,
		currentAmount2: report.currentAmount2,
		currentReporter: report.currentReporter,
		...(disputeDelay === undefined ? {} : { disputeDelay }),
		disputeOccurred: report.disputeOccurred,
		exactToken1Report: report.exactToken1Report,
		isDistributed: report.isDistributed,
		price: report.price,
		reportId: report.reportId,
		reportTimestamp: report.reportTimestamp,
		...(settlementTime === undefined ? {} : { settlementTime }),
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
		(read): OpenOracleBrowseReport => ({
			currentAmount1: read.bigint('currentAmount1'),
			currentAmount2: read.bigint('currentAmount2'),
			currentReporter: read.address('currentReporter'),
			// Timing is optional so summaries cached before it was recorded stay readable.
			disputeDelay: read.optional('disputeDelay', read.bigint),
			disputeOccurred: read.boolean('disputeOccurred'),
			exactToken1Report: read.bigint('exactToken1Report'),
			isDistributed: read.boolean('isDistributed'),
			price: read.bigint('price'),
			reportId: read.bigint('reportId'),
			reportTimestamp: read.bigint('reportTimestamp'),
			settlementTime: read.optional('settlementTime', read.bigint),
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

function reportMatchesSearch(report: OpenOracleBrowseReport, normalizedSearchText: string) {
	return matchesLocalSearch(normalizedSearchText, [`#${report.reportId.toString()}`, report.token1Symbol, report.token2Symbol, report.token1, report.token2])
}

/** Status and text filters run over every downloaded report before anything is displayed. */
export function filterOpenOracleReports(reports: readonly OpenOracleBrowseReport[], { clock, normalizedSearchText, statusFilter }: { clock: { currentBlockNumber?: bigint | undefined; currentTime?: bigint | undefined }; normalizedSearchText: string; statusFilter: BrowseStatusFilter }) {
	return reports.filter(report => (statusFilter === 'all' || getOpenOracleReportProgress(report, clock) === statusFilter) && reportMatchesSearch(report, normalizedSearchText))
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
