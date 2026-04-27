import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TimestampValue } from './TimestampValue.js'
import { useLoadController } from '../hooks/useLoadController.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { deriveOpenOracleInitialReportSubmissionDetails, formatOpenOracleFeePercentage, formatOpenOracleMultiplier, getOpenOracleReportStatus, getOpenOracleReportStatusTone, getOpenOracleSelectedReportActionMode, type OpenOracleSelectedReportActionMode } from '../lib/openOracle.js'
import { loadOpenOracleReportSummaries } from '../contracts.js'
import { getReportPresentation } from '../lib/userCopy.js'
import { resolveFirstMatchingValue } from '../lib/viewState.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../types/contracts.js'
import type { OpenOracleSectionProps, OpenOracleView } from '../types/components.js'

const BROWSE_PAGE_SIZE = 10

function renderReportField(label: string, value: ComponentChildren) {
	return (
		<MetricField key={label} label={label}>
			{value}
		</MetricField>
	)
}

function renderReportSection(title: string, fields: Array<{ label: string; value: ComponentChildren }>) {
	return (
		<div className='entity-card-subsection'>
			<div className='entity-card-subsection-header'>
				<h4>{title}</h4>
			</div>
			<div className='question-summary-grid'>{fields.map(field => renderReportField(field.label, field.value))}</div>
		</div>
	)
}

function renderReportSummaryCard(report: OpenOracleReportSummary, onSelectReport: (reportId: bigint) => void) {
	const status = getOpenOracleReportStatus(report)
	const statusTone = getOpenOracleReportStatusTone(status)
	return (
		<EntityCard
			key={report.reportId.toString()}
			className='compact'
			title={`Report #${report.reportId.toString()}`}
			badge={<span className={`badge ${statusTone}`}>{status}</span>}
			actions={
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
						Open report
					</button>
				</div>
			}
		>
			<div className='question-summary-grid'>
				{renderReportField(
					'Token Pair',
					<>
						<AddressValue address={report.token1} /> / <AddressValue address={report.token2} />
					</>,
				)}
				{renderReportField('Current Price', <CurrencyValue value={report.price} suffix={`${report.token1Symbol} / ${report.token2Symbol}`} copyable={false} />)}
				{renderReportField('Current Reporter', report.currentReporter === zeroAddress ? 'None' : <AddressValue address={report.currentReporter} />)}
				{renderReportField('Current Amount1', <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} />)}
				{renderReportField('Current Amount2', <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} />)}
				{renderReportField('Report Timestamp', <TimestampValue timestamp={report.reportTimestamp} zeroText='Awaiting initial report' />)}
				{renderReportField('Settlement Timestamp', <TimestampValue timestamp={report.settlementTimestamp} zeroText='Not settled' />)}
			</div>
		</EntityCard>
	)
}

function renderSelectedReportActionSection(
	actionMode: OpenOracleSelectedReportActionMode,
	isConnected: boolean,
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction'],
	openOracleForm: OpenOracleFormState,
	initialReportSubmission: ReturnType<typeof deriveOpenOracleInitialReportSubmissionDetails>,
	openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'],
	token1Symbol: string,
	token2Symbol: string,
	onApproveToken1: (amount?: bigint) => void,
	onApproveToken2: (amount?: bigint) => void,
	onDisputeReport: () => void,
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void,
	onRefreshPrice: () => void,
	onSettleReport: () => void,
	onSubmitInitialReport: () => void,
) {
	const disputeTokenOptions: EnumDropdownOption<OpenOracleFormState['disputeTokenToSwap']>[] = [
		{ value: 'token1', label: token1Symbol },
		{ value: 'token2', label: token2Symbol },
	]
	switch (actionMode) {
		case 'initial-report':
			return (
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Initial Report</h4>
					</div>
					<div className='form-grid'>
						<div className='field-row'>
							<label className='field'>
								<span>{`Price (${token1Symbol} / ${token2Symbol})`}</span>
								<input value={openOracleForm.price} onInput={event => onOpenOracleFormChange({ price: event.currentTarget.value })} placeholder='1.00' />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={onRefreshPrice} disabled={openOracleInitialReportState.loading}>
									{openOracleInitialReportState.loading ? 'Fetching...' : 'Fetch Price'}
								</button>
							</div>
						</div>
						<p className='detail'>
							Price source: <strong>{openOracleInitialReportState.loading ? 'Loading...' : initialReportSubmission.priceSource}</strong>
						</p>
						<div className='entity-card-subsection'>
							<div className='entity-card-subsection-header'>
								<h4>{`${token1Symbol} Approval`}</h4>
							</div>
							<TokenApprovalControl
								actionLabel='submitting the initial report'
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								guardMessage={!isConnected ? 'Connect a wallet before approving tokens.' : undefined}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={`Approving ${token1Symbol}...`}
								requiredAmount={initialReportSubmission.amount1}
								resetKey={`token1:${token1Symbol}:${initialReportSubmission.amount1?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token1Symbol}
								tokenUnits={initialReportSubmission.token1Decimals ?? 18}
							/>
						</div>

						<div className='entity-card-subsection'>
							<div className='entity-card-subsection-header'>
								<h4>{`${token2Symbol} Approval`}</h4>
							</div>
							<TokenApprovalControl
								actionLabel='submitting the initial report'
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								guardMessage={!isConnected ? 'Connect a wallet before approving tokens.' : initialReportSubmission.amount2 === undefined ? `Enter a valid ${token1Symbol} / ${token2Symbol} price before approving ${token2Symbol}.` : undefined}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={`Approving ${token2Symbol}...`}
								requiredAmount={initialReportSubmission.amount2}
								resetKey={`token2:${token2Symbol}:${initialReportSubmission.amount2?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token2Symbol}
								tokenUnits={initialReportSubmission.token2Decimals ?? 18}
							/>
						</div>
						<ErrorNotice message={initialReportSubmission.blockReason} />
						<div className='actions'>
							<button className='primary' onClick={onSubmitInitialReport} disabled={!isConnected || !initialReportSubmission.canSubmit || openOracleInitialReportState.loading}>
								Submit Initial Report
							</button>
						</div>
					</div>
				</div>
			)
		case 'dispute':
			return (
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Dispute Report</h4>
					</div>
					<div className='form-grid'>
						<label className='field'>
							<span>Token to Swap Out</span>
							<EnumDropdown options={disputeTokenOptions} value={openOracleForm.disputeTokenToSwap} onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })} />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>{`New ${token1Symbol} Amount`}</span>
								<input value={openOracleForm.disputeNewAmount1} onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>{`New ${token2Symbol} Amount`}</span>
								<input value={openOracleForm.disputeNewAmount2} onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })} />
							</label>
						</div>
						<div className='actions'>
							<button className='secondary' onClick={onDisputeReport} disabled={!isConnected || openOracleForm.reportId.trim() === ''}>
								Dispute & Swap
							</button>
						</div>
						<div className='actions'>
							<button className='secondary' onClick={onSettleReport} disabled={!isConnected || openOracleForm.reportId.trim() === ''}>
								Settle Report
							</button>
						</div>
					</div>
				</div>
			)
		case 'read-only':
			return (
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Settled Report</h4>
					</div>
					<p className='detail'>This report is settled. No write actions are available.</p>
				</div>
			)
	}
}

function renderReportDetailsCard(
	openOracleReportDetails: OpenOracleReportDetails | undefined,
	openOracleForm: OpenOracleFormState,
	openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'],
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction'],
	loadingOracleReport: boolean,
	isConnected: boolean,
	onApproveToken1: (amount?: bigint) => void,
	onApproveToken2: (amount?: bigint) => void,
	onDisputeReport: () => void,
	onLoadOracleReport: (reportId?: string) => void,
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void,
	onRefreshPrice: () => void,
	onSettleReport: () => void,
	onSubmitInitialReport: () => void,
) {
	if (openOracleReportDetails === undefined) {
		const reportPresentation = getReportPresentation({
			kind: 'report',
			state: loadingOracleReport ? 'loading' : openOracleForm.reportId.trim() === '' ? 'unknown' : 'missing',
		})
		return (
			<EntityCard className='selected-report-card' title='Selected Report'>
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Report Controls</h4>
					</div>
					<div className='form-grid'>
						<div className='field-row'>
							<label className='field'>
								<span>Report ID</span>
								<input value={openOracleForm.reportId} onInput={event => onOpenOracleFormChange({ reportId: event.currentTarget.value })} />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
									{loadingOracleReport ? <LoadingText>Loading...</LoadingText> : 'Open report'}
								</button>
							</div>
						</div>
					</div>
					{reportPresentation === undefined ? undefined : <StateHint presentation={reportPresentation} />}
				</div>
			</EntityCard>
		)
	}

	const status = getOpenOracleReportStatus({
		currentReporter: openOracleReportDetails.currentReporter,
		disputeOccurred: openOracleReportDetails.disputeOccurred,
		isDistributed: openOracleReportDetails.isDistributed,
		reportTimestamp: openOracleReportDetails.reportTimestamp,
	})
	const statusTone = getOpenOracleReportStatusTone(status)
	const actionMode = getOpenOracleSelectedReportActionMode(openOracleReportDetails)
	const initialReportSubmission = deriveOpenOracleInitialReportSubmissionDetails({
		approvedToken1Amount: openOracleInitialReportState.token1Approval.value,
		approvedToken2Amount: openOracleInitialReportState.token2Approval.value,
		defaultPrice: openOracleInitialReportState.defaultPrice,
		defaultPriceError: openOracleInitialReportState.defaultPriceError,
		defaultPriceSource: openOracleInitialReportState.defaultPriceSource,
		priceInput: openOracleForm.price,
		quoteAttemptedSources: openOracleInitialReportState.quoteAttemptedSources,
		quoteFailureReason: openOracleInitialReportState.quoteFailureReason,
		reportDetails: openOracleReportDetails,
		token1AllowanceError: openOracleInitialReportState.token1Approval.error,
		token2AllowanceError: openOracleInitialReportState.token2Approval.error,
		token1Decimals: openOracleInitialReportState.token1Decimals ?? openOracleReportDetails.token1Decimals,
		token2Decimals: openOracleInitialReportState.token2Decimals ?? openOracleReportDetails.token2Decimals,
	})

	return (
		<EntityCard className='selected-report-card' title='Selected Report' badge={<span className={`badge ${statusTone}`}>{status}</span>}>
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Report Controls</h4>
				</div>
				<div className='form-grid'>
					<div className='field-row'>
						<label className='field'>
							<span>Report ID</span>
							<input value={openOracleForm.reportId} onInput={event => onOpenOracleFormChange({ reportId: event.currentTarget.value })} />
						</label>
						<div className='actions'>
							<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
								{loadingOracleReport ? <LoadingText>Loading...</LoadingText> : 'Refresh report'}
							</button>
						</div>
					</div>
				</div>
			</div>

			{renderReportSection('Identity', [
				{
					label: 'Oracle Address',
					value: <AddressValue address={openOracleReportDetails.openOracleAddress} />,
				},
				{
					label: openOracleReportDetails.token1Symbol,
					value: <AddressValue address={openOracleReportDetails.token1} />,
				},
				{
					label: openOracleReportDetails.token2Symbol,
					value: <AddressValue address={openOracleReportDetails.token2} />,
				},
				{
					label: 'Current Reporter',
					value: openOracleReportDetails.currentReporter === zeroAddress ? 'None (awaiting initial report)' : <AddressValue address={openOracleReportDetails.currentReporter} />,
				},
				{
					label: 'Initial Reporter',
					value: openOracleReportDetails.initialReporter === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.initialReporter} />,
				},
			])}

			{renderReportSection('Economics', [
				{
					label: `Exact ${openOracleReportDetails.token1Symbol} Required`,
					value: <CurrencyValue value={openOracleReportDetails.exactToken1Report} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
				},
				{
					label: `Current ${openOracleReportDetails.token1Symbol}`,
					value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
				},
				{
					label: `Current ${openOracleReportDetails.token2Symbol}`,
					value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} copyable={false} />,
				},
				{
					label: 'Price',
					value: <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} copyable={false} />,
				},
				{
					label: 'Fee',
					value: <CurrencyValue value={openOracleReportDetails.fee} suffix='ETH' copyable={false} />,
				},
				{
					label: 'Settler Reward',
					value: <CurrencyValue value={openOracleReportDetails.settlerReward} suffix='ETH' copyable={false} />,
				},
				{
					label: 'Escalation Halt',
					value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
				},
			])}

			{renderReportSection('Status', [
				{
					label: 'Report Timestamp',
					value: <TimestampValue timestamp={openOracleReportDetails.reportTimestamp} zeroText='Awaiting initial report' />,
				},
				{
					label: 'Dispute Occurred',
					value: openOracleReportDetails.disputeOccurred ? 'Yes' : 'No',
				},
				{
					label: 'Distributed',
					value: openOracleReportDetails.isDistributed ? 'Yes' : 'No',
				},
				{
					label: 'Settlement Timestamp',
					value: <TimestampValue timestamp={openOracleReportDetails.settlementTimestamp} zeroText='Not settled' />,
				},
				{
					label: 'Last Report Opportunity',
					value: openOracleReportDetails.lastReportOppoTime === 0n ? 'None' : `${openOracleReportDetails.lastReportOppoTime.toString()} ${openOracleReportDetails.timeType ? 's' : ' blocks'}`,
				},
				{
					label: 'State Hash',
					value: openOracleReportDetails.stateHash,
				},
			])}

			{renderReportSection('Settlement', [
				{
					label: 'Settlement Time',
					value: `${openOracleReportDetails.settlementTime.toString()} ${openOracleReportDetails.timeType ? 's' : ' blocks'}`,
				},
				{
					label: 'Dispute Delay',
					value: `${openOracleReportDetails.disputeDelay.toString()} ${openOracleReportDetails.timeType ? 's' : ' blocks'}`,
				},
				{
					label: 'Fee Percentage',
					value: formatOpenOracleFeePercentage(openOracleReportDetails.feePercentage),
				},
				{
					label: 'Protocol Fee',
					value: formatOpenOracleFeePercentage(openOracleReportDetails.protocolFee),
				},
				{
					label: 'Multiplier',
					value: formatOpenOracleMultiplier(openOracleReportDetails.multiplier),
				},
			])}

			{renderReportSection('Callback / Extra', [
				{
					label: 'Callback Contract',
					value: openOracleReportDetails.callbackContract === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.callbackContract} />,
				},
				{
					label: 'Callback Selector',
					value: openOracleReportDetails.callbackSelector === '0x00000000' ? 'None' : openOracleReportDetails.callbackSelector,
				},
				{
					label: 'Callback Gas Limit',
					value: openOracleReportDetails.callbackGasLimit === 0 ? 'None' : openOracleReportDetails.callbackGasLimit.toString(),
				},
				{
					label: 'Protocol Fee Recipient',
					value: openOracleReportDetails.protocolFeeRecipient === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.protocolFeeRecipient} />,
				},
				{
					label: 'Track Disputes',
					value: openOracleReportDetails.trackDisputes ? 'Yes' : 'No',
				},
				{
					label: 'Keep Fee',
					value: openOracleReportDetails.keepFee ? 'Yes' : 'No',
				},
				{
					label: 'Fee Token',
					value: openOracleReportDetails.feeToken ? openOracleReportDetails.token1Symbol : 'ETH',
				},
				{
					label: 'Number of Reports',
					value: openOracleReportDetails.numReports.toString(),
				},
			])}

			{renderSelectedReportActionSection(
				actionMode,
				isConnected,
				openOracleActiveAction,
				openOracleForm,
				initialReportSubmission,
				openOracleInitialReportState,
				openOracleReportDetails.token1Symbol,
				openOracleReportDetails.token2Symbol,
				onApproveToken1,
				onApproveToken2,
				onDisputeReport,
				onOpenOracleFormChange,
				onRefreshPrice,
				onSettleReport,
				onSubmitInitialReport,
			)}
		</EntityCard>
	)
}

function renderLatestActionCard(action: OpenOracleSectionProps['openOracleResult']) {
	if (action === undefined) return undefined

	return (
		<EntityCard title='Latest Oracle Action' badge={<span className='badge ok'>{action.action}</span>}>
			<p className='detail'>Action: {action.action}</p>
			<p className='detail'>
				Transaction: <TransactionHashLink hash={action.hash} />
			</p>
		</EntityCard>
	)
}

export function OpenOracleSection({
	accountState,
	loadingOracleReport,
	onApproveToken1,
	onApproveToken2,
	onCreateOpenOracleGame,
	onDisputeReport,
	onLoadOracleReport,
	onOpenOracleCreateFormChange,
	onOpenOracleFormChange,
	onRefreshPrice,
	onSettleReport,
	onSubmitInitialReport,
	loadingOpenOracleCreate,
	openOracleActiveAction,
	openOracleCreateForm,
	openOracleError,
	openOracleForm,
	openOracleInitialReportState,
	openOracleReportDetails,
	openOracleResult,
	initialView,
}: OpenOracleSectionProps) {
	const [view, setView] = useState<OpenOracleView>(() =>
		resolveFirstMatchingValue<OpenOracleView>(
			[
				[initialView !== undefined, initialView ?? 'browse'],
				[openOracleForm.reportId !== '', 'selected-report'],
			],
			'browse',
		),
	)
	const [browsePage, setBrowsePage] = useState<OpenOracleReportSummaryPage | undefined>(undefined)
	const [browseError, setBrowseError] = useState<string | undefined>(undefined)
	const [browsePageIndex, setBrowsePageIndex] = useState(0)
	const browseLoad = useLoadController()
	const isConnected = accountState.address !== undefined

	useEffect(() => {
		if (initialView !== undefined) {
			setView(initialView)
		}
	}, [initialView])

	useEffect(() => {
		let cancelled = false
		const shouldLoadBrowse = view === 'browse' || openOracleResult?.action === 'createReportInstance'
		if (!shouldLoadBrowse) return undefined

		const loadBrowseReports = async () => {
			await browseLoad.run({
				isCurrent: () => !cancelled,
				onStart: () => {
					setBrowseError(undefined)
				},
				load: async () => await loadOpenOracleReportSummaries(createConnectedReadClient(), browsePageIndex, BROWSE_PAGE_SIZE),
				onSuccess: page => {
					setBrowsePage(page)
				},
				onError: error => {
					setBrowsePage(undefined)
					setBrowseError(error instanceof Error ? error.message : 'Failed to load Open Oracle reports')
				},
			})
		}

		void loadBrowseReports()
		return () => {
			cancelled = true
		}
	}, [browsePageIndex, openOracleResult?.action, openOracleResult?.hash, view])

	const loadingBrowse = browseLoad.isLoading.value
	const browseReportCount = browsePage?.reportCount ?? 0n
	const browsePageCount = browsePage === undefined || browseReportCount === 0n ? 0 : Math.ceil(Number(browseReportCount) / BROWSE_PAGE_SIZE)
	const browseHasPreviousPage = browsePageIndex > 0
	const browseHasNextPage = browsePage !== undefined && browsePageIndex + 1 < browsePageCount

	const openBrowseReport = async (reportId: bigint) => {
		onOpenOracleFormChange({ reportId: reportId.toString() })
		setView('selected-report')
		await onLoadOracleReport(reportId.toString())
	}

	return (
		<section className='panel market-panel'>
			<div className='subtab-nav' role='tablist' aria-label='Open Oracle views'>
				<button className={`subtab-link ${view === 'browse' ? 'active' : ''}`} type='button' onClick={() => setView('browse')} aria-pressed={view === 'browse'}>
					Browse
				</button>
				<button className={`subtab-link ${view === 'create' ? 'active' : ''}`} type='button' onClick={() => setView('create')} aria-pressed={view === 'create'}>
					Create
				</button>
				<button className={`subtab-link ${view === 'selected-report' ? 'active' : ''}`} type='button' onClick={() => setView('selected-report')} aria-pressed={view === 'selected-report'}>
					Selected Report
				</button>
			</div>

			{view === 'browse' ? (
				<div className='market-grid'>
					<div className='market-column'>
						<EntityCard title='Open Oracle Games' badge={<span className='badge muted'>{browseReportCount.toString()} total</span>}>
							<p className='detail'>Browse every Open Oracle game and click a card to open its selected-report view.</p>
							{loadingBrowse ? (
								<p className='detail'>
									<span className='loading-value' role='status' aria-label='Loading report summaries'>
										<span className='spinner' aria-hidden='true' />
									</span>
								</p>
							) : undefined}
							<ErrorNotice message={browseError} />
							{browsePage === undefined || browsePage.reports.length === 0 ? <p className='detail'>No Open Oracle games found.</p> : <div className='entity-card-list'>{browsePage.reports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>}
						</EntityCard>
					</div>

					<div className='market-column'>
						<EntityCard title='Browse Controls' badge={<span className='badge muted'>{browsePageCount === 0 ? '0 pages' : `Page ${browsePageIndex + 1} / ${browsePageCount}`}</span>}>
							<div className='actions'>
								<button className='secondary' type='button' onClick={() => setBrowsePageIndex(current => Math.max(0, current - 1))} disabled={!browseHasPreviousPage || loadingBrowse}>
									Previous Page
								</button>
								<button className='secondary' type='button' onClick={() => setBrowsePageIndex(current => current + 1)} disabled={!browseHasNextPage || loadingBrowse}>
									Next Page
								</button>
							</div>
							<p className='detail'>Page size is fixed at {BROWSE_PAGE_SIZE} reports.</p>
							{renderLatestActionCard(openOracleResult)}
						</EntityCard>
					</div>
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='market-grid'>
					<div className='market-column'>{renderLatestActionCard(openOracleResult)}</div>

					<div className='market-column'>
						<EntityCard title='Create Open Oracle Game' badge={<span className='badge muted'>direct</span>}>
							<p className='detail'>Create a standalone Open Oracle game directly. This does not queue an oracle-manager operation.</p>
							<div className='form-grid'>
								<div className='field-row'>
									<label className='field'>
										<span>Token1 Address</span>
										<input value={openOracleCreateForm.token1Address} onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })} placeholder='0x...' />
									</label>
									<label className='field'>
										<span>Token2 Address</span>
										<input value={openOracleCreateForm.token2Address} onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })} placeholder='0x...' />
									</label>
								</div>

								<div className='field-row'>
									<label className='field'>
										<span>Exact Token1 Report</span>
										<input value={openOracleCreateForm.exactToken1Report} onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Settler Reward</span>
										<input value={openOracleCreateForm.settlerReward} onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} />
									</label>
								</div>

								<label className='field'>
									<span>ETH Value To Send</span>
									<input value={openOracleCreateForm.ethValue} onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })} />
								</label>

								<div className='field-row'>
									<label className='field'>
										<span>Fee Percentage</span>
										<input value={openOracleCreateForm.feePercentage} onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Multiplier</span>
										<input value={openOracleCreateForm.multiplier} onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} />
									</label>
								</div>

								<div className='field-row'>
									<label className='field'>
										<span>Settlement Time</span>
										<input value={openOracleCreateForm.settlementTime} onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Escalation Halt</span>
										<input value={openOracleCreateForm.escalationHalt} onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} />
									</label>
								</div>

								<div className='field-row'>
									<label className='field'>
										<span>Dispute Delay</span>
										<input value={openOracleCreateForm.disputeDelay} onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Protocol Fee</span>
										<input value={openOracleCreateForm.protocolFee} onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} />
									</label>
								</div>

								<div className='actions'>
									<button className='primary' onClick={onCreateOpenOracleGame} disabled={!isConnected || loadingOpenOracleCreate}>
										{loadingOpenOracleCreate ? <LoadingText>Creating...</LoadingText> : 'Create Open Oracle Game'}
									</button>
								</div>
							</div>
						</EntityCard>

						<ErrorNotice message={openOracleError} />
					</div>
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='market-grid'>
					<div className='market-column'>
						{renderReportDetailsCard(openOracleReportDetails, openOracleForm, openOracleInitialReportState, openOracleActiveAction, loadingOracleReport, isConnected, onApproveToken1, onApproveToken2, onDisputeReport, onLoadOracleReport, onOpenOracleFormChange, onRefreshPrice, onSettleReport, onSubmitInitialReport)}
						{renderLatestActionCard(openOracleResult)}
					</div>
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</section>
	)
}
