import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EnumDropdown, type EnumDropdownOption } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { InlineHint } from '@zoltar/ui-core-shared/components/InlineHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { formatOpenOracleReportPriceUnit, getOpenOracleDisputeAvailability, getOpenOracleSettleAvailability, type OpenOracleCreateField, type OpenOracleDisputeInputField, type OpenOracleDisputeSubmissionDetails, type OpenOracleSelectedReportActionMode } from '../lib/openOracle.js'
import { loadOpenOracleReportSummaries } from '../../../protocol/openOracle.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { getWalletConnectionActiveAppChainGuardState, withWalletGuardFirst } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { OpenOracleFormState } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleSectionProps } from '../../oracleTypes.js'
export const BROWSE_PAGE_SIZE = 10
export const OPEN_ORACLE_PRICE_UNITS = 30
export type SelectedReportModal = 'dispute' | undefined
export const DISPUTE_REPORT_MODAL: SelectedReportModal = 'dispute'
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
/** Matches `FormInput` `liveError`: a mounted polite region, so a new error is announced without interrupting input. */
function renderOpenOracleFieldError(id: string, message: string | undefined) {
	return (
		<div aria-live='polite' className='field-error-live-region'>
			{message === undefined ? undefined : <UserMessage placement='field' tone='error' id={id} detail={message} />}
		</div>
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
export function getEffectiveOpenOracleReportDetails(report: OpenOracleReportDetails | undefined, currentTimestamp: bigint | undefined, currentBlockNumber: bigint | undefined) {
	if (report === undefined) return undefined
	if ((currentTimestamp === undefined || report.currentTime === currentTimestamp) && (currentBlockNumber === undefined || report.currentBlockNumber === currentBlockNumber)) return report
	return {
		...report,
		currentBlockNumber: currentBlockNumber ?? report.currentBlockNumber,
		currentTime: currentTimestamp ?? report.currentTime,
	}
}
export async function loadBrowseReportPage(pageIndex: number, pageSize: number) {
	return await loadOpenOracleReportSummaries(createConnectedReadClient(), pageIndex, pageSize)
}
export function renderReportField(label: string, value: ComponentChildren) {
	return (
		<MetricField key={label} label={label}>
			{value}
		</MetricField>
	)
}
export function renderReportSection(
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
export function renderReportFields(
	fields: Array<{
		label: string
		value: ComponentChildren
	}>,
) {
	return <MetricGrid variant='question'>{fields.map(field => renderReportField(field.label, field.value))}</MetricGrid>
}

export function OpenOracleClockValue({ currentTimestamp, timeType, value, zeroText }: { currentTimestamp?: bigint; timeType: boolean; value: bigint; zeroText?: ComponentChildren }) {
	if (timeType) return <TimestampValue timestamp={value} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} {...(zeroText === undefined ? {} : { zeroText })} />
	if (value === 0n && zeroText !== undefined) return <span className='timestamp-value zero'>{zeroText}</span>
	return <span className='timestamp-value'>{openOracleCopy.formatTimingValue(value.toString(), openOracleCopy.blocks)}</span>
}

export function getOpenOracleClockLabel(timeType: boolean, timestampLabel: string, blockLabel: string) {
	return timeType ? timestampLabel : blockLabel
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
	onDisputeFieldRevealChange = () => undefined,
	revealedDisputeFields = new Set(),
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
	/** Amount errors stay hidden while typing; a field reveals its error on blur and hides it again on input. */
	onDisputeFieldRevealChange?: (field: OpenOracleDisputeInputField, revealed: boolean) => void
	revealedDisputeFields?: ReadonlySet<OpenOracleDisputeInputField>
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
			const sharedApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.disputeWalletRequiredReason
				if (!isOnActiveAppChain) return getWrongNetworkReason()
				if (openOracleReportDetails === undefined) return openOracleCopy.reportLoadRequired
				return undefined
			})()
			const disputeActionDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.disputeWalletRequiredReason
				if (!isOnActiveAppChain) return getWrongNetworkReason()
				return disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined)
			})()
			const disputeActionAvailability = withWalletGuardFirst(
				{ disabled: !isConnected || !isOnActiveAppChain || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false, reason: disputeActionDisabledReason },
				getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected: isConnected, walletRequiredReason: openOracleCopy.disputeWalletRequiredReason }),
			)
			const disputeReportId = openOracleForm.reportId.trim() || 'unselected'
			const sharedApprovalGuardMessageId = `open-oracle-dispute-approval-guard-${disputeReportId}`
			const renderDisputeTokenApproval = (token: 'token1' | 'token2') => {
				const isToken1 = token === 'token1'
				const tokenSymbol = isToken1 ? token1Symbol : token2Symbol
				const approval = isToken1 ? openOracleTokenAccessState.token1Approval : openOracleTokenAccessState.token2Approval
				const requiredAmount = isToken1 ? disputeSubmission?.token1ContributionAmount : disputeSubmission?.token2ContributionAmount
				const tokenApprovalGuardMessage = (() => {
					if (openOracleReportDetails === undefined) return openOracleCopy.reportLoadRequired
					if (requiredAmount === undefined) return openOracleCopy.formatDisputeAmountsInvalidReason(tokenSymbol)

					return undefined
				})()
				return (
					<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(tokenSymbol)} variant='embedded'>
						<TokenApprovalControl
							actionLabel={openOracleCopy.disputingTheReport}
							allowanceError={approval.error}
							allowanceLoading={approval.loading}
							approvedAmount={approval.value}
							disabled={!isConnected || !isOnActiveAppChain}
							guardMessage={sharedApprovalGuardMessage ?? tokenApprovalGuardMessage}
							guardMessageElementId={sharedApprovalGuardMessage === undefined ? undefined : sharedApprovalGuardMessageId}
							onApprove={amount => (isToken1 ? onApproveToken1 : onApproveToken2)(amount)}
							pending={openOracleActiveAction === (isToken1 ? 'approveToken1' : 'approveToken2')}
							pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(tokenSymbol)}
							requiredAmount={requiredAmount}
							resetKey={`dispute:${token}:${tokenSymbol}:${requiredAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
							tokenSymbol={tokenSymbol}
							tokenUnits={(isToken1 ? disputeSubmission?.token1Decimals : disputeSubmission?.token2Decimals) ?? 18}
						/>
					</SectionBlock>
				)
			}
			const allDisputeInputFieldErrors = disputeSubmission?.inputFieldErrors ?? {}
			// The token choice is a selection, so its error shows immediately; amount errors wait for blur.
			const disputeInputFieldErrors = {
				disputeTokenToSwap: allDisputeInputFieldErrors.disputeTokenToSwap,
				disputeNewAmount1: revealedDisputeFields.has('disputeNewAmount1') ? allDisputeInputFieldErrors.disputeNewAmount1 : undefined,
				disputeNewAmount2: revealedDisputeFields.has('disputeNewAmount2') ? allDisputeInputFieldErrors.disputeNewAmount2 : undefined,
			}
			const firstDisputeInputErrorField = OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER.find(field => disputeInputFieldErrors[field] !== undefined)
			const disputeInputBlockMessageId = firstDisputeInputErrorField === undefined ? `open-oracle-dispute-input-blocker-${disputeReportId}` : getOpenOracleDisputeFieldErrorId(firstDisputeInputErrorField, disputeReportId)
			const disputeNewAmount1Error = disputeInputFieldErrors.disputeNewAmount1
			const disputeNewAmount2Error = disputeInputFieldErrors.disputeNewAmount2
			const disputeTokenToSwapError = disputeInputFieldErrors.disputeTokenToSwap
			const disputeActionReasonUsesInputBlockMessage = disputeSubmission?.inputBlockMessage?.kind === 'visible' && disputeActionDisabledReason === disputeSubmission.inputBlockMessage.message
			const disputeActionReasonElementId = (() => {
				if (sharedApprovalGuardMessage !== undefined) return sharedApprovalGuardMessageId
				if (disputeActionReasonUsesInputBlockMessage) return disputeInputBlockMessageId
				return undefined
			})()
			const disputeInputBlockDetail =
				disputeSubmission?.inputBlockMessage !== undefined && firstDisputeInputErrorField === undefined ? <UserMessage className='detail' id={disputeInputBlockMessageId} loading={disputeSubmission.inputBlockMessage.kind === 'hidden-loading'} detail={disputeSubmission.inputBlockMessage.message} /> : undefined
			return (
				<SectionBlock variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.currentReportState, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: openOracleCopy.currentPrice, value: <CurrencyValue value={openOracleReportDetails.price} suffix={formatOpenOracleReportPriceUnit(openOracleReportDetails)} units={OPEN_ORACLE_PRICE_UNITS} /> },
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
									aria-label={openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}
									error={disputeNewAmount1Error}
									errorId={getOpenOracleDisputeFieldErrorId('disputeNewAmount1', disputeReportId)}
									inputMode='decimal'
									liveError
									onBlur={() => onDisputeFieldRevealChange('disputeNewAmount1', true)}
									onInput={event => {
										onDisputeFieldRevealChange('disputeNewAmount1', false)
										onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })
									}}
									value={openOracleForm.disputeNewAmount1}
								/>
							</label>
							<label className='field'>
								<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}</span>
								<FormInput
									aria-label={openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}
									error={disputeNewAmount2Error}
									errorId={getOpenOracleDisputeFieldErrorId('disputeNewAmount2', disputeReportId)}
									inputMode='decimal'
									liveError
									onBlur={() => onDisputeFieldRevealChange('disputeNewAmount2', true)}
									onInput={event => {
										onDisputeFieldRevealChange('disputeNewAmount2', false)
										onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })
									}}
									value={openOracleForm.disputeNewAmount2}
								/>
							</label>
						</div>
						{disputeSubmission?.expectedNewAmount1 === undefined || disputeSubmission.token1Decimals === undefined ? undefined : (
							<UserMessage
								className='detail'
								detail={
									disputeSubmission.maximumNewAmount1 === undefined
										? openOracleCopy.formatNewAmountMustBeExactDetail(token1Symbol, formatCurrencyInputBalance(disputeSubmission.expectedNewAmount1, disputeSubmission.token1Decimals))
										: openOracleCopy.formatNewAmountRangeDetail(token1Symbol, formatCurrencyInputBalance(disputeSubmission.expectedNewAmount1, disputeSubmission.token1Decimals), formatCurrencyInputBalance(disputeSubmission.maximumNewAmount1, disputeSubmission.token1Decimals))
								}
							/>
						)}
						{sharedApprovalGuardMessage === undefined ? undefined : (
							// The approvals and the dispute share this reason, so while the wallet blocks them it holds their one wallet fix.
							<WalletActionFixReason availability={disputeActionAvailability} id={sharedApprovalGuardMessageId}>
								<InlineHint id={sharedApprovalGuardMessageId} message={sharedApprovalGuardMessage} />
							</WalletActionFixReason>
						)}
						{disputeSubmission?.inputBlockMessage === undefined ? (
							<>
								{renderDisputeTokenApproval('token1')}
								{renderDisputeTokenApproval('token2')}
							</>
						) : (
							disputeInputBlockDetail
						)}
						{!isOnActiveAppChain || disputeSubmission?.blockMessage?.kind !== 'visible' || disputeSubmission.blockMessage === disputeSubmission.inputBlockMessage ? undefined : <UserMessage className='detail' detail={disputeSubmission.blockMessage.message} />}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.disputeAndSwapAction}
								pendingLabel={openOracleCopy.submittingDispute}
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								availability={disputeActionAvailability}
								disabledReasonElementId={disputeActionReasonElementId}
								showDisabledReason={sharedApprovalGuardMessage === undefined && !disputeActionReasonUsesInputBlockMessage}
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
								idleLabel={openOracleCopy.settleReportTitle(openOracleReportDetails?.reportId ?? 0n)}
								pendingLabel={openOracleCopy.settlingReport}
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								availability={withWalletGuardFirst(
									{ disabled: !isConnected || !isOnActiveAppChain || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct, reason: settleActionDisabledReason },
									getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected: isConnected, walletRequiredReason: openOracleCopy.settlementWalletRequiredReason }),
								)}
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
