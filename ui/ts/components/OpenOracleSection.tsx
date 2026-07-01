import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { PaginationControls } from './PaginationControls.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { SectionBlock } from './SectionBlock.js'
import { StickyObjectContext } from './StickyObjectContext.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { useLoadController } from '../hooks/useLoadController.js'
import { getOpenOracleActionSafetyId } from '../lib/actionSafety/ids.js'
import { assertNever } from '../lib/assert.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { useChainBlockNumber, useChainTimestamp } from '../lib/chainTimestamp.js'
import {
	getOpenOracleCreateGuardMessage,
	formatOpenOracleFeePercentage,
	formatOpenOracleMultiplier,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleReportStatusTone,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	type OpenOracleDisputeSubmissionDetails,
	type OpenOracleInitialReportSubmissionDetails,
	type OpenOracleSelectedReportActionMode,
} from '../lib/openOracle.js'
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount } from '../lib/pagination.js'
import { loadOpenOracleReportSummaries } from '../contracts.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportPresentation } from '../lib/userCopy.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../types/contracts.js'
import type { OpenOracleSectionProps } from '../types/components.js'
const BROWSE_PAGE_SIZE = 10
const OPEN_ORACLE_PRICE_UNITS = 30
type SelectedReportModal = 'dispute' | 'initial-report' | 'settle' | undefined
type BrowseStatusFilter = 'all' | 'Awaiting Initial Report' | 'Pending' | 'Disputed' | 'Settled'
function getEffectiveOpenOracleReportDetails(report: OpenOracleReportDetails | undefined, currentTimestamp: bigint | undefined, currentBlockNumber: bigint | undefined) {
	if (report === undefined) return undefined
	if ((currentTimestamp === undefined || report.currentTime === currentTimestamp) && (currentBlockNumber === undefined || report.currentBlockNumber === currentBlockNumber)) return report
	return {
		...report,
		currentBlockNumber: currentBlockNumber ?? report.currentBlockNumber,
		currentTime: currentTimestamp ?? report.currentTime,
	}
}
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
function renderReportSection(
	title: string,
	fields: Array<{
		label: string
		value: ComponentChildren
	}>,
) {
	return (
		<SectionBlock headingLevel={4} title={title} variant='embedded'>
			<MetricGrid variant='question'>{fields.map(field => renderReportField(field.label, field.value))}</MetricGrid>
		</SectionBlock>
	)
}
function renderInitialPriceSourceLabel(priceSource: string, priceSourceUrl: string | undefined) {
	if (priceSourceUrl === undefined) return <strong>{priceSource}</strong>
	return (
		<strong>
			<a href={priceSourceUrl} target='_blank' rel='noreferrer'>
				{priceSource}
			</a>
		</strong>
	)
}

function formatQuoteAge(quoteLoadedAtMs: number) {
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - quoteLoadedAtMs) / 1000))
	if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`
	const elapsedMinutes = Math.floor(elapsedSeconds / 60)
	if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`
	const elapsedHours = Math.floor(elapsedMinutes / 60)
	return `${elapsedHours}h ago`
}

function renderInitialPriceFreshness(openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'], priceSource: OpenOracleInitialReportSubmissionDetails['priceSource']) {
	if (priceSource !== 'MOCK' && priceSource !== 'Uniswap V3' && priceSource !== 'Uniswap V4') return undefined
	if (openOracleInitialReportState.quoteLoadedAtMs === undefined) return undefined
	const blockText = openOracleInitialReportState.quoteBlockNumber === undefined ? '' : ` at block ${openOracleInitialReportState.quoteBlockNumber.toString()}`
	return (
		<p className='detail'>
			Quote loaded{blockText} {formatQuoteAge(openOracleInitialReportState.quoteLoadedAtMs)}.{openOracleInitialReportState.quoteStale === true ? ' This quote is stale and will be refreshed before submission.' : ''}
		</p>
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
			badge={<Badge tone={statusTone}>{status}</Badge>}
			actions={
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
						Open report
					</button>
				</div>
			}
		>
			<MetricGrid variant='question'>
				{renderReportField(
					'Token Pair',
					<>
						<AddressValue address={report.token1} /> / <AddressValue address={report.token2} />
					</>,
				)}
				{renderReportField('Current Price', <CurrencyValue value={report.price} suffix={`${report.token1Symbol} / ${report.token2Symbol}`} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
				{renderReportField('Current Reporter', report.currentReporter === zeroAddress ? 'None' : <AddressValue address={report.currentReporter} />)}
				{renderReportField('Current Amount1', <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} />)}
				{renderReportField('Current Amount2', <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} />)}
				{renderReportField('Report Timestamp', <TimestampValue timestamp={report.reportTimestamp} zeroText='Awaiting initial report' />)}
				{renderReportField('Settlement Timestamp', <TimestampValue timestamp={report.settlementTimestamp} zeroText='Not settled' />)}
			</MetricGrid>
		</EntityCard>
	)
}
export function renderSelectedReportActionSection({
	actionMode,
	disputeSubmission,
	initialReportSubmission,
	isConnected,
	onApproveToken1,
	onApproveToken2,
	onDisputeReport,
	onOpenOracleFormChange,
	onRefreshPrice,
	onSettleReport,
	onSubmitInitialReport,
	onWrapWethForInitialReport,
	openOracleActiveAction,
	openOracleForm,
	openOracleInitialReportState,
	openOracleReportDetails,
	token1Symbol,
	token2Symbol,
}: {
	actionMode: OpenOracleSelectedReportActionMode
	disputeSubmission: OpenOracleDisputeSubmissionDetails | undefined
	initialReportSubmission: OpenOracleInitialReportSubmissionDetails
	isConnected: boolean
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onDisputeReport: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onRefreshPrice: () => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	onWrapWethForInitialReport: () => void
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction']
	openOracleForm: OpenOracleFormState
	openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState']
	openOracleReportDetails?: OpenOracleReportDetails
	token1Symbol: string
	token2Symbol: string
}) {
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
						{renderInitialPriceFreshness(openOracleInitialReportState, initialReportSubmission.priceSource)}
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
								safetyId={getOpenOracleActionSafetyId('approveToken1')}
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
								guardMessage={(() => {
									if (!isConnected) return 'Connect a wallet before approving tokens.'
									if (initialReportSubmission.amount2 === undefined) return `Enter a valid ${token1Symbol} / ${token2Symbol} price before approving ${token2Symbol}.`

									return undefined
								})()}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={`Approving ${token2Symbol}...`}
								requiredAmount={initialReportSubmission.amount2}
								resetKey={`token2:${token2Symbol}:${initialReportSubmission.amount2?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken2')}
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
									safetyId={getOpenOracleActionSafetyId('wrapWeth')}
									idleLabel='Wrap needed ETH to WETH'
									pendingLabel='Wrapping ETH...'
									onClick={onWrapWethForInitialReport}
									pending={openOracleActiveAction === 'wrapWeth'}
									tone='secondary'
									availability={{
										disabled: !isConnected || !initialReportSubmission.canWrapRequiredWeth,
										reason: (() => {
											if (!isConnected) return 'Connect a wallet before wrapping ETH.'
											if (initialReportSubmission.wrapRequiredWethMessage?.kind === 'visible') return initialReportSubmission.wrapRequiredWethMessage.message

											return undefined
										})(),
									}}
								/>
							)}
							<TransactionActionButton
								safetyId={getOpenOracleActionSafetyId('submitInitialReport')}
								idleLabel='Submit Initial Report'
								pendingLabel='Submitting...'
								onClick={onSubmitInitialReport}
								pending={openOracleActiveAction === 'submitInitialReport'}
								availability={{
									disabled: !isConnected || !initialReportSubmission.canSubmit,
									reason: (() => {
										if (!isConnected) return 'Connect a wallet before submitting the initial report.'
										if (initialReportSubmission.blockMessage?.kind === 'visible') return initialReportSubmission.blockMessage.message

										return undefined
									})(),
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		case 'dispute': {
			const disputeDisabledMessage = (() => {
				if (!isConnected) return 'Connect a wallet before disputing reports.'
				if (openOracleForm.reportId.trim() === '') return 'Load a report first.'

				return disputeAvailability.message
			})()
			const token1ApprovalGuardMessage = !isConnected
				? 'Connect a wallet before approving tokens.'
				: (() => {
						if (openOracleReportDetails === undefined) return 'Load a report first.'
						if (disputeSubmission?.token1ContributionAmount === undefined) return `Enter valid dispute amounts before approving ${token1Symbol}.`

						return undefined
					})()
			const token2ApprovalGuardMessage = !isConnected
				? 'Connect a wallet before approving tokens.'
				: (() => {
						if (openOracleReportDetails === undefined) return 'Load a report first.'
						if (disputeSubmission?.token2ContributionAmount === undefined) return `Enter valid dispute amounts before approving ${token2Symbol}.`

						return undefined
					})()
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
						{disputeSubmission?.expectedNewAmount1 === undefined ? undefined : <p className='detail'>{`New ${token1Symbol} amount must be exactly ${disputeSubmission.expectedNewAmount1.toString()} for this dispute.`}</p>}
						<SectionBlock headingLevel={4} title={`${token1Symbol} Approval`} variant='embedded'>
							<TokenApprovalControl
								actionLabel='disputing the report'
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								guardMessage={token1ApprovalGuardMessage}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={`Approving ${token1Symbol}...`}
								requiredAmount={disputeSubmission?.token1ContributionAmount}
								resetKey={`dispute:token1:${token1Symbol}:${disputeSubmission?.token1ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken1')}
								tokenSymbol={token1Symbol}
								tokenUnits={disputeSubmission?.token1Decimals ?? 18}
							/>
						</SectionBlock>
						<SectionBlock headingLevel={4} title={`${token2Symbol} Approval`} variant='embedded'>
							<TokenApprovalControl
								actionLabel='disputing the report'
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								guardMessage={token2ApprovalGuardMessage}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={`Approving ${token2Symbol}...`}
								requiredAmount={disputeSubmission?.token2ContributionAmount}
								resetKey={`dispute:token2:${token2Symbol}:${disputeSubmission?.token2ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken2')}
								tokenSymbol={token2Symbol}
								tokenUnits={disputeSubmission?.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{disputeSubmission?.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{disputeSubmission.blockMessage.message}</p>}
						<div className='actions'>
							<TransactionActionButton
								safetyId={getOpenOracleActionSafetyId('dispute')}
								idleLabel='Dispute & Swap'
								pendingLabel='Submitting dispute...'
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								tone='secondary'
								availability={{
									disabled: !isConnected || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
									reason: disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined),
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'settle': {
			const settleDisabledMessage = (() => {
				if (!isConnected) return 'Connect a wallet before settling reports.'
				if (openOracleForm.reportId.trim() === '') return 'Load a report first.'

				return settleAvailability.message
			})()
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
						<div className='actions'>
							<TransactionActionButton
								safetyId={getOpenOracleActionSafetyId('settle')}
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
		default:
			return assertNever(actionMode)
	}
}
function renderReportDetailsCard(
	openOracleReportDetails: OpenOracleReportDetails | undefined,
	openOracleForm: OpenOracleFormState,
	openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'],
	openOracleDisputeSubmission: OpenOracleSectionProps['openOracleDisputeSubmission'],
	openOracleInitialReportSubmission: OpenOracleSectionProps['openOracleInitialReportSubmission'],
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
						{(() => {
							if (loadingOracleReport) return <LoadingText>Loading...</LoadingText>
							if (openOracleReportDetails === undefined) return 'Open report'

							return 'Refresh report'
						})()}
					</button>
				}
			/>
		</div>
	)
	if (openOracleReportDetails === undefined) {
		const reportPresentation = getReportPresentation({
			kind: 'report',
			state: (() => {
				if (loadingOracleReport) return 'loading'
				if (openOracleForm.reportId.trim() === '') return 'unknown'

				return 'missing'
			})(),
		})
		return (
			<SectionBlock title='Report Details'>
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
		reportId: openOracleForm.reportId,
		settleMessage: settleAvailability.message,
	}).map(action => {
		if (action.blocker !== undefined) return action
		if (action.key === 'submit-initial-report') return { ...action, onAction: () => onSelectedReportModalChange('initial-report') }
		if (action.key === 'dispute-report') return { ...action, onAction: () => onSelectedReportModalChange('dispute') }
		if (action.key === 'settle-report') return { ...action, onAction: () => onSelectedReportModalChange('settle') }

		return action
	})
	if (openOracleInitialReportSubmission === undefined) return undefined
	return (
		<>
			<StickyObjectContext
				eyebrow='Open Oracle Report Details'
				title={`Report #${openOracleReportDetails.reportId.toString()}`}
				items={[
					{ label: 'Stage', value: stage.label },
					{ label: 'Token Pair', value: `${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}` },
					{ label: 'Reporter', value: openOracleReportDetails.currentReporter === zeroAddress ? 'None' : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{ label: 'Price', value: <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} /> },
				]}
			/>
			<LifecycleStageBanner stage={stage} />
			<SectionBlock title='Report Actions' description='Open a focused action flow for the selected report when it is available.'>
				<div className='action-readiness-grid'>
					{readinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<SectionBlock badge={<Badge tone={statusTone}>{status}</Badge>} title='Report Details'>
				{reportControls}
				<MetricGrid variant='question'>
					{renderReportField('Report ID', openOracleReportDetails.reportId.toString())}
					{renderReportField('Oracle Address', <AddressValue address={openOracleReportDetails.openOracleAddress} />)}
					{renderReportField('Current Reporter', openOracleReportDetails.currentReporter === zeroAddress ? 'None (awaiting initial report)' : <AddressValue address={openOracleReportDetails.currentReporter} />)}
					{renderReportField('Current Price', <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
					{renderReportField('Settlement Timestamp', <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText='Not settled' />)}
				</MetricGrid>
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
							value: <CurrencyValue value={openOracleReportDetails.price} suffix={`${openOracleReportDetails.token1Symbol} / ${openOracleReportDetails.token2Symbol}`} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
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
							label: 'Settled',
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
							label: 'Number of Reports',
							value: openOracleReportDetails.numReports.toString(),
						},
					])}
				</ReadOnlyDetailAccordion>
			</div>

			<OperationModal isOpen={selectedReportModal === 'initial-report'} onClose={() => onSelectedReportModalChange(undefined)} title='Submit Initial Report' description='Review price source, approvals, and token balances before submitting the initial report.'>
				{renderSelectedReportActionSection({
					actionMode: 'initial-report',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onRefreshPrice,
					onSettleReport,
					onSubmitInitialReport,
					onWrapWethForInitialReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleInitialReportState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			<OperationModal isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title='Dispute & Swap' description='Provide the replacement swap amounts for the selected report.'>
				{renderSelectedReportActionSection({
					actionMode: 'dispute',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onRefreshPrice,
					onSettleReport,
					onSubmitInitialReport,
					onWrapWethForInitialReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleInitialReportState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			<OperationModal isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title='Settle Report' description='Confirm settlement once the selected report is ready.'>
				{renderSelectedReportActionSection({
					actionMode: 'settle',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onRefreshPrice,
					onSettleReport,
					onSubmitInitialReport,
					onWrapWethForInitialReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleInitialReportState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>
		</>
	)
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
	openOracleDisputeSubmission,
	openOracleError,
	openOracleForm,
	openOracleInitialReportState,
	openOracleInitialReportSubmission,
	openOracleReportDetails,
	openOracleResult,
	onActiveViewChange,
}: OpenOracleSectionProps) {
	const view = activeView
	const chainCurrentTimestamp = useChainTimestamp()
	const chainCurrentBlockNumber = useChainBlockNumber()
	const [browsePage, setBrowsePage] = useState<OpenOracleReportSummaryPage | undefined>(undefined)
	const [browseError, setBrowseError] = useState<string | undefined>(undefined)
	const [browsePageIndex, setBrowsePageIndex] = useState(0)
	const [browseSearchText, setBrowseSearchText] = useState('')
	const [browseStatusFilter, setBrowseStatusFilter] = useState<BrowseStatusFilter>('all')
	const [selectedReportModal, setSelectedReportModal] = useState<SelectedReportModal>(undefined)
	const browseLoad = useLoadController()
	const isConnected = accountState.address !== undefined
	const isMainnet = isMainnetChain(accountState.chainId)
	const createGuardMessage = getOpenOracleCreateGuardMessage({
		ethValueInput: openOracleCreateForm.ethValue,
		isMainnet,
		settlerRewardInput: openOracleCreateForm.settlerReward,
		walletConnected: isConnected,
		walletEthBalance: accountState.ethBalance,
	})
	const effectiveOpenOracleReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainCurrentTimestamp, chainCurrentBlockNumber)
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
	const normalizedBrowseSearchText = browseSearchText.trim().toLowerCase()
	const browseReportCount = browsePage?.reportCount ?? 0n
	const browsePageCount = browsePage === undefined ? undefined : getPaginationPageCount(browseReportCount, BROWSE_PAGE_SIZE)
	const browseHasPreviousPage = browsePageIndex > 0
	const browseHasNextPage = getHasNextPaginationPage(browsePageIndex, browsePageCount)
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
	const openBrowseReport = async (reportId: bigint) => {
		onOpenOracleFormChange({ reportId: reportId.toString() })
		onActiveViewChange('selected-report')
		await onLoadOracleReport(reportId.toString())
	}
	return (
		<div className='route-view-flow'>
			{view === 'browse' ? (
				<div className='workflow-stack route-workflow-stack'>
					<SectionBlock
						actions={
							<PaginationControls
								hasNextPage={browseHasNextPage}
								hasPreviousPage={browseHasPreviousPage}
								loading={loadingBrowse}
								onNextPage={() => setBrowsePageIndex(current => current + 1)}
								onPreviousPage={() => setBrowsePageIndex(current => Math.max(0, current - 1))}
								summary={browsePage === undefined ? undefined : formatPaginationSummary(browsePageIndex, browsePageCount)}
							/>
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
						) : (
							(() => {
								if (browsePage === undefined || browsePage.reports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No Open Oracle games found.' }} />
								if (filteredBrowseReports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: 'No matches', badgeTone: 'muted', detail: 'No reports match the current search and status filters.' }} />

								return <div className='entity-card-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
							})()
						)}
					</SectionBlock>
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
					<SectionBlock title='Advanced Standalone Oracle Game' description='Direct Open Oracle creation for protocol testing. This bypasses pool-managed oracle-manager staging, so confirm addresses, token amounts, fees, and timing before submitting.'>
						<p className='notice warning'>Use this only when you intend to create a standalone oracle game directly from the connected wallet. Pool-managed oracle requests should be started from a selected security pool.</p>
						<div className='form-grid'>
							<SectionBlock headingLevel={4} title='Token Pair' variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>Token1 Address</span>
										<FormInput value={openOracleCreateForm.token1Address} onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })} placeholder='0x...' aria-label='Token1 Address' aria-describedby='open-oracle-token1-address-help' />
										<p id='open-oracle-token1-address-help' className='field-help'>
											Base token for the reported pair.
										</p>
									</label>
									<label className='field'>
										<span>Token2 Address</span>
										<FormInput value={openOracleCreateForm.token2Address} onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })} placeholder='0x...' aria-label='Token2 Address' aria-describedby='open-oracle-token2-address-help' />
										<p id='open-oracle-token2-address-help' className='field-help'>
											Quote token for the reported pair.
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title='Initial Economics' variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>Exact Token1 Report</span>
										<FormInput value={openOracleCreateForm.exactToken1Report} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })} aria-label='Exact Token1 Report' aria-describedby='open-oracle-exact-token1-report-help' />
										<p id='open-oracle-exact-token1-report-help' className='field-help'>
											Token1 amount to report, entered as a decimal value for the token1 address.
										</p>
									</label>
									<label className='field'>
										<span>Settler Reward</span>
										<FormInput value={openOracleCreateForm.settlerReward} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} aria-label='Settler Reward' aria-describedby='open-oracle-settler-reward-help' />
										<p id='open-oracle-settler-reward-help' className='field-help'>
											ETH paid to the account that settles the report, entered as a decimal ETH value.
										</p>
									</label>
								</div>
								<label className='field'>
									<span>ETH Value To Send</span>
									<FormInput value={openOracleCreateForm.ethValue} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })} aria-label='ETH Value To Send' aria-describedby='open-oracle-eth-value-help' />
									<p id='open-oracle-eth-value-help' className='field-help'>
										ETH sent with creation; must cover required funding and the settler reward.
									</p>
								</label>
								<div className='field-row'>
									<label className='field'>
										<span>Fee Percentage</span>
										<FormInput value={openOracleCreateForm.feePercentage} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} aria-label='Fee Percentage' aria-describedby='open-oracle-fee-percentage-help' />
										<p id='open-oracle-fee-percentage-help' className='field-help'>
											Fee charged during dispute economics, entered as a percentage.
										</p>
									</label>
									<label className='field'>
										<span>Multiplier</span>
										<FormInput value={openOracleCreateForm.multiplier} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} aria-label='Multiplier' aria-describedby='open-oracle-multiplier-help' />
										<p id='open-oracle-multiplier-help' className='field-help'>
											Escalation multiplier for dispute economics.
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title='Timing' variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>Settlement Time</span>
										<FormInput value={openOracleCreateForm.settlementTime} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} aria-label='Settlement Time' aria-describedby='open-oracle-settlement-time-help' />
										<p id='open-oracle-settlement-time-help' className='field-help'>
											Delay in seconds after the initial report before settlement can begin.
										</p>
									</label>
									<label className='field'>
										<span>Escalation Halt</span>
										<FormInput value={openOracleCreateForm.escalationHalt} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} aria-label='Escalation Halt' aria-describedby='open-oracle-escalation-halt-help' />
										<p id='open-oracle-escalation-halt-help' className='field-help'>
											Token1 amount where dispute escalation stops, entered as a decimal value for the token1 address.
										</p>
									</label>
								</div>
								<div className='field-row'>
									<label className='field'>
										<span>Dispute Delay</span>
										<FormInput value={openOracleCreateForm.disputeDelay} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} aria-label='Dispute Delay' aria-describedby='open-oracle-dispute-delay-help' />
										<p id='open-oracle-dispute-delay-help' className='field-help'>
											Delay in seconds after the initial report before disputes can begin.
										</p>
									</label>
									<label className='field'>
										<span>Protocol Fee</span>
										<FormInput value={openOracleCreateForm.protocolFee} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} aria-label='Protocol Fee' aria-describedby='open-oracle-protocol-fee-help' />
										<p id='open-oracle-protocol-fee-help' className='field-help'>
											Protocol fee charged during disputes, entered as a percentage.
										</p>
									</label>
								</div>
							</SectionBlock>

							<div className='actions'>
								<TransactionActionButton
									safetyId={getOpenOracleActionSafetyId('createReportInstance')}
									idleLabel='Create Standalone Oracle Game'
									pendingLabel='Creating...'
									onClick={onCreateOpenOracleGame}
									pending={loadingOpenOracleCreate}
									availability={{ disabled: createGuardMessage !== undefined, reason: createGuardMessage }}
								/>
							</div>
						</div>
					</SectionBlock>
					<ErrorNotice message={openOracleError} />
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='workflow-stack route-workflow-stack'>
					{renderReportDetailsCard(
						effectiveOpenOracleReportDetails,
						openOracleForm,
						openOracleInitialReportState,
						openOracleDisputeSubmission,
						openOracleInitialReportSubmission,
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
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</div>
	)
}
