import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { useMemo, useRef, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { ComparisonRecord } from '@zoltar/ui-core-shared/components/ComparisonRecord.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { LocalBrowseBar, LocalBrowseSearchField, LocalCollectionEmptyState } from '@zoltar/ui-core-shared/components/LocalBrowseControls.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { useLocalBrowseDirectory } from '@zoltar/ui-core-shared/hooks/useLocalBrowseDirectory.js'
import type { DiscoveredPage } from '@zoltar/ui-core-shared/hooks/usePagedDiscovery.js'
import { formatRelativeTimestamp, getWallClockTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../../../types/contracts.js'
import { formatOpenOracleReportPriceUnit, getOpenOracleReportProgress, getOpenOracleReportProgressLabel, getOpenOracleReportProgressTone, OPEN_ORACLE_REPORT_PROGRESS_ORDER } from '../lib/openOracle.js'
import { filterOpenOracleReports, getOpenOracleReportEntityId, openOracleReportDownloadStore, parseReportIdSearch, resolveBrowseStatusFilter, toCachedOpenOracleReportSummary, type BrowseStatusFilter, type OpenOracleBrowseReport } from '../lib/reportBrowse.js'
import { useChainBlockNumber, useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { BROWSE_PAGE_SIZE, getOpenOracleClockLabel, OPEN_ORACLE_PRICE_UNITS, OpenOracleClockValue, renderReportFields } from './OpenOracleReportContent.js'

type UnavailableReport = Readonly<{ reportId: bigint; message: string }>
type ReceivedReportPage = Readonly<{ page: OpenOracleReportSummaryPage; requestKey: string }>

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

type OpenOracleReportBrowserProps = {
	environmentReady: boolean
	environmentRefreshKey: number
	loadBrowseReports: (pageIndex: number, pageSize: number) => Promise<OpenOracleReportSummaryPage>
	onOpenReport: (reportId: bigint) => void
}

/**
 * Reports are browsed from this browser's favorites and downloaded summaries. Scanning Open Oracle is an explicit,
 * one-page-per-click action (newest reports first) whose results join the downloaded cache.
 */
export function OpenOracleReportBrowser({ environmentReady, environmentRefreshKey, loadBrowseReports, onOpenReport }: OpenOracleReportBrowserProps) {
	const [statusFilter, setStatusFilter] = useState<BrowseStatusFilter>('all')
	// Without a chain timestamp yet, wall-clock time still tells whether a time-based report is ready to settle.
	const clock: ReportClock = { currentBlockNumber: useChainBlockNumber(), currentTime: useChainTimestamp() ?? getWallClockTimestamp() }
	const [receivedPage, setReceivedPage] = useState<ReceivedReportPage | undefined>(undefined)
	// Reports whose stored state cannot be read have no summary to cache; they are listed for the current visit only.
	const [unavailable, setUnavailable] = useState<{ contextKey: string; reports: readonly UnavailableReport[] }>({ contextKey: '', reports: [] })
	const contextKey = environmentRefreshKey.toString()
	const liveContextKeyRef = useRef(contextKey)
	liveContextKeyRef.current = contextKey
	const discoveredPage = useMemo((): DiscoveredPage<OpenOracleReportSummary> | undefined => {
		if (receivedPage === undefined) return undefined
		return { items: receivedPage.page.reports, pageIndex: receivedPage.page.pageIndex, pageSize: receivedPage.page.pageSize, requestKey: receivedPage.requestKey, totalCount: receivedPage.page.reportCount }
	}, [receivedPage])
	const directory = useLocalBrowseDirectory({
		app: 'statoblast',
		contextKey,
		kind: 'oracleReport',
		loadPage: async (pageIndex, requestKey) => {
			const page = await loadBrowseReports(pageIndex, BROWSE_PAGE_SIZE)
			// A page for an earlier environment must not replace anything collected for the current one.
			if (liveContextKeyRef.current !== contextKey) return
			setReceivedPage({ page, requestKey })
			const pageUnavailable = page.unavailableReports ?? []
			if (pageUnavailable.length === 0) return
			setUnavailable(current => {
				const reports = current.contextKey === contextKey ? current.reports : []
				const known = new Set(reports.map(report => report.reportId))
				return { contextKey, reports: [...reports, ...pageUnavailable.filter(report => !known.has(report.reportId))] }
			})
		},
		pageSize: BROWSE_PAGE_SIZE,
		receivedPage: discoveredPage,
		store: openOracleReportDownloadStore,
		toDownloadedItem: report => ({ data: toCachedOpenOracleReportSummary(report), id: getOpenOracleReportEntityId(report.reportId) }),
	})
	const { collection, discovery, entries, normalizedSearchText, searchText } = directory
	const unavailableReports = unavailable.contextKey === contextKey ? unavailable.reports : []
	const fetchedAtById = new Map(entries.map(entry => [entry.id, entry.fetchedAt]))
	const visibleReports = filterOpenOracleReports(
		entries.map(entry => entry.data),
		{ clock, normalizedSearchText, statusFilter },
	)
	const hasActiveFilters = normalizedSearchText !== '' || statusFilter !== 'all'
	// Unreadable reports belong to the scan, so they appear in the downloaded collection while no filter is active.
	const visibleUnavailableReports = collection === 'downloaded' && !hasActiveFilters ? unavailableReports : []
	const searchedReportId = parseReportIdSearch(searchText)
	// A report ID that is not listed (not downloaded, in the other collection, or filtered out) can still be opened directly.
	const openSearchedReport =
		searchedReportId === undefined || visibleReports.some(report => report.reportId === searchedReportId) ? undefined : (
			<button className='primary' type='button' onClick={() => onOpenReport(searchedReportId)}>
				{openOracleCopy.formatOpenReportById(searchedReportId.toString())}
			</button>
		)

	const content = (() => {
		if (entries.length === 0 && visibleUnavailableReports.length === 0)
			return (
				<LocalCollectionEmptyState
					action={openSearchedReport}
					copy={{
						downloadedEmpty: openOracleCopy.noDownloadedReports,
						downloadedEmptyDetail: openOracleCopy.noDownloadedReportsDetail,
						favoritesEmpty: openOracleCopy.noFavoriteReports,
						favoritesEmptyDetail: openOracleCopy.noFavoriteReportsDetail,
						favoritesEmptyWithDownloadsDetail: openOracleCopy.noFavoriteReportsWithDownloadsDetail,
						showDownloaded: openOracleCopy.showDownloadedReports,
					}}
					directory={directory}
					registryEmpty={<EmptyState live title={commonCopy.none} detail={openOracleCopy.oracleGamesEmpty} actions={openSearchedReport} />}
				/>
			)
		if (visibleReports.length === 0 && visibleUnavailableReports.length === 0) return <EmptyState live title={commonCopy.noMatches} detail={openOracleCopy.reportFiltersEmpty} actions={openSearchedReport} />
		return (
			<div className='comparison-record-list'>
				{visibleUnavailableReports.map(report => (
					<StateHint key={`unavailable-${report.reportId.toString()}`} presentation={{ key: 'unavailable', badgeLabel: commonCopy.unavailable, badgeTone: 'muted', detail: report.message }} />
				))}
				{visibleReports.map(report => (
					<ReportSummaryRecord key={report.reportId.toString()} clock={clock} fetchedAt={fetchedAtById.get(getOpenOracleReportEntityId(report.reportId)) ?? 0} onSelectReport={onOpenReport} report={report} />
				))}
			</div>
		)
	})()

	return (
		<SectionBlock density='compact' title={openOracleCopy.reportDirectory} variant='plain'>
			<RetryableNotice disabled={discovery.loading} message={discovery.loadFailed ? openOracleCopy.reportLoadError : undefined} onRetry={discovery.retry} retryLabel={discovery.loading ? <LoadingText>{commonCopy.retrying}</LoadingText> : openOracleCopy.retryReports} />
			<LocalBrowseBar directory={directory} discoverLabel={openOracleCopy.discoverReports} disabled={!environmentReady} nounPlural={openOracleCopy.reportCountPlural} />
			<div className='filter-toolbar'>
				<LocalBrowseSearchField label={openOracleCopy.searchDownloadedReports} onChange={directory.setSearchText} placeholder={openOracleCopy.reportSearchPlaceholder} value={searchText} />
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
