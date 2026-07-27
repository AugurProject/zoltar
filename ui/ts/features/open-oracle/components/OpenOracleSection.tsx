import * as commonCopy from '../../../copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from '../../../components/ActionLauncherCard.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { EntityCard } from '../../../components/EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from '../../../components/EnumDropdown.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { LifecycleStageBanner } from '../../security-pools/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OperationModal } from '../../../components/OperationModal.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { ReadOnlyDetailAccordion } from '../../../components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StickyObjectContext } from '../../../components/StickyObjectContext.js'
import { StateHint } from '../../../components/StateHint.js'
import { TokenApprovalControl } from '../../../components/TokenApprovalControl.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { assertNever } from '../../../lib/assert.js'
import { createConnectedReadClient } from '../../../lib/clients.js'
import { useChainBlockNumber, useChainTimestamp } from '../../../lib/chainTimestamp.js'
import {
	getOpenOracleCreateGuardMessage,
	getOpenOracleCreateValidation,
	formatOpenOracleFeePercentage,
	formatOpenOracleMultiplier,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleReportStatusTone,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	OPEN_ORACLE_CREATE_FIELD_ORDER,
	type OpenOracleCreateField,
	type OpenOracleDisputeInputField,
	type OpenOracleDisputeSubmissionDetails,
	type OpenOracleSelectedReportActionMode,
} from '../lib/openOracle.js'
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount } from '../../../lib/pagination.js'
import { loadOpenOracleReportSummaries } from '../../../protocol/index.js'
import { isMainnetChain } from '../../../lib/network.js'
import { tryParseBigIntInput } from '../../../lib/integerInput.js'
import { getReportPresentation } from '../../../lib/userCopy.js'
import { formatCurrencyInputBalance } from '../../../lib/formatters.js'
import type { OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage, OpenOracleWithdrawableBalances } from '../../../types/contracts.js'
import type { OpenOracleSectionProps } from '../../types.js'
const BROWSE_PAGE_SIZE = 10
const OPEN_ORACLE_PRICE_UNITS = 30
type WithdrawalBalanceKey = keyof OpenOracleWithdrawableBalances
type SelectedReportModal = 'dispute' | 'settle' | `withdraw-${WithdrawalBalanceKey}` | undefined
type BrowseLoadState =
	| {
			requestKey: string | undefined
			status: 'loading'
	  }
	| {
			requestKey: string
			status: 'ready'
	  }
	| {
			message: string
			requestKey: string
			status: 'error'
	  }
const DISPUTE_REPORT_MODAL: SelectedReportModal = 'dispute'
const SETTLE_REPORT_MODAL: SelectedReportModal = 'settle'
const OPEN_ORACLE_CREATE_FIELD_ERROR_IDS: Record<OpenOracleCreateField, string> = {
	disputeDelay: 'open-oracle-dispute-delay-error',
	escalationHalt: 'open-oracle-escalation-halt-error',
	ethValue: 'open-oracle-eth-value-error',
	exactToken1Report: 'open-oracle-exact-token1-report-error',
	feePercentage: 'open-oracle-fee-percentage-error',
	initialToken2Amount: 'open-oracle-initial-token2-amount-error',
	multiplier: 'open-oracle-multiplier-error',
	protocolFee: 'open-oracle-protocol-fee-error',
	settlementTime: 'open-oracle-settlement-time-error',
	settlerReward: 'open-oracle-settler-reward-error',
	token1Address: 'open-oracle-token1-address-error',
	token2Address: 'open-oracle-token2-address-error',
}
const OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER: readonly OpenOracleDisputeInputField[] = ['disputeNewAmount1', 'disputeNewAmount2', 'disputeTokenToSwap']
function getOpenOracleCreateFieldErrorId(field: OpenOracleCreateField) {
	return OPEN_ORACLE_CREATE_FIELD_ERROR_IDS[field]
}
function getOpenOracleFieldDescribedBy(errorId: string, error: string | undefined, helpId?: string) {
	return [helpId, error === undefined ? undefined : errorId].filter(value => value !== undefined).join(' ') || undefined
}
function renderOpenOracleFieldError(id: string, message: string | undefined) {
	if (message === undefined) return undefined
	return (
		<p className='field-error' id={id} role='alert'>
			{message}
		</p>
	)
}
function getOpenOracleDisputeFieldErrorId(field: OpenOracleDisputeInputField, reportId: string) {
	switch (field) {
		case 'disputeNewAmount1':
			return `open-oracle-dispute-new-amount-1-error-${reportId}`
		case 'disputeNewAmount2':
			return `open-oracle-dispute-new-amount-2-error-${reportId}`
		case 'disputeTokenToSwap':
			return `open-oracle-dispute-token-to-swap-error-${reportId}`
		default:
			return assertNever(field)
	}
}
function getWithdrawalReportModal(balance: WithdrawalBalanceKey): SelectedReportModal {
	return `withdraw-${balance}`
}
function getSelectedWithdrawalBalance(modal: SelectedReportModal): WithdrawalBalanceKey | undefined {
	if (modal === 'withdraw-eth') return 'eth'
	if (modal === 'withdraw-token1') return 'token1'
	if (modal === 'withdraw-token2') return 'token2'
	return undefined
}
type BrowseStatusFilter = 'all' | 'Pending' | 'Disputed' | 'Settled'
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
		case 'Pending':
		case 'Disputed':
		case 'Settled':
		case 'all':
			return value
		default:
			return 'all'
	}
}
async function loadBrowseReportPage(pageIndex: number, pageSize: number) {
	return await loadOpenOracleReportSummaries(createConnectedReadClient(), pageIndex, pageSize)
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
function renderReportFields(
	fields: Array<{
		label: string
		value: ComponentChildren
	}>,
) {
	return <MetricGrid variant='question'>{fields.map(field => renderReportField(field.label, field.value))}</MetricGrid>
}
function renderReportSummaryCard(report: OpenOracleReportSummary, onSelectReport: (reportId: bigint) => void) {
	const status = getOpenOracleReportStatus(report)
	const statusTone = getOpenOracleReportStatusTone(status)
	return (
		<EntityCard
			key={report.reportId.toString()}
			className='compact'
			title={openOracleCopy.formatReportBrowseTitle(report.token1Symbol, report.token2Symbol, report.reportId.toString())}
			badge={<Badge tone={statusTone}>{status}</Badge>}
			actions={
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
						{openOracleCopy.openReport}
					</button>
				</div>
			}
		>
			<MetricGrid variant='question'>
				{renderReportField(openOracleCopy.currentPrice, <CurrencyValue value={report.price} suffix={openOracleCopy.formatTokenPairSuffix(report.token1Symbol, report.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
				{renderReportField(openOracleCopy.formatCurrentAmount1Label(report.token1Symbol), <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} />)}
				{renderReportField(openOracleCopy.formatCurrentAmount2Label(report.token2Symbol), <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} />)}
				{renderReportField(openOracleCopy.reportTimestamp, <TimestampValue timestamp={report.reportTimestamp} />)}
				{renderReportField(openOracleCopy.settlementTimestamp, <TimestampValue timestamp={report.settlementTimestamp} zeroText={openOracleCopy.notSettled} />)}
			</MetricGrid>
			<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>
				{renderReportFields([
					{
						label: report.token1Symbol,
						value: <AddressValue address={report.token1} />,
					},
					{
						label: report.token2Symbol,
						value: <AddressValue address={report.token2} />,
					},
					{
						label: openOracleCopy.currentReporter,
						value: report.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={report.currentReporter} />,
					},
				])}
			</ReadOnlyDetailAccordion>
		</EntityCard>
	)
}
export function renderSelectedReportActionSection({
	actionMode,
	disputeSubmission,
	isConnected,
	isMainnet,
	onApproveToken1,
	onApproveToken2,
	onDisputeReport,
	onOpenOracleFormChange,
	onSettleReport,
	openOracleActiveAction,
	openOracleForm,
	openOracleTokenAccessState,
	openOracleReportDetails,
	token1Symbol,
	token2Symbol,
}: {
	actionMode: Exclude<OpenOracleSelectedReportActionMode, 'read-only'>
	disputeSubmission: OpenOracleDisputeSubmissionDetails | undefined
	isConnected: boolean
	isMainnet: boolean
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onDisputeReport: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onSettleReport: () => void
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction']
	openOracleForm: OpenOracleFormState
	openOracleTokenAccessState: OpenOracleSectionProps['openOracleTokenAccessState']
	openOracleReportDetails?: OpenOracleReportDetails
	token1Symbol: string
	token2Symbol: string
}) {
	const disputeTokenOptions: EnumDropdownOption<OpenOracleFormState['disputeTokenToSwap']>[] = [
		{ value: 'token1', label: token1Symbol },
		{ value: 'token2', label: token2Symbol },
	]
	const disputeAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleSettleAvailability(openOracleReportDetails)
	switch (actionMode) {
		case 'dispute': {
			const disputeDisabledMessage = (() => {
				if (openOracleForm.reportId.trim() === '') return openOracleCopy.reportLoadRequired

				return disputeAvailability.message
			})()
			const token1ApprovalGuardMessage = (() => {
				if (openOracleReportDetails === undefined) return openOracleCopy.reportLoadRequired
				if (disputeSubmission?.token1ContributionAmount === undefined) return openOracleCopy.formatDisputeAmountsInvalidReason(token1Symbol)

				return undefined
			})()
			const token2ApprovalGuardMessage = (() => {
				if (openOracleReportDetails === undefined) return openOracleCopy.reportLoadRequired
				if (disputeSubmission?.token2ContributionAmount === undefined) return openOracleCopy.formatDisputeAmountsInvalidReason(token2Symbol)

				return undefined
			})()
			const disputeToken1ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token1Symbol)
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return token1ApprovalGuardMessage
			})()
			const disputeToken2ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token2Symbol)
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return token2ApprovalGuardMessage
			})()
			const disputeActionDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.disputeWalletRequiredReason
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined)
			})()
			const disputeReportId = openOracleForm.reportId.trim() || 'unselected'
			const disputeInputFieldErrors = disputeSubmission?.inputFieldErrors ?? {}
			const firstDisputeInputErrorField = OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER.find(field => disputeInputFieldErrors[field] !== undefined)
			const disputeInputBlockMessageId = firstDisputeInputErrorField === undefined ? `open-oracle-dispute-input-blocker-${disputeReportId}` : getOpenOracleDisputeFieldErrorId(firstDisputeInputErrorField, disputeReportId)
			const disputeNewAmount1Error = disputeInputFieldErrors.disputeNewAmount1
			const disputeNewAmount2Error = disputeInputFieldErrors.disputeNewAmount2
			const disputeTokenToSwapError = disputeInputFieldErrors.disputeTokenToSwap
			const disputeActionReasonUsesInputBlockMessage = disputeSubmission?.inputBlockMessage?.kind === 'visible' && disputeActionDisabledReason === disputeSubmission.inputBlockMessage.message
			const disputeInputBlockDetail =
				disputeSubmission?.inputBlockMessage !== undefined && firstDisputeInputErrorField === undefined ? (
					<p className='detail' id={disputeInputBlockMessageId}>
						{disputeSubmission.inputBlockMessage.kind === 'hidden-loading' ? <LoadingText>{disputeSubmission.inputBlockMessage.message}</LoadingText> : disputeSubmission.inputBlockMessage.message}
					</p>
				) : undefined
			return (
				<SectionBlock variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.currentReportState, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: openOracleCopy.currentPrice, value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(token1Symbol, token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} /> },
								])}
						<label className='field'>
							<span>{openOracleCopy.tokenToSwapOut}</span>
							<EnumDropdown
								ariaDescribedBy={disputeTokenToSwapError === undefined ? undefined : getOpenOracleDisputeFieldErrorId('disputeTokenToSwap', disputeReportId)}
								ariaLabel={openOracleCopy.tokenToSwapOut}
								invalid={disputeTokenToSwapError !== undefined}
								options={disputeTokenOptions}
								value={openOracleForm.disputeTokenToSwap}
								onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })}
							/>
							{renderOpenOracleFieldError(getOpenOracleDisputeFieldErrorId('disputeTokenToSwap', disputeReportId), disputeTokenToSwapError)}
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}</span>
								<FormInput
									aria-describedby={disputeNewAmount1Error === undefined ? undefined : getOpenOracleDisputeFieldErrorId('disputeNewAmount1', disputeReportId)}
									aria-label={openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}
									inputMode='decimal'
									invalid={disputeNewAmount1Error !== undefined}
									onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })}
									value={openOracleForm.disputeNewAmount1}
								/>
								{renderOpenOracleFieldError(getOpenOracleDisputeFieldErrorId('disputeNewAmount1', disputeReportId), disputeNewAmount1Error)}
							</label>
							<label className='field'>
								<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}</span>
								<FormInput
									aria-describedby={disputeNewAmount2Error === undefined ? undefined : getOpenOracleDisputeFieldErrorId('disputeNewAmount2', disputeReportId)}
									aria-label={openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}
									inputMode='decimal'
									invalid={disputeNewAmount2Error !== undefined}
									onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })}
									value={openOracleForm.disputeNewAmount2}
								/>
								{renderOpenOracleFieldError(getOpenOracleDisputeFieldErrorId('disputeNewAmount2', disputeReportId), disputeNewAmount2Error)}
							</label>
						</div>
						{disputeSubmission?.expectedNewAmount1 === undefined || disputeSubmission.token1Decimals === undefined ? undefined : <p className='detail'>{openOracleCopy.formatNewAmountMustBeExactDetail(token1Symbol, formatCurrencyInputBalance(disputeSubmission.expectedNewAmount1, disputeSubmission.token1Decimals))}</p>}
						{disputeSubmission?.inputBlockMessage === undefined ? (
							<>
								<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(token1Symbol)} variant='embedded'>
									<TokenApprovalControl
										actionLabel={openOracleCopy.disputingTheReport}
										allowanceError={openOracleTokenAccessState.token1Approval.error}
										allowanceLoading={openOracleTokenAccessState.token1Approval.loading}
										approvedAmount={openOracleTokenAccessState.token1Approval.value}
										disabled={!isConnected || !isMainnet}
										guardMessage={disputeToken1ApprovalGuardMessage}
										onApprove={amount => onApproveToken1(amount)}
										pending={openOracleActiveAction === 'approveToken1'}
										pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(token1Symbol)}
										requiredAmount={disputeSubmission?.token1ContributionAmount}
										resetKey={`dispute:token1:${token1Symbol}:${disputeSubmission?.token1ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
										tokenSymbol={token1Symbol}
										tokenUnits={disputeSubmission?.token1Decimals ?? 18}
									/>
								</SectionBlock>
								<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(token2Symbol)} variant='embedded'>
									<TokenApprovalControl
										actionLabel={openOracleCopy.disputingTheReport}
										allowanceError={openOracleTokenAccessState.token2Approval.error}
										allowanceLoading={openOracleTokenAccessState.token2Approval.loading}
										approvedAmount={openOracleTokenAccessState.token2Approval.value}
										disabled={!isConnected || !isMainnet}
										guardMessage={disputeToken2ApprovalGuardMessage}
										onApprove={amount => onApproveToken2(amount)}
										pending={openOracleActiveAction === 'approveToken2'}
										pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(token2Symbol)}
										requiredAmount={disputeSubmission?.token2ContributionAmount}
										resetKey={`dispute:token2:${token2Symbol}:${disputeSubmission?.token2ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
										tokenSymbol={token2Symbol}
										tokenUnits={disputeSubmission?.token2Decimals ?? 18}
									/>
								</SectionBlock>
							</>
						) : (
							disputeInputBlockDetail
						)}
						{!isMainnet || disputeSubmission?.blockMessage?.kind !== 'visible' || disputeSubmission.blockMessage === disputeSubmission.inputBlockMessage ? undefined : <p className='detail'>{disputeSubmission.blockMessage.message}</p>}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.disputeAndSwap}
								pendingLabel={openOracleCopy.submittingDispute}
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isMainnet || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
									reason: disputeActionDisabledReason,
								}}
								disabledReasonElementId={disputeActionReasonUsesInputBlockMessage ? disputeInputBlockMessageId : undefined}
								showDisabledReason={!disputeActionReasonUsesInputBlockMessage}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'settle': {
			const settleDisabledMessage = (() => {
				if (openOracleForm.reportId.trim() === '') return openOracleCopy.reportLoadRequired

				return settleAvailability.message
			})()
			const settleActionDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.settlementWalletRequiredReason
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return settleDisabledMessage
			})()
			return (
				<SectionBlock variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.settlementSummary, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: openOracleCopy.settlementTimestamp, value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} /> },
								])}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.settleReport}
								pendingLabel={openOracleCopy.settlingReport}
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isMainnet || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
									reason: settleActionDisabledReason,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		default:
			return assertNever(actionMode)
	}
}
function renderReportDetailsCard(
	openOracleReportDetails: OpenOracleReportDetails | undefined,
	openOracleForm: OpenOracleFormState,
	openOracleTokenAccessState: OpenOracleSectionProps['openOracleTokenAccessState'],
	openOracleDisputeSubmission: OpenOracleSectionProps['openOracleDisputeSubmission'],
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction'],
	openOracleActiveWithdrawalBalance: OpenOracleSectionProps['openOracleActiveWithdrawalBalance'],
	openOracleResult: OpenOracleSectionProps['openOracleResult'],
	openOracleReportLookupState: OpenOracleSectionProps['openOracleReportLookupState'],
	openOracleWithdrawalBalanceChecking: OpenOracleSectionProps['openOracleWithdrawalBalanceChecking'],
	openOracleWithdrawalReviewMessage: OpenOracleSectionProps['openOracleWithdrawalReviewMessage'],
	accountAddress: string | undefined,
	isConnected: boolean,
	isMainnet: boolean,
	selectedReportModal: SelectedReportModal,
	onApproveToken1: (amount?: bigint) => void,
	onApproveToken2: (amount?: bigint) => void,
	onDisputeReport: () => void,
	onLoadOracleReport: (reportId?: string) => void,
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void,
	onSelectedReportModalChange: (modal: SelectedReportModal) => void,
	onSettleReport: () => void,
	onWithdrawOpenOracleBalance: OpenOracleSectionProps['onWithdrawOpenOracleBalance'],
	openOracleWithdrawableBalances: OpenOracleSectionProps['openOracleWithdrawableBalances'],
	openOracleWithdrawableBalancesError: OpenOracleSectionProps['openOracleWithdrawableBalancesError'],
	openOracleWithdrawableBalancesLoading: OpenOracleSectionProps['openOracleWithdrawableBalancesLoading'],
) {
	const loadingSelectedReport = openOracleReportLookupState === 'loading'
	const reportControls = (
		<div className='form-grid'>
			<LookupFieldRow
				label={openOracleCopy.reportId}
				value={openOracleForm.reportId}
				onInput={reportId => onOpenOracleFormChange({ reportId })}
				action={
					<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingSelectedReport}>
						{(() => {
							if (loadingSelectedReport) return <LoadingText>{commonCopy.loadingWithEllipsis}</LoadingText>
							if (openOracleReportDetails === undefined) return openOracleCopy.openReport

							return openOracleCopy.refreshReport
						})()}
					</button>
				}
			/>
		</div>
	)
	if (openOracleReportDetails === undefined) {
		const reportLookupPresentationState = (() => {
			if (openOracleReportLookupState === 'missing') return 'missing'
			if (openOracleReportLookupState === 'loading') return 'loading'
			return 'unknown'
		})()
		const reportPresentation = getReportPresentation({ kind: 'report', state: reportLookupPresentationState })
		return (
			<SectionBlock title={commonCopy.reportDetails}>
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
	const stage = getOpenOracleStagePresentation(actionMode, openOracleReportDetails)
	const disputeAvailability = getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = getOpenOracleSettleAvailability(openOracleReportDetails)
	const readinessActions = getOpenOracleReadinessActions({
		actionMode,
		disputeMessage: disputeAvailability.message,
		hasReport: true,
		settleMessage: settleAvailability.message,
	}).map(action => {
		if (action.blocker !== undefined) return action
		if (action.key === 'dispute-report') return { ...action, onAction: () => onSelectedReportModalChange(DISPUTE_REPORT_MODAL) }
		if (action.key === 'settle-report') return { ...action, onAction: () => onSelectedReportModalChange(SETTLE_REPORT_MODAL) }

		return action
	})
	const withdrawableBalanceItems = [
		{ amount: openOracleWithdrawableBalances?.eth, key: 'eth' as const, symbol: commonCopy.eth, units: 18 },
		{ amount: openOracleWithdrawableBalances?.token1, key: 'token1' as const, symbol: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals },
		{ amount: openOracleWithdrawableBalances?.token2, key: 'token2' as const, symbol: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals },
	]
	const selectedWithdrawalBalance = getSelectedWithdrawalBalance(selectedReportModal)
	const selectedWithdrawalItem = withdrawableBalanceItems.find(item => item.key === selectedWithdrawalBalance)
	const selectedWithdrawalAmount = selectedWithdrawalItem?.amount
	const selectedWithdrawalReviewMessage = openOracleWithdrawalReviewMessage !== undefined && openOracleWithdrawalReviewMessage.balance === selectedWithdrawalBalance ? openOracleWithdrawalReviewMessage.message : undefined
	const withdrawalDisabledReason = (() => {
		if (!isMainnet) return commonCopy.mainnetRequiredReason
		if (selectedWithdrawalAmount !== undefined && selectedWithdrawalAmount <= 0n) return openOracleCopy.noWithdrawableBalanceForAsset
		return undefined
	})()
	const hasWithdrawableBalance = withdrawableBalanceItems.some(item => (item.amount ?? 0n) > 0n)
	const showWithdrawableBalances = isConnected && (openOracleReportDetails.isDistributed || hasWithdrawableBalance || openOracleWithdrawableBalancesLoading || openOracleWithdrawableBalancesError !== undefined)
	let withdrawableBalancesContent: ComponentChildren
	if (openOracleWithdrawableBalances === undefined) {
		withdrawableBalancesContent = openOracleWithdrawableBalancesLoading ? (
			<p className='detail'>
				<LoadingText>{openOracleCopy.loadingOracleBalances}</LoadingText>
			</p>
		) : undefined
	} else {
		withdrawableBalancesContent = <MetricGrid>{withdrawableBalanceItems.map(item => renderReportField(item.symbol, <CurrencyValue value={item.amount ?? 0n} suffix={item.symbol} units={item.units} copyable={false} />))}</MetricGrid>
	}
	const reportTransactionContext = [
		{ label: openOracleCopy.reportId, value: openOracleReportDetails.reportId.toString() },
		{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
		{ label: openOracleCopy.oracleAddress, value: <AddressValue address={openOracleReportDetails.openOracleAddress} /> },
		{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
	]
	return (
		<>
			<StickyObjectContext
				badge={<Badge tone={statusTone}>{status}</Badge>}
				eyebrow={openOracleCopy.openOracleReportDetails}
				title={openOracleCopy.formatReportNumberTitle(openOracleReportDetails.reportId.toString())}
				items={[
					{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
					{ label: openOracleCopy.reporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{
						label: openOracleCopy.price,
						value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
					},
				]}
			/>
			{reportControls}
			{stage.label === status ? undefined : <LifecycleStageBanner stage={stage} />}
			{readinessActions.length > 0 ? (
				<SectionBlock title={openOracleCopy.reportActions}>
					<div className='action-readiness-grid'>
						{readinessActions.map(action => (
							<ActionLauncherCard key={action.key} action={action} />
						))}
					</div>
				</SectionBlock>
			) : undefined}
			{!showWithdrawableBalances ? undefined : (
				<SectionBlock title={openOracleCopy.oracleBalances} description={openOracleCopy.oracleBalancesDetail}>
					<ErrorNotice message={openOracleWithdrawableBalancesError} />
					{withdrawableBalancesContent}
					{!hasWithdrawableBalance && !openOracleWithdrawableBalancesLoading && openOracleWithdrawableBalancesError === undefined ? <p className='detail'>{openOracleCopy.noOracleBalances}</p> : undefined}
					{!hasWithdrawableBalance ? undefined : (
						<div className='actions'>
							{withdrawableBalanceItems
								.filter(item => (item.amount ?? 0n) > 0n)
								.map(item => (
									<TransactionActionButton
										key={item.key}
										idleLabel={openOracleCopy.withdrawBalance(item.symbol)}
										pendingLabel={openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(item.symbol) : openOracleCopy.withdrawingBalance(item.symbol)}
										onClick={() => onSelectedReportModalChange(getWithdrawalReportModal(item.key))}
										pending={(openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === item.key}
										tone='secondary'
										availability={{ disabled: !isMainnet || openOracleActiveAction === 'withdrawBalance', reason: isMainnet ? undefined : commonCopy.mainnetRequiredReason }}
									/>
								))}
						</div>
					)}
				</SectionBlock>
			)}
			<div className='report-detail-stack'>
				<ReadOnlyDetailAccordion title={openOracleCopy.identity}>
					{renderReportFields([
						{
							label: openOracleReportDetails.token1Symbol,
							value: <AddressValue address={openOracleReportDetails.token1} />,
						},
						{
							label: openOracleReportDetails.token2Symbol,
							value: <AddressValue address={openOracleReportDetails.token2} />,
						},
						{
							label: openOracleCopy.initialReporter,
							value: openOracleReportDetails.initialReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.initialReporter} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={openOracleCopy.economics}>
					{renderReportSection(openOracleCopy.reportAmounts, [
						{
							label: openOracleCopy.formatExactTokenRequiredLabel(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.exactToken1Report} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: openOracleCopy.formatCurrentAmount1Label(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: openOracleCopy.formatCurrentAmount2Label(openOracleReportDetails.token2Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} copyable={false} />,
						},
						{
							label: openOracleCopy.price,
							value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
						},
						{
							label: openOracleCopy.fee,
							value: <CurrencyValue value={openOracleReportDetails.fee} suffix={commonCopy.eth} copyable={false} />,
						},
						{
							label: openOracleCopy.settlerReward,
							value: <CurrencyValue value={openOracleReportDetails.settlerReward} suffix={commonCopy.eth} copyable={false} />,
						},
						{
							label: openOracleCopy.escalationHalt,
							value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={commonCopy.status}>
					{renderReportFields([
						{
							label: openOracleCopy.reportTimestamp,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.reportTimestamp} />,
						},
						{
							label: openOracleCopy.disputeOccurred,
							value: openOracleReportDetails.disputeOccurred ? commonCopy.yes : commonCopy.no,
						},
						{
							label: commonCopy.settled,
							value: openOracleReportDetails.isDistributed ? commonCopy.yes : commonCopy.no,
						},
						{
							label: openOracleCopy.settlementTimestamp,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} />,
						},
						{
							label: openOracleCopy.lastReportOpportunity,
							value: openOracleReportDetails.lastReportOppoTime === 0n ? commonCopy.none : openOracleCopy.formatTimingValue(openOracleReportDetails.lastReportOppoTime, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
						},
						{
							label: openOracleCopy.stateHash,
							value: openOracleReportDetails.stateHash,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={commonCopy.settlement}>
					{renderReportFields([
						{
							label: openOracleCopy.settlementTime,
							value: openOracleCopy.formatTimingValue(openOracleReportDetails.settlementTime, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
						},
						{
							label: openOracleCopy.disputeDelay,
							value: openOracleCopy.formatTimingValue(openOracleReportDetails.disputeDelay, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
						},
						{
							label: openOracleCopy.feePercentage,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.feePercentage),
						},
						{
							label: openOracleCopy.protocolFee,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.protocolFee),
						},
						{
							label: commonCopy.multiplier,
							value: formatOpenOracleMultiplier(openOracleReportDetails.multiplier),
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={openOracleCopy.callbackExtra}>
					{renderReportFields([
						{
							label: openOracleCopy.callbackContract,
							value: openOracleReportDetails.callbackContract === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.callbackContract} />,
						},
						{
							label: openOracleCopy.callbackGasLimit,
							value: openOracleReportDetails.callbackGasLimit === 0 ? commonCopy.none : openOracleReportDetails.callbackGasLimit.toString(),
						},
						{
							label: openOracleCopy.protocolFeeRecipient,
							value: openOracleReportDetails.protocolFeeRecipient === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.protocolFeeRecipient} />,
						},
						{
							label: openOracleCopy.trackDisputes,
							value: openOracleReportDetails.trackDisputes ? commonCopy.yes : commonCopy.no,
						},
						{
							label: openOracleCopy.numberOfReports,
							value: openOracleReportDetails.numReports.toString(),
						},
					])}
				</ReadOnlyDetailAccordion>
			</div>

			<OperationModal context={reportTransactionContext} isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.disputeAndSwap}>
				{renderSelectedReportActionSection({
					actionMode: 'dispute',
					disputeSubmission: openOracleDisputeSubmission,
					isConnected,
					isMainnet,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onSettleReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleTokenAccessState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			<OperationModal closeOnSuccessKey={openOracleResult?.action === 'settle' ? openOracleResult.hash : undefined} context={reportTransactionContext} isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.settleReport}>
				{renderSelectedReportActionSection({
					actionMode: 'settle',
					disputeSubmission: openOracleDisputeSubmission,
					isConnected,
					isMainnet,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onSettleReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleTokenAccessState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			{selectedWithdrawalItem === undefined || selectedWithdrawalAmount === undefined ? undefined : (
				<OperationModal
					closeOnSuccessKey={openOracleResult?.action === 'withdrawBalance' ? openOracleResult.hash : undefined}
					context={reportTransactionContext}
					isOpen={selectedWithdrawalBalance !== undefined}
					onClose={() => onSelectedReportModalChange(undefined)}
					title={openOracleCopy.withdrawBalance(selectedWithdrawalItem.symbol)}
				>
					<TransactionReview
						primary={[
							{
								label: transactionReviewCopy.youReceive,
								value: <CurrencyValue value={selectedWithdrawalAmount} suffix={selectedWithdrawalItem.symbol} units={selectedWithdrawalItem.units} precision='exact' copyable={false} />,
							},
						]}
						details={[
							{
								label: openOracleCopy.withdrawalRecipient,
								value: <AddressValue address={accountAddress} />,
							},
						]}
						risks={[openOracleCopy.formatWithdrawalRisk(selectedWithdrawalItem.symbol)]}
					/>
					<ErrorNotice message={selectedWithdrawalReviewMessage} />
					<div className='actions'>
						<TransactionActionButton
							idleLabel={openOracleCopy.confirmWithdrawal}
							pendingLabel={openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(selectedWithdrawalItem.symbol) : openOracleCopy.withdrawingBalance(selectedWithdrawalItem.symbol)}
							onClick={() => onWithdrawOpenOracleBalance(selectedWithdrawalItem.key, selectedWithdrawalAmount)}
							pending={(openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === selectedWithdrawalItem.key}
							availability={{
								disabled: !isMainnet || selectedWithdrawalAmount <= 0n || openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance',
								reason: withdrawalDisabledReason,
							}}
						/>
					</div>
				</OperationModal>
			)}
		</>
	)
}
export function OpenOracleSection({
	activeView,
	accountState,
	environmentReady,
	environmentRefreshKey,
	loadBrowseReports = loadBrowseReportPage,
	onApproveToken1,
	onApproveToken2,
	onCancelOpenOracleWithdrawalBalanceCheck,
	onCreateOpenOracleGame,
	onDisputeReport,
	onLoadOracleReport,
	onOpenOracleCreateFormChange,
	onOpenOracleFormChange,
	onSettleReport,
	onWithdrawOpenOracleBalance,
	loadingOpenOracleCreate,
	openOracleActiveAction,
	openOracleActiveWithdrawalBalance,
	openOracleCreateForm,
	openOracleDisputeSubmission,
	openOracleError,
	openOracleForm,
	openOracleReportLookupState,
	openOracleWithdrawalBalanceChecking,
	openOracleWithdrawalReviewMessage,
	openOracleTokenAccessState,
	openOracleReportDetails,
	openOracleResult,
	openOracleWithdrawableBalances,
	openOracleWithdrawableBalancesError,
	openOracleWithdrawableBalancesLoading,
	onActiveViewChange,
}: OpenOracleSectionProps) {
	const view = activeView
	const chainCurrentTimestamp = useChainTimestamp()
	const chainCurrentBlockNumber = useChainBlockNumber()
	const [browsePage, setBrowsePage] = useState<OpenOracleReportSummaryPage | undefined>(undefined)
	const [browseLoadState, setBrowseLoadState] = useState<BrowseLoadState>({ requestKey: undefined, status: 'loading' })
	const [browseReloadKey, setBrowseReloadKey] = useState(0)
	const [browsePageIndex, setBrowsePageIndex] = useState(0)
	const [browseSearchText, setBrowseSearchText] = useState('')
	const [browseStatusFilter, setBrowseStatusFilter] = useState<BrowseStatusFilter>('all')
	const [selectedReportModal, setSelectedReportModal] = useState<SelectedReportModal>(undefined)
	const [touchedCreateFields, setTouchedCreateFields] = useState<ReadonlySet<OpenOracleCreateField>>(new Set())
	const changeSelectedReportModal = (modal: SelectedReportModal) => {
		if (getSelectedWithdrawalBalance(selectedReportModal) !== undefined && modal !== selectedReportModal) onCancelOpenOracleWithdrawalBalanceCheck()
		setSelectedReportModal(modal)
	}
	const browseLoad = useLoadController()
	const isConnected = accountState.address !== undefined
	const isMainnet = isMainnetChain(accountState.chainId)
	const createValidation = getOpenOracleCreateValidation({ form: openOracleCreateForm })
	const rawCreateGuardMessage = getOpenOracleCreateGuardMessage({
		ethValueInput: openOracleCreateForm.ethValue,
		isMainnet,
		settlerRewardInput: openOracleCreateForm.settlerReward,
		walletConnected: isConnected,
		walletEthBalance: accountState.ethBalance,
	})
	const createGuardMessage = !isConnected || !isMainnet || createValidation.isValid ? rawCreateGuardMessage : undefined
	const markCreateFieldTouched = (field: OpenOracleCreateField) => setTouchedCreateFields(current => new Set([...current, field]))
	const getVisibleCreateFieldError = (field: OpenOracleCreateField) => (touchedCreateFields.has(field) ? createValidation.fieldErrors[field] : undefined)
	const firstVisibleInvalidCreateField = OPEN_ORACLE_CREATE_FIELD_ORDER.find(field => getVisibleCreateFieldError(field) !== undefined)
	const createDisabledReasonElementId = createGuardMessage === undefined && firstVisibleInvalidCreateField !== undefined ? getOpenOracleCreateFieldErrorId(firstVisibleInvalidCreateField) : undefined
	const createAvailabilityMessage = createGuardMessage ?? createValidation.message
	const disputeDelayError = getVisibleCreateFieldError('disputeDelay')
	const escalationHaltError = getVisibleCreateFieldError('escalationHalt')
	const ethValueError = getVisibleCreateFieldError('ethValue')
	const exactToken1ReportError = getVisibleCreateFieldError('exactToken1Report')
	const feePercentageError = getVisibleCreateFieldError('feePercentage')
	const initialToken2AmountError = getVisibleCreateFieldError('initialToken2Amount')
	const multiplierError = getVisibleCreateFieldError('multiplier')
	const protocolFeeError = getVisibleCreateFieldError('protocolFee')
	const settlementTimeError = getVisibleCreateFieldError('settlementTime')
	const settlerRewardError = getVisibleCreateFieldError('settlerReward')
	const token1AddressError = getVisibleCreateFieldError('token1Address')
	const token2AddressError = getVisibleCreateFieldError('token2Address')
	const effectiveOpenOracleReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainCurrentTimestamp, chainCurrentBlockNumber)
	const browseRequestKey = `${environmentRefreshKey}:${browsePageIndex}:${browseReloadKey}:${openOracleResult?.action ?? ''}:${openOracleResult?.hash ?? ''}`
	const successfulCreateKey = openOracleResult?.action === 'createReportInstance' ? openOracleResult.hash : undefined
	useEffect(() => {
		if (successfulCreateKey === undefined) return
		setTouchedCreateFields(new Set())
	}, [successfulCreateKey])
	useEffect(() => {
		let cancelled = false
		const shouldLoadBrowse = view === 'browse' || openOracleResult?.action === 'createReportInstance'
		if (!environmentReady || !shouldLoadBrowse) return undefined
		const runBrowseLoad = async () => {
			await browseLoad.run({
				isCurrent: () => !cancelled,
				onStart: () => {
					setBrowseLoadState({ requestKey: browseRequestKey, status: 'loading' })
				},
				load: async () => await loadBrowseReports(browsePageIndex, BROWSE_PAGE_SIZE),
				onSuccess: page => {
					setBrowsePage(page)
					setBrowseLoadState({ requestKey: browseRequestKey, status: 'ready' })
				},
				onError: error => {
					setBrowsePage(undefined)
					setBrowseLoadState({
						message: error instanceof Error ? error.message : openOracleCopy.reportLoadError,
						requestKey: browseRequestKey,
						status: 'error',
					})
				},
			})
		}
		void runBrowseLoad()
		return () => {
			cancelled = true
		}
	}, [browsePageIndex, browseReloadKey, environmentReady, environmentRefreshKey, loadBrowseReports, openOracleResult?.action, openOracleResult?.hash, view])
	const browseLoadStateIsCurrent = browseLoadState.requestKey === browseRequestKey
	const loadingBrowse = !environmentReady || !browseLoadStateIsCurrent || browseLoadState.status === 'loading'
	const browseLoadError = browseLoadStateIsCurrent && browseLoadState.status === 'error' ? browseLoadState.message : undefined
	const browseReady = browseLoadStateIsCurrent && browseLoadState.status === 'ready'
	const currentBrowsePage = browseReady ? browsePage : undefined
	const normalizedBrowseSearchText = browseSearchText.trim().toLowerCase()
	const browseReportCount = currentBrowsePage?.reportCount ?? 0n
	const browsePageCount = currentBrowsePage === undefined ? undefined : getPaginationPageCount(browseReportCount, BROWSE_PAGE_SIZE)
	const browseHasPreviousPage = browsePageIndex > 0
	const browseHasNextPage = getHasNextPaginationPage(browsePageIndex, browsePageCount)
	const filteredBrowseReports =
		currentBrowsePage?.reports.filter(report => {
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
	const hasActiveBrowseFilters = normalizedBrowseSearchText !== '' || browseStatusFilter !== 'all'
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
								summary={currentBrowsePage === undefined ? undefined : formatPaginationSummary(browsePageIndex, browsePageCount)}
							/>
						}
						density='compact'
						title={openOracleCopy.browseReports}
						variant='plain'
					>
						<div className='filter-toolbar'>
							<label className='field'>
								<span>{openOracleCopy.searchReports}</span>
								<FormInput value={browseSearchText} onInput={event => setBrowseSearchText(event.currentTarget.value)} placeholder={openOracleCopy.searchByReportIdTokenSymbolOrTokenAddress} />
							</label>
							<label className='field'>
								<span>{commonCopy.status}</span>
								<select value={browseStatusFilter} onChange={event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
									<option value='all'>{openOracleCopy.allStatuses}</option>
									<option value='Pending'>{commonCopy.pending}</option>
									<option value='Disputed'>{openOracleCopy.disputed}</option>
									<option value='Settled'>{commonCopy.settled}</option>
								</select>
							</label>
						</div>
						{currentBrowsePage === undefined || !hasActiveBrowseFilters ? undefined : <p className='detail'>{openOracleCopy.formatBrowseShownCountSummary(filteredBrowseReports.length.toString(), currentBrowsePage.reports.length.toString())}</p>}
						{(() => {
							if (loadingBrowse)
								return (
									<StateHint
										presentation={{
											key: 'loading',
											badgeLabel: commonCopy.loading,
											badgeTone: 'pending',
											detail: environmentReady ? openOracleCopy.reportSummariesRefreshingDetail : openOracleCopy.reportSummariesInitializingDetail,
											detailIsLoading: true,
										}}
									/>
								)
							if (browseLoadError !== undefined)
								return (
									<StateHint
										announcement='assertive'
										actions={
											<button className='secondary' type='button' onClick={() => setBrowseReloadKey(current => current + 1)}>
												{openOracleCopy.retryReports}
											</button>
										}
										presentation={{
											key: 'load_failed',
											badgeLabel: commonCopy.failed,
											badgeTone: 'error',
											detail: browseLoadError,
										}}
									/>
								)
							if (currentBrowsePage === undefined) return undefined
							if (currentBrowsePage.reports.length === 0) return <StateHint announcement='polite' presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail: openOracleCopy.oracleGamesEmpty }} />
							if (filteredBrowseReports.length === 0) return <StateHint announcement='polite' presentation={{ key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: openOracleCopy.reportFiltersEmpty }} />

							return <div className='entity-card-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
						})()}
					</SectionBlock>
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{openOracleResult?.action !== 'createReportInstance' ? undefined : (
						<SectionBlock title={openOracleCopy.createSuccess}>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => onActiveViewChange('browse')}>
									{commonCopy.returnToBrowse}
								</button>
								<button className='secondary' type='button' onClick={() => onActiveViewChange('create')}>
									{openOracleCopy.createAnother}
								</button>
							</div>
						</SectionBlock>
					)}
					<SectionBlock title={openOracleCopy.openOracleGame} variant='plain'>
						<p className='notice warning'>{openOracleCopy.standaloneOracleWarningDetail}</p>
						<p className='detail'>{openOracleCopy.standaloneOracleIntroduction}</p>
						<div className='form-grid'>
							<SectionBlock headingLevel={4} title={openOracleCopy.tokenPair} variant='embedded'>
								<div className='field-row'>
									<div className='field'>
										<label>
											<span>{openOracleCopy.token1Address}</span>
											<FormInput
												aria-describedby={token1AddressError === undefined ? undefined : 'open-oracle-token1-address-error'}
												aria-label={openOracleCopy.token1Address}
												invalid={token1AddressError !== undefined}
												onBlur={() => markCreateFieldTouched('token1Address')}
												onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })}
												placeholder={commonCopy.hexValuePlaceholder}
												value={openOracleCreateForm.token1Address}
											/>
										</label>
										{token1AddressError === undefined ? undefined : (
											<p className='field-error' id='open-oracle-token1-address-error' role='alert'>
												{token1AddressError}
											</p>
										)}
									</div>
									<div className='field'>
										<label>
											<span>{openOracleCopy.token2Address}</span>
											<FormInput
												aria-describedby={token2AddressError === undefined ? undefined : 'open-oracle-token2-address-error'}
												aria-label={openOracleCopy.token2Address}
												invalid={token2AddressError !== undefined}
												onBlur={() => markCreateFieldTouched('token2Address')}
												onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })}
												placeholder={commonCopy.hexValuePlaceholder}
												value={openOracleCreateForm.token2Address}
											/>
										</label>
										{token2AddressError === undefined ? undefined : (
											<p className='field-error' id='open-oracle-token2-address-error' role='alert'>
												{token2AddressError}
											</p>
										)}
									</div>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={openOracleCopy.initialEconomics} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.exactToken1Report}</span>
										<FormInput
											aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('exactToken1Report'), exactToken1ReportError, 'open-oracle-exact-token1-report-help')}
											aria-label={openOracleCopy.exactToken1Report}
											inputMode='decimal'
											invalid={exactToken1ReportError !== undefined}
											onBlur={() => markCreateFieldTouched('exactToken1Report')}
											onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })}
											value={openOracleCreateForm.exactToken1Report}
										/>
										<p id='open-oracle-exact-token1-report-help' className='field-help'>
											{openOracleCopy.initialToken1AmountHelpText}
										</p>
										{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('exactToken1Report'), exactToken1ReportError)}
									</label>
									<label className='field'>
										<span>{openOracleCopy.initialToken2Amount}</span>
										<FormInput
											aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('initialToken2Amount'), initialToken2AmountError, 'open-oracle-initial-token2-amount-help')}
											aria-label={openOracleCopy.initialToken2Amount}
											inputMode='decimal'
											invalid={initialToken2AmountError !== undefined}
											onBlur={() => markCreateFieldTouched('initialToken2Amount')}
											onInput={event => onOpenOracleCreateFormChange({ initialToken2Amount: event.currentTarget.value })}
											value={openOracleCreateForm.initialToken2Amount}
										/>
										<p id='open-oracle-initial-token2-amount-help' className='field-help'>
											{openOracleCopy.initialToken2AmountHelpText}
										</p>
										{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('initialToken2Amount'), initialToken2AmountError)}
									</label>
								</div>
								<label className='field'>
									<span>{openOracleCopy.settlerReward}</span>
									<FormInput
										aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('settlerReward'), settlerRewardError, 'open-oracle-settler-reward-help')}
										aria-label={openOracleCopy.settlerReward}
										inputMode='decimal'
										invalid={settlerRewardError !== undefined}
										onBlur={() => markCreateFieldTouched('settlerReward')}
										onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })}
										value={openOracleCreateForm.settlerReward}
									/>
									<p id='open-oracle-settler-reward-help' className='field-help'>
										{openOracleCopy.settlerRewardHelpText}
									</p>
									{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('settlerReward'), settlerRewardError)}
								</label>
								<label className='field'>
									<span>{openOracleCopy.ethValueToSend}</span>
									<FormInput
										aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('ethValue'), ethValueError, 'open-oracle-eth-value-help')}
										aria-label={openOracleCopy.ethValueToSend}
										inputMode='decimal'
										invalid={ethValueError !== undefined}
										onBlur={() => markCreateFieldTouched('ethValue')}
										onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })}
										value={openOracleCreateForm.ethValue}
									/>
									<p id='open-oracle-eth-value-help' className='field-help'>
										{openOracleCopy.creationFundingRequirementHelpText}
									</p>
									{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('ethValue'), ethValueError)}
								</label>
							</SectionBlock>

							<ReadOnlyDetailAccordion title={openOracleCopy.advancedDisputeAndTimingSettings}>
								<p className='detail'>{openOracleCopy.advancedDisputeAndTimingSettingsDetail}</p>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.disputeFeePercentage}</span>
										<FormInput
											aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('feePercentage'), feePercentageError)}
											aria-label={openOracleCopy.disputeFeePercentage}
											inputMode='decimal'
											invalid={feePercentageError !== undefined}
											onBlur={() => markCreateFieldTouched('feePercentage')}
											onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })}
											value={openOracleCreateForm.feePercentage}
										/>
										{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('feePercentage'), feePercentageError)}
									</label>
									<label className='field'>
										<span>{commonCopy.multiplier}</span>
										<FormInput
											aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('multiplier'), multiplierError, 'open-oracle-multiplier-help')}
											aria-label={commonCopy.multiplier}
											inputMode='numeric'
											invalid={multiplierError !== undefined}
											onBlur={() => markCreateFieldTouched('multiplier')}
											onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })}
											value={openOracleCreateForm.multiplier}
										/>
										<p id='open-oracle-multiplier-help' className='field-help'>
											{openOracleCopy.escalationMultiplierHelpText}
										</p>
										{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('multiplier'), multiplierError)}
									</label>
								</div>
								<SectionBlock headingLevel={4} title={openOracleCopy.timing} variant='embedded'>
									<div className='field-row'>
										<label className='field'>
											<span>{openOracleCopy.settlementDelaySeconds}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('settlementTime'), settlementTimeError)}
												aria-label={openOracleCopy.settlementDelaySeconds}
												inputMode='numeric'
												invalid={settlementTimeError !== undefined}
												onBlur={() => markCreateFieldTouched('settlementTime')}
												onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })}
												value={openOracleCreateForm.settlementTime}
											/>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('settlementTime'), settlementTimeError)}
										</label>
										<label className='field'>
											<span>{openOracleCopy.escalationHalt}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('escalationHalt'), escalationHaltError, 'open-oracle-escalation-halt-help')}
												aria-label={openOracleCopy.escalationHalt}
												inputMode='decimal'
												invalid={escalationHaltError !== undefined}
												onBlur={() => markCreateFieldTouched('escalationHalt')}
												onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })}
												value={openOracleCreateForm.escalationHalt}
											/>
											<p id='open-oracle-escalation-halt-help' className='field-help'>
												{openOracleCopy.disputeEscalationStopAmountHelpText}
											</p>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('escalationHalt'), escalationHaltError)}
										</label>
									</div>
									<div className='field-row'>
										<label className='field'>
											<span>{openOracleCopy.disputeDelaySeconds}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('disputeDelay'), disputeDelayError)}
												aria-label={openOracleCopy.disputeDelaySeconds}
												inputMode='numeric'
												invalid={disputeDelayError !== undefined}
												onBlur={() => markCreateFieldTouched('disputeDelay')}
												onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })}
												value={openOracleCreateForm.disputeDelay}
											/>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('disputeDelay'), disputeDelayError)}
										</label>
										<label className='field'>
											<span>{openOracleCopy.protocolFeePercentage}</span>
											<FormInput
												aria-describedby={getOpenOracleFieldDescribedBy(getOpenOracleCreateFieldErrorId('protocolFee'), protocolFeeError)}
												aria-label={openOracleCopy.protocolFeePercentage}
												inputMode='decimal'
												invalid={protocolFeeError !== undefined}
												onBlur={() => markCreateFieldTouched('protocolFee')}
												onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })}
												value={openOracleCreateForm.protocolFee}
											/>
											{renderOpenOracleFieldError(getOpenOracleCreateFieldErrorId('protocolFee'), protocolFeeError)}
										</label>
									</div>
								</SectionBlock>
								<h4>{openOracleCopy.parameterDetails}</h4>
								<p className='detail'>{openOracleCopy.standaloneParameterDetails}</p>
							</ReadOnlyDetailAccordion>

							<TransactionReview
								context={[
									{ label: openOracleCopy.token1Address, value: <AddressValue address={openOracleCreateForm.token1Address.trim() === '' ? undefined : openOracleCreateForm.token1Address} /> },
									{ label: openOracleCopy.token2Address, value: <AddressValue address={openOracleCreateForm.token2Address.trim() === '' ? undefined : openOracleCreateForm.token2Address} /> },
									{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
								]}
								primary={[
									{ label: transactionReviewCopy.youPay, value: `${openOracleCreateForm.ethValue || commonCopy.metricUnavailablePlaceholder} ${commonCopy.eth}` },
									{ label: openOracleCopy.reportAmounts, value: `${openOracleCreateForm.exactToken1Report || commonCopy.metricUnavailablePlaceholder} / ${openOracleCreateForm.initialToken2Amount || commonCopy.metricUnavailablePlaceholder}` },
								]}
								details={[
									{ label: openOracleCopy.settlerReward, value: `${openOracleCreateForm.settlerReward || commonCopy.metricUnavailablePlaceholder} ${commonCopy.eth}` },
									{ label: openOracleCopy.settlementDelaySeconds, value: openOracleCreateForm.settlementTime || commonCopy.metricUnavailablePlaceholder },
									{ label: openOracleCopy.disputeDelaySeconds, value: openOracleCreateForm.disputeDelay || commonCopy.metricUnavailablePlaceholder },
									{ label: openOracleCopy.disputeFeePercentage, value: `${openOracleCreateForm.feePercentage || commonCopy.metricUnavailablePlaceholder}%` },
									{ label: commonCopy.multiplier, value: formatOpenOracleMultiplier(tryParseBigIntInput(openOracleCreateForm.multiplier)) },
									{ label: openOracleCopy.escalationHalt, value: openOracleCreateForm.escalationHalt || commonCopy.metricUnavailablePlaceholder },
									{ label: openOracleCopy.protocolFeePercentage, value: `${openOracleCreateForm.protocolFee || commonCopy.metricUnavailablePlaceholder}%` },
								]}
								risks={[openOracleCopy.standaloneFundingRisk, openOracleCopy.standaloneDisputeSettingsRisk]}
							/>

							<div className='actions'>
								<TransactionActionButton
									idleLabel={openOracleCopy.createStandaloneOracleGame}
									pendingLabel={openOracleCopy.creating}
									onClick={onCreateOpenOracleGame}
									pending={loadingOpenOracleCreate}
									availability={{ disabled: !isMainnet || createGuardMessage !== undefined || !createValidation.isValid, reason: createAvailabilityMessage }}
									disabledReasonElementId={createDisabledReasonElementId}
									showDisabledReason={createDisabledReasonElementId === undefined}
								/>
							</div>
						</div>
					</SectionBlock>
					<ErrorNotice message={openOracleError} />
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='workflow-stack route-workflow-stack open-oracle-report-stack'>
					{renderReportDetailsCard(
						effectiveOpenOracleReportDetails,
						openOracleForm,
						openOracleTokenAccessState,
						openOracleDisputeSubmission,
						openOracleActiveAction,
						openOracleActiveWithdrawalBalance,
						openOracleResult,
						openOracleReportLookupState,
						openOracleWithdrawalBalanceChecking,
						openOracleWithdrawalReviewMessage,
						accountState.address,
						isConnected,
						isMainnet,
						selectedReportModal,
						onApproveToken1,
						onApproveToken2,
						onDisputeReport,
						onLoadOracleReport,
						onOpenOracleFormChange,
						changeSelectedReportModal,
						onSettleReport,
						onWithdrawOpenOracleBalance,
						openOracleWithdrawableBalances,
						openOracleWithdrawableBalancesError,
						openOracleWithdrawableBalancesLoading,
					)}
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</div>
	)
}
