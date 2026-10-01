import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { Fragment, type ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
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
import type { OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'
import type { OpenOracleSectionProps } from '../../oracleTypes.js'
export const BROWSE_PAGE_SIZE = 10
export const OPEN_ORACLE_PRICE_UNITS = 30
export type SelectedReportModal = 'dispute' | undefined
export const DISPUTE_REPORT_MODAL: SelectedReportModal = 'dispute'
const OPEN_ORACLE_CREATE_FIELD_ERROR_IDS: Record<OpenOracleCreateField, string> = {
	disputeDelay: 'open-oracle-dispute-delay-error',
	escalationHalt: 'open-oracle-escalation-halt-error',
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
const OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER: readonly OpenOracleDisputeInputField[] = ['disputeNewAmount1', 'disputeNewAmount2']
export function getOpenOracleCreateFieldErrorId(field: OpenOracleCreateField) {
	return OPEN_ORACLE_CREATE_FIELD_ERROR_IDS[field]
}
function getOpenOracleDisputeFieldErrorId(field: OpenOracleDisputeInputField, reportId: string) {
	switch (field) {
		case 'disputeNewAmount1':
			return `open-oracle-dispute-new-amount-1-error-${reportId}`
		case 'disputeNewAmount2':
			return `open-oracle-dispute-new-amount-2-error-${reportId}`
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

function renderTokenAmounts(amounts: ReadonlyArray<{ amount: bigint | undefined; decimals: number | undefined; symbol: string | undefined }>) {
	const known = amounts.filter((entry): entry is { amount: bigint; decimals: number; symbol: string } => entry.amount !== undefined && entry.decimals !== undefined && entry.symbol !== undefined)
	if (known.length === 0 || known.length !== amounts.length) return commonCopy.metricUnavailablePlaceholder
	return (
		<span className='open-oracle-token-amounts'>
			{known.map((entry, index) => (
				<Fragment key={index.toString()}>
					{index === 0 ? undefined : ' '}
					{/* The plus sign stays with the amount it introduces, so a wrapped sum never leaves it on a line of its own. */}
					<span className='open-oracle-token-amount'>
						{index === 0 ? undefined : '+\u00a0'}
						<CurrencyValue value={entry.amount} suffix={entry.symbol} units={entry.decimals} />
					</span>
				</Fragment>
			))}
		</span>
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
							pendingLabel={commonCopy.formatApprovingToken(tokenSymbol)}
							requiredAmount={requiredAmount}
							resetKey={`dispute:${token}:${tokenSymbol}:${requiredAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
							tokenSymbol={tokenSymbol}
							tokenUnits={(isToken1 ? disputeSubmission?.token1Decimals : disputeSubmission?.token2Decimals) ?? 18}
						/>
					</SectionBlock>
				)
			}
			const allDisputeInputFieldErrors = disputeSubmission?.inputFieldErrors ?? {}
			// Amount errors wait for blur so typing stays quiet.
			const disputeInputFieldErrors = {
				disputeNewAmount1: revealedDisputeFields.has('disputeNewAmount1') ? allDisputeInputFieldErrors.disputeNewAmount1 : undefined,
				disputeNewAmount2: revealedDisputeFields.has('disputeNewAmount2') ? allDisputeInputFieldErrors.disputeNewAmount2 : undefined,
			}
			const firstDisputeInputErrorField = OPEN_ORACLE_DISPUTE_INPUT_FIELD_ORDER.find(field => disputeInputFieldErrors[field] !== undefined)
			const disputeInputBlockMessageId = firstDisputeInputErrorField === undefined ? `open-oracle-dispute-input-blocker-${disputeReportId}` : getOpenOracleDisputeFieldErrorId(firstDisputeInputErrorField, disputeReportId)
			const disputeNewAmount1Error = disputeInputFieldErrors.disputeNewAmount1
			const disputeNewAmount2Error = disputeInputFieldErrors.disputeNewAmount2
			const disputeActionReasonUsesInputBlockMessage = disputeSubmission?.inputBlockMessage?.kind === 'visible' && disputeActionDisabledReason === disputeSubmission.inputBlockMessage.message
			const disputeActionReasonElementId = (() => {
				if (sharedApprovalGuardMessage !== undefined) return sharedApprovalGuardMessageId
				if (disputeActionReasonUsesInputBlockMessage) return disputeInputBlockMessageId
				return undefined
			})()
			const flexibleNewAmount1 = disputeSubmission?.maximumNewAmount1 !== undefined
			const newAmount1RangeHint =
				disputeSubmission?.expectedNewAmount1 === undefined || disputeSubmission.maximumNewAmount1 === undefined || disputeSubmission.token1Decimals === undefined
					? undefined
					: openOracleCopy.formatNewAmountRangeDetail(token1Symbol, formatCurrencyInputBalance(disputeSubmission.expectedNewAmount1, disputeSubmission.token1Decimals), formatCurrencyInputBalance(disputeSubmission.maximumNewAmount1, disputeSubmission.token1Decimals))
			const swapToken = (() => {
				if (disputeSubmission?.swapTokenKey === undefined) return { decimals: undefined, symbol: undefined }
				if (disputeSubmission.swapTokenKey === 'token1') return { decimals: disputeSubmission.token1Decimals, symbol: token1Symbol }
				return { decimals: disputeSubmission.token2Decimals, symbol: token2Symbol }
			})()
			const swapTokenSymbol = swapToken.symbol
			const swapTokenDecimals = swapToken.decimals
			const proposedPriceValue = disputeSubmission?.proposedPrice === undefined || openOracleReportDetails === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={disputeSubmission.proposedPrice} suffix={formatOpenOracleReportPriceUnit(openOracleReportDetails)} units={OPEN_ORACLE_PRICE_UNITS} />
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
						<div className='field-row'>
							{flexibleNewAmount1 ? (
								<label className='field'>
									<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}</span>
									<FormInput
										adornment={token1Symbol}
										aria-label={openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}
										error={disputeNewAmount1Error}
										errorId={getOpenOracleDisputeFieldErrorId('disputeNewAmount1', disputeReportId)}
										hint={newAmount1RangeHint}
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
							) : (
								// Without flexible escalation the report fixes the base amount, so it is shown instead of entered.
								<div className='field'>
									<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}</span>
									<strong className='field-read-only-value'>
										<CurrencyValue value={disputeSubmission?.expectedNewAmount1} suffix={token1Symbol} units={disputeSubmission?.token1Decimals ?? 18} precision='exact' />
									</strong>
									<UserMessage placement='field' detail={openOracleCopy.newBaseAmountFixedHint} />
								</div>
							)}
							<label className='field'>
								<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}</span>
								<FormInput
									adornment={token2Symbol}
									aria-label={openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}
									error={disputeNewAmount2Error}
									errorId={getOpenOracleDisputeFieldErrorId('disputeNewAmount2', disputeReportId)}
									hint={openOracleCopy.newQuoteAmountHint}
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
						<SectionBlock headingLevel={4} title={openOracleCopy.disputeOutcome} variant='embedded'>
							<MetricGrid variant='question'>
								<MetricField label={openOracleCopy.proposedPrice}>{proposedPriceValue}</MetricField>
								{/* The pending explanation is prose, so it uses body text rather than the value font. */}
								<MetricField label={openOracleCopy.tokenToSwapOut} valueClassName={swapTokenSymbol === undefined ? 'metric-field-prose' : ''} valueTagName={swapTokenSymbol === undefined ? 'span' : 'strong'}>
									{swapTokenSymbol ?? openOracleCopy.disputeSwapTokenPending}
								</MetricField>
								<MetricField label={openOracleCopy.youPay}>
									{renderTokenAmounts([
										{ amount: disputeSubmission?.token1ContributionAmount, decimals: disputeSubmission?.token1Decimals, symbol: token1Symbol },
										{ amount: disputeSubmission?.token2ContributionAmount, decimals: disputeSubmission?.token2Decimals, symbol: token2Symbol },
									])}
								</MetricField>
								<MetricField label={openOracleCopy.disputeFee}>{renderTokenAmounts([{ amount: disputeSubmission?.disputeFeeAmount, decimals: swapTokenDecimals, symbol: swapTokenSymbol }])}</MetricField>
								<MetricField label={openOracleCopy.disputeProtocolFee}>{renderTokenAmounts([{ amount: disputeSubmission?.protocolFeeAmount, decimals: swapTokenDecimals, symbol: swapTokenSymbol }])}</MetricField>
								<MetricField label={openOracleCopy.creditedToOracleBalance}>{renderTokenAmounts([{ amount: disputeSubmission?.token2CreditAmount, decimals: disputeSubmission?.token2Decimals, symbol: token2Symbol }])}</MetricField>
								<MetricField label={openOracleCopy.yourNewReport}>
									{renderTokenAmounts([
										{ amount: disputeSubmission?.newAmount1, decimals: disputeSubmission?.token1Decimals, symbol: token1Symbol },
										{ amount: disputeSubmission?.newAmount2, decimals: disputeSubmission?.token2Decimals, symbol: token2Symbol },
									])}
								</MetricField>
							</MetricGrid>
							<UserMessage className='detail' detail={swapTokenSymbol === undefined ? openOracleCopy.disputeOutcomePending : openOracleCopy.feesIncludedInPayment} />
						</SectionBlock>
						{sharedApprovalGuardMessage === undefined ? undefined : (
							// The approvals and the dispute share this reason, so while the wallet blocks them it holds their one wallet fix.
							<WalletActionFixReason availability={disputeActionAvailability} id={sharedApprovalGuardMessageId}>
								<InlineHint id={sharedApprovalGuardMessageId} message={sharedApprovalGuardMessage} />
							</WalletActionFixReason>
						)}
						{disputeInputBlockDetail}
						{/* Approval steps stay in place while amounts are invalid; each explains why it is unavailable. */}
						{renderDisputeTokenApproval('token1')}
						{renderDisputeTokenApproval('token2')}
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
