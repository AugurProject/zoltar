import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { useState } from 'preact/hooks'
import * as favoritesCopy from '@zoltar/ui-core-shared/copy/favorites.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { ComparisonRecord } from '@zoltar/ui-core-shared/components/ComparisonRecord.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { LocalBrowseSearchField } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { useDownloadedEntities, useFavorites } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { buildLocalBrowseEntries, normalizeLocalSearchText } from '@zoltar/ui-core-shared/lib/localEntityBrowse.js'
import { formatRelativeTimestamp, getWallClockTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatOpenOracleReportPriceUnit, getOpenOracleReportProgress, getOpenOracleReportProgressLabel, getOpenOracleReportProgressTone, OPEN_ORACLE_REPORT_PROGRESS_ORDER } from '../lib/openOracle.js'
import { filterOpenOracleReports, getOpenOracleReportEntityId, openOracleReportDownloadStore, parseReportIdSearch, resolveBrowseStatusFilter, type BrowseStatusFilter, type OpenOracleBrowseReport } from '../lib/reportBrowse.js'
import { useChainBlockNumber, useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { getOpenOracleClockLabel, OPEN_ORACLE_PRICE_UNITS, OpenOracleClockValue, renderReportFields } from './OpenOracleReportContent.js'

type ReportClock = { currentBlockNumber: bigint | undefined; currentTime: bigint | undefined }

function ReportSummaryRecord({ clock, fetchedAt, onSelectReport, report }: { clock: ReportClock; fetchedAt: number; onSelectReport: (reportId: bigint) => void; report: OpenOracleBrowseReport }) {
	const progress = getOpenOracleReportProgress(report, clock)
	const reportTitle = openOracleCopy.formatReportBrowseTitle(report.token1Symbol, report.token2Symbol, report.reportId.toString())
	return (
		<ComparisonRecord
			title={reportTitle}
			badge={
				<div className='open-oracle-report-badges'>
					<FavoriteToggle app='statoblast' entityLabel={reportTitle} id={getOpenOracleReportEntityId(report.reportId)} kind='oracleReport' />
					<Badge tone={getOpenOracleReportProgressTone(progress)}>{getOpenOracleReportProgressLabel(progress)}</Badge>
					{/* Cached summaries can be stale; opening the report reads it from chain again. */}
					<span className='open-oracle-report-updated'>{openOracleCopy.formatReportUpdated(formatRelativeTimestamp(BigInt(Math.floor(fetchedAt / 1000)), getWallClockTimestamp()))}</span>
				</div>
			}
			action={
				<button aria-label={openOracleCopy.formatOpenReportLabel(reportTitle)} className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
					{openOracleCopy.openReport}
				</button>
			}
			metrics={[
				{ label: openOracleCopy.currentPrice, value: <CurrencyValue value={report.price} suffix={formatOpenOracleReportPriceUnit(report)} units={OPEN_ORACLE_PRICE_UNITS} /> },
				{ label: openOracleCopy.formatCurrentAmount1Label(report.token1Symbol), value: <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} /> },
				{ label: openOracleCopy.formatCurrentAmount2Label(report.token2Symbol), value: <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} /> },
				{ label: getOpenOracleClockLabel(report.timeType, openOracleCopy.reportTimestamp, openOracleCopy.reportBlock), value: <OpenOracleClockValue timeType={report.timeType} value={report.reportTimestamp} /> },
				{ label: getOpenOracleClockLabel(report.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock), value: <OpenOracleClockValue timeType={report.timeType} value={report.settlementTimestamp} zeroText={openOracleCopy.notSettled} /> },
			]}
		>
			<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>
				{renderReportFields([
					{ label: report.token1Symbol, value: <AddressValue address={report.token1} /> },
					{ label: report.token2Symbol, value: <AddressValue address={report.token2} /> },
					{ label: openOracleCopy.currentReporter, value: report.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={report.currentReporter} /> },
				])}
			</ReadOnlyDetailAccordion>
		</ComparisonRecord>
	)
}

/** Reports use the same favorites-only browser as pools; opening a report saves its summary. */
export function OpenOracleReportBrowser({ onOpenReport }: { onOpenReport: (reportId: bigint) => void }) {
	const [statusFilter, setStatusFilter] = useState<BrowseStatusFilter>('all')
	// Without a chain timestamp yet, wall-clock time still tells whether a time-based report is ready to settle.
	const clock: ReportClock = { currentBlockNumber: useChainBlockNumber(), currentTime: useChainTimestamp() ?? getWallClockTimestamp() }
	const [searchText, setSearchText] = useState('')
	const favorites = useFavorites('statoblast', 'oracleReport')
	const downloaded = useDownloadedEntities('statoblast', 'oracleReport', openOracleReportDownloadStore)
	const entries = buildLocalBrowseEntries(downloaded.entries, favorites.entries, 'favorites')
	const normalizedSearchText = normalizeLocalSearchText(searchText)
	const fetchedAtById = new Map(entries.map(entry => [entry.id, entry.fetchedAt]))
	const visibleReports = filterOpenOracleReports(
		entries.map(entry => entry.data),
		{ clock, normalizedSearchText, statusFilter },
	)
	const hasActiveFilters = normalizedSearchText !== '' || statusFilter !== 'all'
	const searchedReportId = parseReportIdSearch(searchText)
	// A report ID that is not listed (not cached, not favorited, or filtered out) can still be opened directly.
	const openSearchedReport =
		searchedReportId === undefined || visibleReports.some(report => report.reportId === searchedReportId) ? undefined : (
			<button className='primary' type='button' onClick={() => onOpenReport(searchedReportId)}>
				{openOracleCopy.formatOpenReportById(searchedReportId.toString())}
			</button>
		)

	const content = (() => {
		if (entries.length === 0) return <EmptyState title={openOracleCopy.noFavoriteReports} detail={openOracleCopy.noFavoriteReportsDetail} actions={openSearchedReport} />
		if (visibleReports.length === 0) return <EmptyState live title={commonCopy.noMatches} detail={openOracleCopy.reportFiltersEmpty} actions={openSearchedReport} />
		return (
			<div className='comparison-record-list'>
				{visibleReports.map(report => (
					<ReportSummaryRecord key={report.reportId.toString()} clock={clock} fetchedAt={fetchedAtById.get(getOpenOracleReportEntityId(report.reportId)) ?? 0} onSelectReport={onOpenReport} report={report} />
				))}
			</div>
		)
	})()

	return (
		<SectionBlock density='compact' title={openOracleCopy.reportDirectory} variant='plain'>
			<p className='detail'>{favoritesCopy.formatCollectionTab(favoritesCopy.favorites, entries.length)}</p>
			<div className='filter-toolbar'>
				<LocalBrowseSearchField label={openOracleCopy.searchReports} onChange={setSearchText} placeholder={openOracleCopy.reportSearchPlaceholder} value={searchText} />
				<label className='field'>
					<span>{commonCopy.status}</span>
					<select value={statusFilter} onChange={event => setStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
						<option value='all'>{openOracleCopy.allStatuses}</option>
						{OPEN_ORACLE_REPORT_PROGRESS_ORDER.map(progress => (
							<option key={progress} value={progress}>
								{getOpenOracleReportProgressLabel(progress)}
							</option>
						))}
					</select>
				</label>
			</div>
			{visibleReports.length === 0 || !hasActiveFilters ? undefined : <p className='detail'>{openOracleCopy.formatReportsShownSummary(visibleReports.length.toString(), entries.length.toString())}</p>}
			{content}
		</SectionBlock>
	)
}
