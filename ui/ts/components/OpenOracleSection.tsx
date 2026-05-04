import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TimestampValue } from './TimestampValue.js'
import { ViewTabs } from './ViewTabs.js'
import { useLoadController } from '../hooks/useLoadController.js'
import { createConnectedReadClient } from '../lib/clients.js'
import {
	deriveOpenOracleInitialReportSubmissionDetails,
	formatOpenOracleFeePercentage,
	formatOpenOracleMultiplier,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleReportStatusTone,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	type OpenOracleSelectedReportActionMode,
} from '../lib/openOracle.js'
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
		<SectionBlock headingLevel={4} title={title} variant='embedded'>
			<DataGrid className='question-summary-grid'>{fields.map(field => renderReportField(field.label, field.value))}</DataGrid>
		</SectionBlock>
	)
}

function renderInitialPriceSourceLabel(priceSource: string, priceSourceUrl: string | undefined) {
	if (priceSourceUrl === undefined) {
		return <strong>{priceSource}</strong>
	}

	return (
		<strong>
			<a href={priceSourceUrl} target='_blank' rel='noreferrer'>
				{priceSource}
			</a>
		</strong>
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
			<DataGrid className='question-summary-grid'>
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
			</DataGrid>
		</EntityCard>
	)
}

export function renderSelectedReportActionSection(
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
	onWrapWethForInitialReport: () => void,
	openOracleReportDetails?: OpenOracleReportDetails,
) {
	const disputeTokenOptions: EnumDropdownOption<OpenOracleFormState['disputeTokenToSwap']>[] = [
		{ value: 'token1', label: token1Symbol },
		{ value: 'token2', label: token2Symbol },
	]
	const showQuoteLoadingPlaceholder = openOracleInitialReportState.quoteLoading && openOracleForm.price.trim() === '' && openOracleInitialReportState.defaultPrice === undefined && openOracleInitialReportState.defaultPriceError === undefined
	const disputeAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleSettleAvailability(openOracleReportDetails)

	switch (actionMode) {
		case 'initial-report':
			return (
				<SectionBlock headingLevel={4} title='Initial Report' variant='embedded'>
					<div className='form-grid'>
						<div className='field-row'>
							<label className='field'>
								<span>{`Price (${token1Symbol} / ${token2Symbol})`}</span>
								<input value={openOracleForm.price} onInput={event => onOpenOracleFormChange({ price: event.currentTarget.value })} placeholder='1.00' />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={onRefreshPrice} disabled={openOracleInitialReportState.quoteLoading}>
									{openOracleInitialReportState.quoteLoading ? 'Fetching...' : 'Fetch price from Uniswap'}
								</button>
							</div>
						</div>
						<p className='detail'>Price source: {showQuoteLoadingPlaceholder ? <strong>Loading...</strong> : renderInitialPriceSourceLabel(initialReportSubmission.priceSource, initialReportSubmission.priceSourceUrl)}</p>
						<SectionBlock headingLevel={4} title={`${token1Symbol} Approval`} variant='embedded'>
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
						</SectionBlock>

						<SectionBlock headingLevel={4} title={`${token2Symbol} Approval`} variant='embedded'>
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
						</SectionBlock>
						{initialReportSubmission.requiredWethWrapAmount === undefined || initialReportSubmission.requiredWethWrapAmount <= 0n ? undefined : (
							<p className='detail'>
								Need <CurrencyValue value={initialReportSubmission.requiredWethWrapAmount} suffix='WETH' copyable={false} /> more WETH for this report.
							</p>
						)}
						{initialReportSubmission.wrapRequiredWethMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.wrapRequiredWethMessage.message}</p>}
						{initialReportSubmission.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.blockMessage.message}</p>}
						<div className='actions'>
							{!initialReportSubmission.hasWethWrapAction ? undefined : (
								<TransactionActionButton
									idleLabel='Wrap needed ETH to WETH'
									pendingLabel='Wrapping ETH...'
									onClick={onWrapWethForInitialReport}
									pending={openOracleActiveAction === 'wrapWeth'}
									tone='secondary'
									availability={{
										disabled: !isConnected || !initialReportSubmission.canWrapRequiredWeth,
										reason: !isConnected ? 'Connect a wallet before wrapping ETH.' : initialReportSubmission.wrapRequiredWethMessage?.kind === 'visible' ? initialReportSubmission.wrapRequiredWethMessage.message : undefined,
									}}
								/>
							)}
							<TransactionActionButton
								idleLabel='Submit Initial Report'
								pendingLabel='Submitting...'
								onClick={onSubmitInitialReport}
								pending={openOracleActiveAction === 'submitInitialReport'}
								availability={{
									disabled: !isConnected || !initialReportSubmission.canSubmit,
									reason: !isConnected ? 'Connect a wallet before submitting the initial report.' : initialReportSubmission.blockMessage?.kind === 'visible' ? initialReportSubmission.blockMessage.message : undefined,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		case 'dispute': {
			const disputeDisabledMessage = !isConnected ? 'Connect a wallet before disputing reports.' : openOracleForm.reportId.trim() === '' ? 'Load a report first.' : disputeAvailability.message
			const settleDisabledMessage = !isConnected ? 'Connect a wallet before settling reports.' : openOracleForm.reportId.trim() === '' ? 'Load a report first.' : settleAvailability.message
			return (
				<>
					<SectionBlock headingLevel={4} title='Dispute Report' variant='embedded'>
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
								<TransactionActionButton
									idleLabel='Dispute & Swap'
									pendingLabel='Submitting dispute...'
									onClick={onDisputeReport}
									pending={openOracleActiveAction === 'dispute'}
									tone='secondary'
									availability={{
										disabled: !isConnected || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct,
										reason: disputeDisabledMessage,
									}}
								/>
							</div>
						</div>
					</SectionBlock>
					<SectionBlock headingLevel={4} title='Settle Report' variant='embedded'>
						<div className='actions'>
							<TransactionActionButton
								idleLabel='Settle Report'
								pendingLabel='Settling report...'
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								tone='secondary'
								availability={{
									disabled: !isConnected || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
									reason: settleDisabledMessage,
								}}
							/>
						</div>
					</SectionBlock>
				</>
			)
		}
		case 'settle': {
			const settleDisabledMessage = !isConnected ? 'Connect a wallet before settling reports.' : openOracleForm.reportId.trim() === '' ? 'Load a report first.' : settleAvailability.message
			return (
				<SectionBlock headingLevel={4} title='Settle Report' variant='embedded'>
					<div className='form-grid'>
						<div className='actions'>
							<TransactionActionButton
								idleLabel='Settle Report'
								pendingLabel='Settling report...'
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								tone='secondary'
								availability={{
									disabled: !isConnected || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
									reason: settleDisabledMessage,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'read-only':
			return (
				<SectionBlock headingLevel={4} title='Settled Report' variant='embedded'>
					<p className='detail'>This report is settled. No write actions are available.</p>
				</SectionBlock>
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
	onWrapWethForInitialReport: () => void,
) {
	const reportControls = (
		<SectionBlock title='Report Controls'>
			<div className='form-grid'>
				<div className='field-row'>
					<label className='field'>
						<span>Report ID</span>
						<input value={openOracleForm.reportId} onInput={event => onOpenOracleFormChange({ reportId: event.currentTarget.value })} />
					</label>
					<div className='actions'>
						<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
							{loadingOracleReport ? <LoadingText>Loading...</LoadingText> : openOracleReportDetails === undefined ? 'Open report' : 'Refresh report'}
						</button>
					</div>
				</div>
			</div>
		</SectionBlock>
	)

	if (openOracleReportDetails === undefined) {
		const reportPresentation = getReportPresentation({
			kind: 'report',
			state: loadingOracleReport ? 'loading' : openOracleForm.reportId.trim() === '' ? 'unknown' : 'missing',
		})
		return (
			<>
				{reportControls}
				{reportPresentation === undefined ? undefined : <StateHint presentation={reportPresentation} />}
			</>
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
		defaultPriceSourceUrl: openOracleInitialReportState.defaultPriceSourceUrl,
		priceInput: openOracleForm.price,
		quoteAttemptedSources: openOracleInitialReportState.quoteAttemptedSources,
		quoteFailureReason: openOracleInitialReportState.quoteFailureReason,
		reportDetails: openOracleReportDetails,
		token1Balance: openOracleInitialReportState.token1Balance,
		token1BalanceError: openOracleInitialReportState.token1BalanceError,
		token1AllowanceError: openOracleInitialReportState.token1Approval.error,
		token2Balance: openOracleInitialReportState.token2Balance,
		token2BalanceError: openOracleInitialReportState.token2BalanceError,
		token2AllowanceError: openOracleInitialReportState.token2Approval.error,
		token1Decimals: openOracleInitialReportState.token1Decimals ?? openOracleReportDetails.token1Decimals,
		token2Decimals: openOracleInitialReportState.token2Decimals ?? openOracleReportDetails.token2Decimals,
		walletEthBalance: openOracleInitialReportState.ethBalance,
	})

	return (
		<>
			{reportControls}
			<EntityCard className='selected-report-card' title='Selected Report' badge={<span className={`badge ${statusTone}`}>{status}</span>}>
				<DataGrid className='question-summary-grid'>
					{renderReportField('Report ID', openOracleReportDetails.reportId.toString())}
					{renderReportField('Oracle Address', <AddressValue address={openOracleReportDetails.openOracleAddress} />)}
					{renderReportField('Current Reporter', openOracleReportDetails.currentReporter === zeroAddress ? 'None (awaiting initial report)' : <AddressValue address={openOracleReportDetails.currentReporter} />)}
					{renderReportField('Current Price', <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} copyable={false} />)}
					{renderReportField('Settlement Timestamp', <TimestampValue timestamp={openOracleReportDetails.settlementTimestamp} zeroText='Not settled' />)}
				</DataGrid>
			</EntityCard>

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
				onWrapWethForInitialReport,
				openOracleReportDetails,
			)}
		</>
	)
}

function renderLatestActionCard(action: OpenOracleSectionProps['openOracleResult']) {
	if (action === undefined) return undefined

	return (
		<LatestActionSection
			title='Latest Oracle Action'
			rows={[
				{ label: 'Action', value: action.action },
				{ label: 'Transaction', value: <TransactionHashLink hash={action.hash} /> },
			]}
		/>
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
	onWrapWethForInitialReport,
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
		<div className='route-view-flow'>
			<RouteHeader
				eyebrow='Open Oracle'
				title='Report operations'
				description='Browse direct reports, create new report instances, and manage selected report lifecycle actions.'
				summary={
					<DataGrid columns='auto'>
						<div>
							<p className='detail'>Browse count</p>
							<strong>{browseReportCount.toString()}</strong>
						</div>
						<div>
							<p className='detail'>Page</p>
							<strong>{browsePageCount === 0 ? '0 / 0' : `${browsePageIndex + 1} / ${browsePageCount}`}</strong>
						</div>
						<div>
							<p className='detail'>Selected report</p>
							<strong>{openOracleReportDetails?.reportId.toString() ?? (openOracleForm.reportId === '' ? 'None' : openOracleForm.reportId)}</strong>
						</div>
					</DataGrid>
				}
			/>
			<ViewTabs
				ariaLabel='Open Oracle views'
				className='route-subtab-nav'
				value={view}
				onChange={setView}
				options={[
					{ label: 'Browse', value: 'browse' },
					{ label: 'Create', value: 'create' },
					{ label: 'Selected Report', value: 'selected-report' },
				]}
			/>

			{view === 'browse' ? (
				<div className='workflow-stack route-workflow-stack'>
					<SectionBlock
						density='compact'
						title='Browse Reports'
						description={`Browse every Open Oracle game and open a selected report view. Page size is fixed at ${BROWSE_PAGE_SIZE} reports.`}
						actions={
							<div className='actions'>
								<button className='secondary' type='button' onClick={() => setBrowsePageIndex(current => Math.max(0, current - 1))} disabled={!browseHasPreviousPage || loadingBrowse}>
									Previous Page
								</button>
								<button className='secondary' type='button' onClick={() => setBrowsePageIndex(current => current + 1)} disabled={!browseHasNextPage || loadingBrowse}>
									Next Page
								</button>
							</div>
						}
					>
						<ErrorNotice message={browseError} />
						{loadingBrowse ? (
							<StateHint presentation={{ key: 'loading', badgeLabel: 'Loading', badgeTone: 'pending', detail: 'Refreshing report summaries.' }} />
						) : browsePage === undefined || browsePage.reports.length === 0 ? (
							<StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No Open Oracle games found.' }} />
						) : (
							<div className='entity-card-list'>{browsePage.reports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
						)}
					</SectionBlock>
					{renderLatestActionCard(openOracleResult)}
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{renderLatestActionCard(openOracleResult)}
					<SectionBlock title='Create Open Oracle Game' description='Create a standalone Open Oracle game directly. This does not queue an oracle-manager operation.'>
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
								<TransactionActionButton idleLabel='Create Open Oracle Game' pendingLabel='Creating...' onClick={onCreateOpenOracleGame} pending={loadingOpenOracleCreate} availability={{ disabled: !isConnected, reason: !isConnected ? 'Connect a wallet before creating an Open Oracle game.' : undefined }} />
							</div>
						</div>
					</SectionBlock>
					<ErrorNotice message={openOracleError} />
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='workflow-stack route-workflow-stack'>
					{renderReportDetailsCard(
						openOracleReportDetails,
						openOracleForm,
						openOracleInitialReportState,
						openOracleActiveAction,
						loadingOracleReport,
						isConnected,
						onApproveToken1,
						onApproveToken2,
						onDisputeReport,
						onLoadOracleReport,
						onOpenOracleFormChange,
						onRefreshPrice,
						onSettleReport,
						onSubmitInitialReport,
						onWrapWethForInitialReport,
					)}
					{renderLatestActionCard(openOracleResult)}
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</div>
	)
}
