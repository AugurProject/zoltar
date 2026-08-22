import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { ComparisonRecord } from '@zoltar/ui-core-shared/components/ComparisonRecord.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EnumDropdown, type EnumDropdownOption } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/lib/clients.js'
import {
	formatOpenOracleFeePercentage,
	formatOpenOracleMultiplier,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleReportStatusTone,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	type OpenOracleCreateField,
	type OpenOracleDisputeInputField,
	type OpenOracleDisputeSubmissionDetails,
	type OpenOracleSelectedReportActionMode,
} from '../lib/openOracle.js'
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js'
import { loadOpenOracleReportSummaries } from '../../../protocol/index.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/lib/network.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { getReportPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleWithdrawableBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleSectionProps } from '../../types.js'
export const BROWSE_PAGE_SIZE = 10
const OPEN_ORACLE_PRICE_UNITS = 30
type WithdrawalBalanceKey = keyof OpenOracleWithdrawableBalances
export type SelectedReportModal = 'dispute' | 'settle' | `withdraw-${WithdrawalBalanceKey}` | undefined
export type BrowseLoadState =
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
export const DISPUTE_REPORT_MODAL: SelectedReportModal = 'dispute'
export const SETTLE_REPORT_MODAL: SelectedReportModal = 'settle'
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
	settlerRewardEthAmount: 'open-oracle-settler-reward-error',
	token1Address: 'open-oracle-token1-address-error',
	token2Address: 'open-oracle-token2-address-error',
}
const OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER: readonly OpenOracleDisputeInputField[] = ['disputeNewAmount1', 'disputeNewAmount2', 'disputeTokenToSwap']
export function getOpenOracleCreateFieldErrorId(field: OpenOracleCreateField) {
	return OPEN_ORACLE_CREATE_FIELD_ERROR_IDS[field]
}
export function getOpenOracleFieldDescribedBy(errorId: string, error: string | undefined, helpId?: string) {
	return [helpId, error === undefined ? undefined : errorId].filter(value => value !== undefined).join(' ') || undefined
}
export function renderOpenOracleFieldError(id: string, message: string | undefined) {
	if (message === undefined) return undefined
	return (
		<p className='field-error' id={id} role='alert'>
			{message}
		</p>
	)
}
export function formatOpenOracleReviewDuration(value: string) {
	const seconds = tryParseBigIntInput(value)
	if (seconds === undefined) return commonCopy.metricUnavailablePlaceholder
	return `${formatDuration(seconds)} (${openOracleCopy.formatExactSeconds(seconds.toString())})`
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
export function getSelectedWithdrawalBalance(modal: SelectedReportModal): WithdrawalBalanceKey | undefined {
	if (modal === 'withdraw-ethAttoEth') return 'ethAttoEth'
	if (modal === 'withdraw-token1') return 'token1'
	if (modal === 'withdraw-token2') return 'token2'
	return undefined
}
export type BrowseStatusFilter = 'all' | 'Pending' | 'Disputed' | 'Settled'
export function getEffectiveOpenOracleReportDetails(report: OpenOracleReportDetails | undefined, currentTimestamp: bigint | undefined, currentBlockNumber: bigint | undefined) {
	if (report === undefined) return undefined
	if ((currentTimestamp === undefined || report.currentTime === currentTimestamp) && (currentBlockNumber === undefined || report.currentBlockNumber === currentBlockNumber)) return report
	return {
		...report,
		currentBlockNumber: currentBlockNumber ?? report.currentBlockNumber,
		currentTime: currentTimestamp ?? report.currentTime,
	}
}
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
export async function loadBrowseReportPage(pageIndex: number, pageSize: number) {
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

function OpenOracleClockValue({ currentTimestamp, timeType, value, zeroText }: { currentTimestamp?: bigint; timeType: boolean; value: bigint; zeroText?: ComponentChildren }) {
	if (timeType) return <TimestampValue timestamp={value} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} {...(zeroText === undefined ? {} : { zeroText })} />
	if (value === 0n && zeroText !== undefined) return <span className='timestamp-value zero'>{zeroText}</span>
	return <span className='timestamp-value'>{openOracleCopy.formatTimingValue(value.toString(), openOracleCopy.blocks)}</span>
}

function getOpenOracleClockLabel(timeType: boolean, timestampLabel: string, blockLabel: string) {
	return timeType ? timestampLabel : blockLabel
}

export function renderReportSummaryCard(report: OpenOracleReportSummary, onSelectReport: (reportId: bigint) => void) {
	const status = getOpenOracleReportStatus(report)
	const statusTone = getOpenOracleReportStatusTone(status)
	const reportTitle = openOracleCopy.formatReportBrowseTitle(report.token1Symbol, report.token2Symbol, report.reportId.toString())
	return (
		<ComparisonRecord
			key={report.reportId.toString()}
			title={reportTitle}
			badge={<Badge tone={statusTone}>{status}</Badge>}
			action={
				<button aria-label={openOracleCopy.formatOpenReportLabel(reportTitle)} className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
					{openOracleCopy.openReport}
				</button>
			}
			metrics={[
				{ label: openOracleCopy.currentPrice, value: <CurrencyValue value={report.price} suffix={openOracleCopy.formatTokenPairSuffix(report.token1Symbol, report.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} /> },
				{ label: openOracleCopy.formatCurrentAmount1Label(report.token1Symbol), value: <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} /> },
				{ label: openOracleCopy.formatCurrentAmount2Label(report.token2Symbol), value: <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} /> },
				{ label: getOpenOracleClockLabel(report.timeType, openOracleCopy.reportTimestamp, openOracleCopy.reportBlock), value: <OpenOracleClockValue timeType={report.timeType} value={report.reportTimestamp} /> },
				{ label: getOpenOracleClockLabel(report.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock), value: <OpenOracleClockValue timeType={report.timeType} value={report.settlementTimestamp} zeroText={openOracleCopy.notSettled} /> },
			]}
		>
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
		</ComparisonRecord>
	)
}
export function renderSelectedReportActionSection({
	actionMode,
	disputeSubmission,
	isConnected,
	isOnActiveAppChain,
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
	isOnActiveAppChain: boolean
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
				if (!isOnActiveAppChain) return getWrongNetworkReason()
				return token1ApprovalGuardMessage
			})()
			const disputeToken2ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token2Symbol)
				if (!isOnActiveAppChain) return getWrongNetworkReason()
				return token2ApprovalGuardMessage
			})()
			const disputeActionDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.disputeWalletRequiredReason
				if (!isOnActiveAppChain) return getWrongNetworkReason()
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
										disabled={!isConnected || !isOnActiveAppChain}
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
										disabled={!isConnected || !isOnActiveAppChain}
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
						{!isOnActiveAppChain || disputeSubmission?.blockMessage?.kind !== 'visible' || disputeSubmission.blockMessage === disputeSubmission.inputBlockMessage ? undefined : <p className='detail'>{disputeSubmission.blockMessage.message}</p>}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.disputeAndSwapAction}
								pendingLabel={openOracleCopy.submittingDispute}
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isOnActiveAppChain || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
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
				if (!isOnActiveAppChain) return getWrongNetworkReason()
				return settleDisabledMessage
			})()
			return (
				<SectionBlock variant='embedded'>
					<div className='form-grid'>
						<TransactionReview
							primary={[{ label: openOracleCopy.reportLifecycle, value: openOracleCopy.settled }]}
							details={
								openOracleReportDetails === undefined
									? []
									: [
											{
												label: openOracleCopy.reporterToken1Credit,
												value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
											},
											{
												label: openOracleCopy.reporterToken2Credit,
												value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} copyable={false} />,
											},
											{
												label: openOracleCopy.settlerCredit,
												value: <CurrencyValue value={openOracleReportDetails.settlerRewardAttoEth} suffix={commonCopy.eth} copyable={false} />,
											},
										]
							}
							risks={[openOracleCopy.settlementFinalityRisk, openOracleCopy.settlementWithdrawalRisk]}
						/>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.settlementSummary, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{
										label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock),
										value:
											openOracleReportDetails.settlementTimestamp === 0n ? (
												openOracleCopy.settlementTimestampOnConfirmation
											) : (
												<OpenOracleClockValue currentTimestamp={openOracleReportDetails.currentTime} timeType={openOracleReportDetails.timeType} value={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} />
											),
									},
								])}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.settleReportAction}
								pendingLabel={openOracleCopy.settlingReport}
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isOnActiveAppChain || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
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
export function renderReportDetailsCard(
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
	isOnActiveAppChain: boolean,
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
		{ amount: openOracleWithdrawableBalances?.ethAttoEth, key: 'ethAttoEth' as const, symbol: commonCopy.eth, units: 18 },
		{ amount: openOracleWithdrawableBalances?.token1, key: 'token1' as const, symbol: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals },
		{ amount: openOracleWithdrawableBalances?.token2, key: 'token2' as const, symbol: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals },
	]
	const selectedWithdrawalBalance = getSelectedWithdrawalBalance(selectedReportModal)
	const selectedWithdrawalItem = withdrawableBalanceItems.find(item => item.key === selectedWithdrawalBalance)
	const selectedWithdrawalAmount = selectedWithdrawalItem?.amount
	const selectedWithdrawalReviewMessage = openOracleWithdrawalReviewMessage !== undefined && openOracleWithdrawalReviewMessage.balance === selectedWithdrawalBalance ? openOracleWithdrawalReviewMessage.message : undefined
	const withdrawalDisabledReason = (() => {
		if (!isOnActiveAppChain) return getWrongNetworkReason()
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
										availability={{ disabled: !isOnActiveAppChain || openOracleActiveAction === 'withdrawBalance', reason: isOnActiveAppChain ? undefined : getWrongNetworkReason() }}
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
							value: <CurrencyValue value={openOracleReportDetails.settlerRewardAttoEth} suffix={commonCopy.eth} copyable={false} />,
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
							label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.reportTimestamp, openOracleCopy.reportBlock),
							value: <OpenOracleClockValue currentTimestamp={openOracleReportDetails.currentTime} timeType={openOracleReportDetails.timeType} value={openOracleReportDetails.reportTimestamp} />,
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
							label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock),
							value: <OpenOracleClockValue currentTimestamp={openOracleReportDetails.currentTime} timeType={openOracleReportDetails.timeType} value={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} />,
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
					isOnActiveAppChain,
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
					isOnActiveAppChain,
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
								disabled: !isOnActiveAppChain || selectedWithdrawalAmount <= 0n || openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance',
								reason: withdrawalDisabledReason,
							}}
						/>
					</div>
				</OperationModal>
			)}
		</>
	)
}
