import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from 'viem'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RequirementsChecklist } from './RequirementsChecklist.js'
import { ResultBanner } from './ResultBanner.js'
import { RouteHeader } from './RouteHeader.js'
import { SectionBlock } from './SectionBlock.js'
import { StickyObjectContext } from './StickyObjectContext.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TimestampValue } from './TimestampValue.js'
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
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js'
import { loadOpenOracleReportSummaries } from '../contracts.js'
import { getReportPresentation } from '../lib/userCopy.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../types/contracts.js'
import type { OpenOracleSectionProps, ReadinessBlocker, WorkflowOutcomePresentation } from '../types/components.js'

const BROWSE_PAGE_SIZE = 10
type SelectedReportModal = 'dispute' | 'initial-report' | 'settle' | undefined
type BrowseStatusFilter = 'all' | 'Awaiting Initial Report' | 'Pending' | 'Disputed' | 'Settled'

function resolveBrowseStatusFilter(value: string): BrowseStatusFilter {
	switch (value) {
		case 'Awaiting Initial Report':
		case 'Pending':
		case 'Disputed':
		case 'Settled':
		case 'all':
			return value
		default:
			return 'all'
	}
}

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
	const initialReportRequirements: ReadinessBlocker[] = [
		{ key: 'wallet', label: 'Wallet connected', resolved: isConnected, ...(isConnected ? {} : { detail: 'Connect a wallet before submitting the initial report.' }) },
		{ key: 'price', label: 'Valid price entered', resolved: initialReportSubmission.price !== undefined && initialReportSubmission.price > 0n, ...(initialReportSubmission.price !== undefined && initialReportSubmission.price > 0n ? {} : { detail: `Enter a valid ${token1Symbol} / ${token2Symbol} price first.` }) },
		{ key: 'token1-approval', label: `${token1Symbol} approval ready`, resolved: initialReportSubmission.token1Approval.hasSufficientApproval, ...(initialReportSubmission.token1Approval.hasSufficientApproval ? {} : { detail: `Approve enough ${token1Symbol} inside this modal.` }) },
		{ key: 'token2-approval', label: `${token2Symbol} approval ready`, resolved: initialReportSubmission.token2Approval.hasSufficientApproval, ...(initialReportSubmission.token2Approval.hasSufficientApproval ? {} : { detail: `Approve enough ${token2Symbol} inside this modal.` }) },
		{ key: 'submission', label: 'Submission ready', resolved: initialReportSubmission.canSubmit, ...(initialReportSubmission.canSubmit ? {} : { detail: initialReportSubmission.blockMessage?.message ?? 'Resolve the remaining report requirements before submitting.' }) },
	]
	const disputeRequirements: ReadinessBlocker[] = [
		{ key: 'wallet', label: 'Wallet connected', resolved: isConnected, ...(isConnected ? {} : { detail: 'Connect a wallet before disputing this report.' }) },
		{ key: 'window', label: 'Report is in dispute window', resolved: disputeAvailability.canAct, ...(disputeAvailability.canAct ? {} : { detail: disputeAvailability.message ?? 'This report cannot be disputed right now.' }) },
		{ key: 'amount1', label: `New ${token1Symbol} amount entered`, resolved: openOracleForm.disputeNewAmount1.trim() !== '', ...(openOracleForm.disputeNewAmount1.trim() !== '' ? {} : { detail: `Enter the replacement ${token1Symbol} amount.` }) },
		{ key: 'amount2', label: `New ${token2Symbol} amount entered`, resolved: openOracleForm.disputeNewAmount2.trim() !== '', ...(openOracleForm.disputeNewAmount2.trim() !== '' ? {} : { detail: `Enter the replacement ${token2Symbol} amount.` }) },
	]
	const settleRequirements: ReadinessBlocker[] = [
		{ key: 'wallet', label: 'Wallet connected', resolved: isConnected, ...(isConnected ? {} : { detail: 'Connect a wallet before settling this report.' }) },
		{ key: 'window', label: 'Report is settleable', resolved: settleAvailability.canAct, ...(settleAvailability.canAct ? {} : { detail: settleAvailability.message ?? 'This report is not ready to settle yet.' }) },
	]

	switch (actionMode) {
		case 'initial-report':
			return (
				<SectionBlock headingLevel={4} title='Initial Report' variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection('Report Context', [
									{ label: 'Report', value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: 'Token Pair', value: `${token1Symbol} / ${token2Symbol}` },
									{ label: 'Stage', value: 'Awaiting Initial Report' },
								])}
						<div className='field-row'>
							<label className='field'>
								<span>{`Price (${token1Symbol} / ${token2Symbol})`}</span>
								<FormInput value={openOracleForm.price} onInput={event => onOpenOracleFormChange({ price: event.currentTarget.value })} placeholder='1.00' />
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
						<RequirementsChecklist items={initialReportRequirements} />
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
			return (
				<SectionBlock headingLevel={4} title='Dispute Report' variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection('Current Report State', [
									{ label: 'Report', value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: 'Current Reporter', value: openOracleReportDetails.currentReporter === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: 'Current Price', value: <CurrencyValue value={openOracleReportDetails.price} suffix={`${token1Symbol} / ${token2Symbol}`} copyable={false} /> },
								])}
						<label className='field'>
							<span>Token to Swap Out</span>
							<EnumDropdown options={disputeTokenOptions} value={openOracleForm.disputeTokenToSwap} onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })} />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>{`New ${token1Symbol} Amount`}</span>
								<FormInput value={openOracleForm.disputeNewAmount1} onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>{`New ${token2Symbol} Amount`}</span>
								<FormInput value={openOracleForm.disputeNewAmount2} onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })} />
							</label>
						</div>
						<RequirementsChecklist items={disputeRequirements} />
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
			)
		}
		case 'settle': {
			const settleDisabledMessage = !isConnected ? 'Connect a wallet before settling reports.' : openOracleForm.reportId.trim() === '' ? 'Load a report first.' : settleAvailability.message
			return (
				<SectionBlock headingLevel={4} title='Settle Report' variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection('Settlement Summary', [
									{ label: 'Report', value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: 'Current Reporter', value: openOracleReportDetails.currentReporter === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: 'Settlement Timestamp', value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText='Not settled' /> },
								])}
						<p className='detail'>Settlement is confirmation-first. Review the current report state and confirm only when the dispute window is closed.</p>
						<RequirementsChecklist items={settleRequirements} />
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
	selectedReportModal: SelectedReportModal,
	onApproveToken1: (amount?: bigint) => void,
	onApproveToken2: (amount?: bigint) => void,
	onDisputeReport: () => void,
	onLoadOracleReport: (reportId?: string) => void,
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void,
	onRefreshPrice: () => void,
	onSelectedReportModalChange: (modal: SelectedReportModal) => void,
	onSettleReport: () => void,
	onSubmitInitialReport: () => void,
	onWrapWethForInitialReport: () => void,
) {
	const reportControls = (
		<div className='form-grid'>
			<LookupFieldRow
				label='Report ID'
				value={openOracleForm.reportId}
				onInput={reportId => onOpenOracleFormChange({ reportId })}
				action={
					<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
						{loadingOracleReport ? <LoadingText>Loading...</LoadingText> : openOracleReportDetails === undefined ? 'Open report' : 'Refresh report'}
					</button>
				}
			/>
		</div>
	)

	if (openOracleReportDetails === undefined) {
		const reportPresentation = getReportPresentation({
			kind: 'report',
			state: loadingOracleReport ? 'loading' : openOracleForm.reportId.trim() === '' ? 'unknown' : 'missing',
		})
		return (
			<SectionBlock title='Selected Report'>
				{reportControls}
				{reportPresentation === undefined ? undefined : <StateHint presentation={reportPresentation} />}
			</SectionBlock>
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
	const stage = getOpenOracleStagePresentation(actionMode)
	const disputeAvailability = getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = getOpenOracleSettleAvailability(openOracleReportDetails)
	const readinessActions = getOpenOracleReadinessActions({
		actionMode,
		disputeMessage: disputeAvailability.message,
		hasReport: true,
		isConnected,
		reportId: openOracleForm.reportId,
		settleMessage: settleAvailability.message,
	}).map(action =>
		action.key === 'submit-initial-report'
			? { ...action, onAction: () => onSelectedReportModalChange('initial-report') }
			: action.key === 'dispute-report'
				? { ...action, onAction: () => onSelectedReportModalChange('dispute') }
				: action.key === 'settle-report'
					? { ...action, onAction: () => onSelectedReportModalChange('settle') }
					: action,
	)
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
			<StickyObjectContext
				eyebrow='Open Oracle Selected Report'
				title={`Report #${openOracleReportDetails.reportId.toString()}`}
				items={[
					{ label: 'Stage', value: stage.label },
					{ label: 'Token Pair', value: `${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}` },
					{ label: 'Reporter', value: openOracleReportDetails.currentReporter === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{ label: 'Price', value: <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} copyable={false} /> },
				]}
			/>
			<LifecycleStageBanner stage={stage} />
			<SectionBlock title='Selected Report Actions' description='Open a focused action flow for the selected report when it is available.'>
				<div className='action-readiness-grid'>
					{readinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<SectionBlock badge={<span className={`badge ${statusTone}`}>{status}</span>} title='Selected Report'>
				{reportControls}
				<DataGrid className='question-summary-grid'>
					{renderReportField('Report ID', openOracleReportDetails.reportId.toString())}
					{renderReportField('Oracle Address', <AddressValue address={openOracleReportDetails.openOracleAddress} />)}
					{renderReportField('Current Reporter', openOracleReportDetails.currentReporter === zeroAddress ? 'None (awaiting initial report)' : <AddressValue address={openOracleReportDetails.currentReporter} />)}
					{renderReportField('Current Price', <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} copyable={false} />)}
					{renderReportField('Settlement Timestamp', <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText='Not settled' />)}
				</DataGrid>
			</SectionBlock>
			<div className='report-detail-stack'>
				<ReadOnlyDetailAccordion defaultOpen title='Identity'>
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
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title='Economics'>
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
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title='Status'>
					{renderReportSection('Status', [
						{
							label: 'Report Timestamp',
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.reportTimestamp} zeroText='Awaiting initial report' />,
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
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText='Not settled' />,
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
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title='Settlement'>
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
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title='Callback / Extra'>
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
				</ReadOnlyDetailAccordion>
			</div>

			<OperationModal isOpen={selectedReportModal === 'initial-report'} onClose={() => onSelectedReportModalChange(undefined)} title='Submit Initial Report' description='Review price source, approvals, and token balances before submitting the initial report.'>
				{renderSelectedReportActionSection(
					'initial-report',
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
			</OperationModal>

			<OperationModal isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title='Dispute & Swap' description='Provide the replacement swap amounts for the selected report.'>
				{renderSelectedReportActionSection(
					'dispute',
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
			</OperationModal>

			<OperationModal isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title='Settle Report' description='Confirm settlement once the selected report is ready.'>
				{renderSelectedReportActionSection(
					'settle',
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
			</OperationModal>
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

function getOpenOracleOutcomePresentation(action: OpenOracleSectionProps['openOracleResult']): WorkflowOutcomePresentation | undefined {
	if (action === undefined) return undefined

	switch (action.action) {
		case 'approveToken1':
			return {
				detail: 'Token1 approval was updated for the selected report workflow.',
				nextStep: 'Return to the report modal and complete the report submission.',
				title: 'Token1 Approved',
			}
		case 'approveToken2':
			return {
				detail: 'Token2 approval was updated for the selected report workflow.',
				nextStep: 'Return to the report modal and complete the report submission.',
				title: 'Token2 Approved',
			}
		case 'wrapWeth':
			return {
				detail: 'ETH was wrapped to WETH for the selected report flow.',
				nextStep: 'Submit the initial report once all requirements are ready.',
				title: 'WETH Wrapped',
			}
		case 'submitInitialReport':
			return {
				detail: 'The selected report now has an initial report on-chain.',
				nextStep: 'Monitor the dispute window and settle once the report is ready.',
				title: 'Initial Report Submitted',
			}
		case 'dispute':
			return {
				detail: 'The selected report was disputed with the replacement swap amounts.',
				nextStep: 'Monitor the updated report state and settle when the dispute window closes.',
				title: 'Report Disputed',
			}
		case 'settle':
			return {
				detail: 'The selected report was settled on-chain.',
				nextStep: 'No further write actions are expected for this report.',
				title: 'Report Settled',
			}
		case 'createReportInstance':
			return {
				detail: 'A new Open Oracle game was created.',
				nextStep: 'Open the new report to continue its lifecycle.',
				title: 'Open Oracle Game Created',
			}
	}

	return undefined
}

export function OpenOracleSection({
	activeView,
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
	onActiveViewChange,
}: OpenOracleSectionProps) {
	const view = activeView
	const [browsePage, setBrowsePage] = useState<OpenOracleReportSummaryPage | undefined>(undefined)
	const [browseError, setBrowseError] = useState<string | undefined>(undefined)
	const [browsePageIndex, setBrowsePageIndex] = useState(0)
	const [browseSearchText, setBrowseSearchText] = useState('')
	const [browseStatusFilter, setBrowseStatusFilter] = useState<BrowseStatusFilter>('all')
	const [selectedReportModal, setSelectedReportModal] = useState<SelectedReportModal>(undefined)
	const browseLoad = useLoadController()
	const isConnected = accountState.address !== undefined
	const openOracleOutcome = getOpenOracleOutcomePresentation(openOracleResult)

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

	useEffect(() => {
		if (openOracleResult === undefined) return
		if (openOracleResult.action === 'approveToken1' || openOracleResult.action === 'approveToken2' || openOracleResult.action === 'wrapWeth') return
		setSelectedReportModal(undefined)
	}, [openOracleResult])

	const loadingBrowse = browseLoad.isLoading.value
	const normalizedBrowseSearchText = browseSearchText.trim().toLowerCase()
	const browseReportCount = browsePage?.reportCount ?? 0n
	const browsePageCount = browsePage === undefined || browseReportCount === 0n ? 0 : Math.ceil(Number(browseReportCount) / BROWSE_PAGE_SIZE)
	const browseHasPreviousPage = browsePageIndex > 0
	const browseHasNextPage = browsePage !== undefined && browsePageIndex + 1 < browsePageCount
	const filteredBrowseReports =
		browsePage?.reports.filter(report => {
			const status = getOpenOracleReportStatus(report)
			if (browseStatusFilter !== 'all' && status !== browseStatusFilter) return false
			if (normalizedBrowseSearchText === '') return true
			return (
				report.reportId.toString().includes(normalizedBrowseSearchText) ||
				report.token1Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token2Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token1.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token2.toLowerCase().includes(normalizedBrowseSearchText)
			)
		}) ?? []
	const showRouteHeader = view !== 'selected-report'
	const createRequirements: ReadinessBlocker[] = [
		{ key: 'wallet', label: 'Wallet connected', resolved: isConnected, ...(isConnected ? {} : { detail: 'Connect a wallet before creating an Open Oracle game.' }) },
		{ key: 'token1', label: 'Token1 address provided', resolved: openOracleCreateForm.token1Address.trim() !== '', ...(openOracleCreateForm.token1Address.trim() !== '' ? {} : { detail: 'Enter the Token1 address.' }) },
		{ key: 'token2', label: 'Token2 address provided', resolved: openOracleCreateForm.token2Address.trim() !== '', ...(openOracleCreateForm.token2Address.trim() !== '' ? {} : { detail: 'Enter the Token2 address.' }) },
		{ key: 'settlement-time', label: 'Settlement time provided', resolved: openOracleCreateForm.settlementTime.trim() !== '', ...(openOracleCreateForm.settlementTime.trim() !== '' ? {} : { detail: 'Enter the settlement time.' }) },
		{ key: 'multiplier', label: 'Multiplier provided', resolved: openOracleCreateForm.multiplier.trim() !== '', ...(openOracleCreateForm.multiplier.trim() !== '' ? {} : { detail: 'Enter the multiplier.' }) },
	]
	const openBrowseReport = async (reportId: bigint) => {
		onOpenOracleFormChange({ reportId: reportId.toString() })
		onActiveViewChange('selected-report')
		await onLoadOracleReport(reportId.toString())
	}

	return (
		<div className='route-view-flow'>
			{!showRouteHeader ? undefined : (
				<RouteHeader
					eyebrow='Open Oracle'
					title='Open Oracle'
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
			)}
			<ResultBanner outcome={openOracleOutcome} />
			{view === 'browse' ? (
				<div className='workflow-stack route-workflow-stack'>
					<SectionBlock
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
						density='compact'
						title='Browse Reports'
						description={`Browse every Open Oracle game and open a selected report view. Page size is fixed at ${BROWSE_PAGE_SIZE} reports.`}
					>
						<ErrorNotice message={browseError} />
						<div className='filter-toolbar'>
							<label className='field'>
								<span>Search Reports</span>
								<FormInput value={browseSearchText} onInput={event => setBrowseSearchText(event.currentTarget.value)} placeholder='Search by report ID, token symbol, or token address' />
							</label>
							<label className='field'>
								<span>Status</span>
								<select value={browseStatusFilter} onChange={event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
									<option value='all'>All statuses</option>
									<option value='Awaiting Initial Report'>Awaiting initial report</option>
									<option value='Pending'>Pending</option>
									<option value='Disputed'>Disputed</option>
									<option value='Settled'>Settled</option>
								</select>
							</label>
						</div>
						{browsePage === undefined ? undefined : (
							<p className='detail'>
								{filteredBrowseReports.length.toString()} of {browsePage.reports.length.toString()} reports shown on this page.
							</p>
						)}
						{loadingBrowse ? (
							<StateHint presentation={{ key: 'loading', badgeLabel: 'Loading', badgeTone: 'pending', detail: 'Refreshing report summaries.' }} />
						) : browsePage === undefined || browsePage.reports.length === 0 ? (
							<StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No Open Oracle games found.' }} />
						) : filteredBrowseReports.length === 0 ? (
							<StateHint presentation={{ key: 'empty', badgeLabel: 'No matches', badgeTone: 'muted', detail: 'No reports match the current search and status filters.' }} />
						) : (
							<div className='entity-card-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
						)}
					</SectionBlock>
					{renderLatestActionCard(openOracleResult)}
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{openOracleResult?.action !== 'createReportInstance' ? undefined : (
						<SectionBlock title='Create Success' description='The report instance was created successfully.'>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => onActiveViewChange('browse')}>
									Return to Browse
								</button>
								<button className='secondary' type='button' onClick={() => onActiveViewChange('create')}>
									Create Another
								</button>
							</div>
						</SectionBlock>
					)}
					{renderLatestActionCard(openOracleResult)}
					<SectionBlock title='Requirements' description='Resolve these checks before creating a new Open Oracle game.'>
						<RequirementsChecklist items={createRequirements} />
					</SectionBlock>
					<SectionBlock title='Create Open Oracle Game' description='Create a standalone Open Oracle game directly. This does not queue an oracle-manager operation.'>
						<div className='form-grid'>
							<SectionBlock headingLevel={4} title='Token Pair' variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>Token1 Address</span>
										<FormInput value={openOracleCreateForm.token1Address} onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })} placeholder='0x...' />
									</label>
									<label className='field'>
										<span>Token2 Address</span>
										<FormInput value={openOracleCreateForm.token2Address} onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })} placeholder='0x...' />
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title='Initial Economics' variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>Exact Token1 Report</span>
										<FormInput value={openOracleCreateForm.exactToken1Report} onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Settler Reward</span>
										<FormInput value={openOracleCreateForm.settlerReward} onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} />
									</label>
								</div>
								<label className='field'>
									<span>ETH Value To Send</span>
									<FormInput value={openOracleCreateForm.ethValue} onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })} />
								</label>
								<div className='field-row'>
									<label className='field'>
										<span>Fee Percentage</span>
										<FormInput value={openOracleCreateForm.feePercentage} onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Multiplier</span>
										<FormInput value={openOracleCreateForm.multiplier} onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} />
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title='Timing' variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>Settlement Time</span>
										<FormInput value={openOracleCreateForm.settlementTime} onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Escalation Halt</span>
										<FormInput value={openOracleCreateForm.escalationHalt} onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} />
									</label>
								</div>
								<div className='field-row'>
									<label className='field'>
										<span>Dispute Delay</span>
										<FormInput value={openOracleCreateForm.disputeDelay} onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} />
									</label>
									<label className='field'>
										<span>Protocol Fee</span>
										<FormInput value={openOracleCreateForm.protocolFee} onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} />
									</label>
								</div>
							</SectionBlock>

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
						selectedReportModal,
						onApproveToken1,
						onApproveToken2,
						onDisputeReport,
						onLoadOracleReport,
						onOpenOracleFormChange,
						onRefreshPrice,
						setSelectedReportModal,
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
