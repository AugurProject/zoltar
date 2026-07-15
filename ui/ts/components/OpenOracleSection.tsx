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
import { assertNever } from '../lib/assert.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { useChainBlockNumber, useChainTimestamp } from '../lib/chainTimestamp.js'
import {
	getOpenOracleCreateGuardMessage,
	getOpenOracleCreateValidationMessage,
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
import {
	UI_STRING_1_00,
	UI_STRING_ALL_STATUSES,
	UI_STRING_AWAITING_INITIAL_REPORT,
	UI_STRING_AWAITING_INITIAL_REPORT_OPEN_ORACLE_SECTION_AWAITING_INITIAL_REPORT_LABEL,
	UI_STRING_BASE_TOKEN_FOR_THE_REPORTED_PAIR,
	UI_STRING_BLOCKS_OPEN_ORACLE_SECTION_TIME_IN_BLOCKS_SUFFIX,
	UI_STRING_BROWSE_REPORTS,
	UI_STRING_CALLBACK_CONTRACT,
	UI_STRING_CALLBACK_EXTRA,
	UI_STRING_CALLBACK_GAS_LIMIT,
	UI_STRING_CONFIRM_SETTLEMENT_ONCE_THE_SELECTED_REPORT_IS_READY,
	UI_STRING_CONNECT_A_WALLET_BEFORE_DISPUTING_THE_REPORT,
	UI_STRING_CONNECT_A_WALLET_BEFORE_SETTLING_THE_REPORT,
	UI_STRING_CONNECT_A_WALLET_BEFORE_SUBMITTING_THE_INITIAL_REPORT,
	UI_STRING_CONNECT_A_WALLET_BEFORE_WRAPPING_ETH,
	UI_STRING_CREATE_ANOTHER,
	UI_STRING_CREATE_STANDALONE_ORACLE_GAME,
	UI_STRING_CREATE_SUCCESS,
	UI_STRING_CREATING,
	UI_STRING_CURRENT_PRICE,
	UI_STRING_CURRENT_REPORT_STATE,
	UI_STRING_CURRENT_REPORTER,
	UI_STRING_DELAY_IN_SECONDS_AFTER_THE_INITIAL_REPORT_BEFORE_DISPUTES_CAN_BEGIN,
	UI_STRING_DELAY_IN_SECONDS_AFTER_THE_INITIAL_REPORT_BEFORE_SETTLEMENT_CAN_BEGIN,
	UI_STRING_DIRECT_OPEN_ORACLE_CREATION_FOR_PROTOCOL_TESTING_THIS_BYPASSES_POOL_MANAGED_ORACLE_MANAGER_STAGING_SO_CONFIRM_ADDRESSES_TOKEN_AMOUNTS_FEES_AND_TIMING_BEFORE_SUBMITTING,
	UI_STRING_DISPUTE_AND_SWAP,
	UI_STRING_DISPUTE_DELAY,
	UI_STRING_DISPUTE_OCCURRED,
	UI_STRING_DISPUTE_REPORT,
	UI_STRING_DISPUTED,
	UI_STRING_DISPUTING_THE_REPORT,
	UI_STRING_ECONOMICS,
	UI_STRING_ESCALATION_HALT,
	UI_STRING_ESCALATION_MULTIPLIER_FOR_DISPUTE_ECONOMICS,
	UI_STRING_ETH,
	UI_STRING_ETH_PAID_TO_THE_ACCOUNT_THAT_SETTLES_THE_REPORT,
	UI_STRING_ETH_SENT_WITH_CREATION_MUST_COVER_REQUIRED_FUNDING_AND_THE_SETTLER_REWARD,
	UI_STRING_ETH_VALUE_TO_SEND,
	UI_STRING_EXACT_TOKEN1_REPORT,
	UI_STRING_FAILED_TO_LOAD_OPEN_ORACLE_REPORTS,
	UI_STRING_FEE,
	UI_STRING_FEE_CHARGED_DURING_DISPUTE_ECONOMICS_ENTERED_AS_A_PERCENTAGE,
	UI_STRING_FEE_PERCENTAGE,
	UI_STRING_FETCH_PRICE_FROM_UNISWAP,
	UI_STRING_FETCHING,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_IDENTITY,
	UI_STRING_INITIAL_ECONOMICS,
	UI_STRING_INITIAL_REPORT,
	UI_STRING_INITIAL_REPORTER,
	UI_STRING_LAST_REPORT_OPPORTUNITY,
	UI_STRING_LOAD_A_REPORT_FIRST,
	UI_STRING_LOADING,
	UI_STRING_LOADING_WITH_ELLIPSIS,
	UI_STRING_MORE_WETH_FOR_THIS_REPORT,
	UI_STRING_MULTIPLIER,
	UI_STRING_NEED,
	UI_STRING_NO,
	UI_STRING_NO_MATCHES,
	UI_STRING_NO_OPEN_ORACLE_GAMES_FOUND,
	UI_STRING_NO_REPORTS_MATCH_THE_CURRENT_SEARCH_AND_STATUS_FILTERS,
	UI_STRING_NONE,
	UI_STRING_NONE_AWAITING_INITIAL_REPORT,
	UI_STRING_NOT_SETTLED,
	UI_STRING_NUMBER_OF_REPORTS,
	UI_STRING_OPEN_A_FOCUSED_ACTION_FLOW_FOR_THE_SELECTED_REPORT_WHEN_IT_IS_AVAILABLE,
	UI_STRING_OPEN_ORACLE_GAME,
	UI_STRING_OPEN_ORACLE_REPORT_DETAILS,
	UI_STRING_OPEN_REPORT,
	UI_STRING_ORACLE_ADDRESS,
	UI_STRING_PENDING,
	UI_STRING_PLURAL_SUFFIX,
	UI_STRING_PRICE,
	UI_STRING_PRICE_SOURCE,
	UI_STRING_PROTOCOL_FEE,
	UI_STRING_PROTOCOL_FEE_CHARGED_DURING_DISPUTES_ENTERED_AS_A_PERCENTAGE,
	UI_STRING_PROTOCOL_FEE_RECIPIENT,
	UI_STRING_PROVIDE_THE_REPLACEMENT_SWAP_AMOUNTS_FOR_THE_SELECTED_REPORT,
	UI_STRING_QUOTE_TOKEN_FOR_THE_REPORTED_PAIR,
	UI_STRING_REFRESH_REPORT,
	UI_STRING_REFRESHING_REPORT_SUMMARIES,
	UI_STRING_REPORT,
	UI_STRING_REPORT_ACTIONS,
	UI_STRING_REPORT_AMOUNTS,
	UI_STRING_REPORT_CONTEXT,
	UI_STRING_REPORT_DETAILS,
	UI_STRING_REPORT_ID,
	UI_STRING_REPORT_TIMESTAMP,
	UI_STRING_REPORTER,
	UI_STRING_RETURN_TO_BROWSE,
	UI_STRING_REVIEW_PRICE_SOURCE_APPROVALS_AND_TOKEN_BALANCES_BEFORE_SUBMITTING_THE_INITIAL_REPORT,
	UI_STRING_SEARCH_BY_REPORT_ID_TOKEN_SYMBOL_OR_TOKEN_ADDRESS,
	UI_STRING_SEARCH_REPORTS,
	UI_STRING_SETTLE_REPORT,
	UI_STRING_SETTLED,
	UI_STRING_SETTLED_REPORT,
	UI_STRING_SETTLEMENT,
	UI_STRING_SETTLEMENT_IS_CONFIRMATION_FIRST_REVIEW_THE_CURRENT_REPORT_STATE_AND_CONFIRM_ONLY_WHEN_THE_DISPUTE_WINDOW_IS_CLOSED,
	UI_STRING_SETTLEMENT_SUMMARY,
	UI_STRING_SETTLEMENT_TIME,
	UI_STRING_SETTLEMENT_TIMESTAMP,
	UI_STRING_SETTLER_REWARD,
	UI_STRING_SETTLING_REPORT,
	UI_STRING_STAGE,
	UI_STRING_STATE_HASH,
	UI_STRING_STATUS,
	UI_STRING_SUBMIT_INITIAL_REPORT,
	UI_STRING_SUBMITTING,
	UI_STRING_SUBMITTING_DISPUTE,
	UI_STRING_SUBMITTING_THE_INITIAL_REPORT,
	UI_STRING_THE_REPORT_INSTANCE_WAS_CREATED_SUCCESSFULLY,
	UI_STRING_THIS_QUOTE_IS_STALE_AND_WILL_BE_REFRESHED_BEFORE_SUBMISSION,
	UI_STRING_THIS_REPORT_IS_SETTLED_NO_WRITE_ACTIONS_ARE_AVAILABLE,
	UI_STRING_TIMING,
	UI_STRING_TOKEN_PAIR,
	UI_STRING_TOKEN_TO_SWAP_OUT,
	UI_STRING_TOKEN1_ADDRESS,
	UI_STRING_TOKEN1_AMOUNT_TO_REPORT_ENTERED_AS_A_DECIMAL_VALUE_FOR_THE_TOKEN1_ADDRESS,
	UI_STRING_TOKEN1_AMOUNT_WHERE_DISPUTE_ESCALATION_STOPS_ENTERED_AS_A_DECIMAL_VALUE_FOR_THE_TOKEN1_ADDRESS,
	UI_STRING_TOKEN2_ADDRESS,
	UI_STRING_TRACK_DISPUTES,
	UI_STRING_USE_THIS_ONLY_WHEN_YOU_INTEND_TO_CREATE_A_STANDALONE_ORACLE_GAME_DIRECTLY_FROM_THE_CONNECTED_WALLET_POOL_MANAGED_ORACLE_REQUESTS_SHOULD_BE_STARTED_FROM_A_SELECTED_SECURITY_POOL,
	UI_STRING_WETH,
	UI_STRING_WRAP_NEEDED_ETH_TO_WETH,
	UI_STRING_WRAPPING_ETH,
	UI_STRING_YES,
	UI_TEMPLATE_APPROVING_TOKEN_PENDING_LABEL,
	UI_TEMPLATE_BROWSE_REPORTS_DESCRIPTION,
	UI_TEMPLATE_BROWSE_SHOWN_COUNT_SUMMARY,
	UI_TEMPLATE_CURRENT_AMOUNT1_LABEL,
	UI_TEMPLATE_CURRENT_AMOUNT2_LABEL,
	UI_TEMPLATE_DISCONNECTED_WALLET_APPROVAL_REASON,
	UI_TEMPLATE_ENTER_VALID_DISPUTE_AMOUNTS_BEFORE_APPROVING_REASON,
	UI_TEMPLATE_ENTER_VALID_PRICE_BEFORE_APPROVING_REASON,
	UI_TEMPLATE_EXACT_TOKEN_REQUIRED_LABEL,
	UI_TEMPLATE_NEW_AMOUNT_MUST_BE_EXACT_DETAIL,
	UI_TEMPLATE_NEW_TOKEN_AMOUNT_FIELD_LABEL,
	UI_TEMPLATE_PRICE_FIELD_LABEL,
	UI_TEMPLATE_QUOTE_AGE_TEXT,
	UI_TEMPLATE_QUOTE_LOADED_DETAIL,
	UI_TEMPLATE_REPORT_NUMBER_TITLE,
	UI_TEMPLATE_TOKEN_APPROVAL_TITLE,
	UI_TEMPLATE_TOKEN_PAIR_SUFFIX,
} from '../lib/uiStrings.js'
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

function renderInitialPriceFreshness(openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'], priceSource: OpenOracleInitialReportSubmissionDetails['priceSource']) {
	if (priceSource !== 'MOCK' && priceSource !== 'Uniswap V3' && priceSource !== 'Uniswap V4') return undefined
	if (openOracleInitialReportState.quoteLoadedAtMs === undefined) return undefined
	return (
		<p className='detail'>
			{UI_TEMPLATE_QUOTE_LOADED_DETAIL(openOracleInitialReportState.quoteBlockNumber?.toString(), UI_TEMPLATE_QUOTE_AGE_TEXT(openOracleInitialReportState.quoteLoadedAtMs))}
			{openOracleInitialReportState.quoteStale === true ? ` ${UI_STRING_THIS_QUOTE_IS_STALE_AND_WILL_BE_REFRESHED_BEFORE_SUBMISSION}` : ''}
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
			title={UI_TEMPLATE_REPORT_NUMBER_TITLE(report.reportId.toString())}
			badge={<Badge tone={statusTone}>{status}</Badge>}
			actions={
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
						{UI_STRING_OPEN_REPORT}
					</button>
				</div>
			}
		>
			<MetricGrid variant='question'>
				{renderReportField(
					UI_STRING_TOKEN_PAIR,
					<>
						<AddressValue address={report.token1} /> / <AddressValue address={report.token2} />
					</>,
				)}
				{renderReportField(UI_STRING_CURRENT_PRICE, <CurrencyValue value={report.price} suffix={UI_TEMPLATE_TOKEN_PAIR_SUFFIX(report.token1Symbol, report.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
				{renderReportField(UI_STRING_CURRENT_REPORTER, report.currentReporter === zeroAddress ? UI_STRING_NONE : <AddressValue address={report.currentReporter} />)}
				{renderReportField(UI_TEMPLATE_CURRENT_AMOUNT1_LABEL(report.token1Symbol), <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} />)}
				{renderReportField(UI_TEMPLATE_CURRENT_AMOUNT2_LABEL(report.token2Symbol), <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} />)}
				{renderReportField(UI_STRING_REPORT_TIMESTAMP, <TimestampValue timestamp={report.reportTimestamp} zeroText={UI_STRING_AWAITING_INITIAL_REPORT_OPEN_ORACLE_SECTION_AWAITING_INITIAL_REPORT_LABEL} />)}
				{renderReportField(UI_STRING_SETTLEMENT_TIMESTAMP, <TimestampValue timestamp={report.settlementTimestamp} zeroText={UI_STRING_NOT_SETTLED} />)}
			</MetricGrid>
		</EntityCard>
	)
}
export function renderSelectedReportActionSection({
	actionMode,
	disputeSubmission,
	initialReportSubmission,
	isConnected,
	isMainnet,
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
	isMainnet: boolean
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
			const token2ApprovalGuardMessage = (() => {
				if (!isConnected) return UI_TEMPLATE_DISCONNECTED_WALLET_APPROVAL_REASON(token2Symbol)
				if (!isMainnet) return undefined
				if (initialReportSubmission.amount2 === undefined) return UI_TEMPLATE_ENTER_VALID_PRICE_BEFORE_APPROVING_REASON(token1Symbol, token2Symbol)
				return undefined
			})()
			const wrapDisabledReason = (() => {
				if (!isConnected) return UI_STRING_CONNECT_A_WALLET_BEFORE_WRAPPING_ETH
				if (!isMainnet) return undefined
				if (initialReportSubmission.wrapRequiredWethMessage?.kind === 'visible') return initialReportSubmission.wrapRequiredWethMessage.message
				return undefined
			})()
			const submitInitialReportDisabledReason = (() => {
				if (!isConnected) return UI_STRING_CONNECT_A_WALLET_BEFORE_SUBMITTING_THE_INITIAL_REPORT
				if (!isMainnet) return undefined
				if (initialReportSubmission.blockMessage?.kind === 'visible') return initialReportSubmission.blockMessage.message
				return undefined
			})()
			return (
				<SectionBlock headingLevel={4} title={UI_STRING_INITIAL_REPORT} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(UI_STRING_REPORT_CONTEXT, [
									{ label: UI_STRING_REPORT, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: UI_STRING_TOKEN_PAIR, value: `${token1Symbol} / ${token2Symbol}` },
									{ label: UI_STRING_STAGE, value: UI_STRING_AWAITING_INITIAL_REPORT_OPEN_ORACLE_SECTION_AWAITING_INITIAL_REPORT_LABEL },
								])}
						<div className='field-row'>
							<label className='field'>
								<span>{UI_TEMPLATE_PRICE_FIELD_LABEL(token1Symbol, token2Symbol)}</span>
								<FormInput value={openOracleForm.price} onInput={event => onOpenOracleFormChange({ price: event.currentTarget.value })} placeholder={UI_STRING_1_00} />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={onRefreshPrice} disabled={openOracleInitialReportState.quoteLoading}>
									{openOracleInitialReportState.quoteLoading ? UI_STRING_FETCHING : UI_STRING_FETCH_PRICE_FROM_UNISWAP}
								</button>
							</div>
						</div>
						<p className='detail'>
							{UI_STRING_PRICE_SOURCE} {showQuoteLoadingPlaceholder ? <strong>{UI_STRING_LOADING_WITH_ELLIPSIS}</strong> : renderInitialPriceSourceLabel(initialReportSubmission.priceSource, initialReportSubmission.priceSourceUrl)}
						</p>
						{renderInitialPriceFreshness(openOracleInitialReportState, initialReportSubmission.priceSource)}
						<SectionBlock headingLevel={4} title={UI_TEMPLATE_TOKEN_APPROVAL_TITLE(token1Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRING_SUBMITTING_THE_INITIAL_REPORT}
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={!isConnected ? UI_TEMPLATE_DISCONNECTED_WALLET_APPROVAL_REASON(token1Symbol) : undefined}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={UI_TEMPLATE_APPROVING_TOKEN_PENDING_LABEL(token1Symbol)}
								requiredAmount={initialReportSubmission.amount1}
								resetKey={`token1:${token1Symbol}:${initialReportSubmission.amount1?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token1Symbol}
								tokenUnits={initialReportSubmission.token1Decimals ?? 18}
							/>
						</SectionBlock>

						<SectionBlock headingLevel={4} title={UI_TEMPLATE_TOKEN_APPROVAL_TITLE(token2Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRING_SUBMITTING_THE_INITIAL_REPORT}
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={token2ApprovalGuardMessage}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={UI_TEMPLATE_APPROVING_TOKEN_PENDING_LABEL(token2Symbol)}
								requiredAmount={initialReportSubmission.amount2}
								resetKey={`token2:${token2Symbol}:${initialReportSubmission.amount2?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token2Symbol}
								tokenUnits={initialReportSubmission.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{initialReportSubmission.requiredWethWrapAmount === undefined || initialReportSubmission.requiredWethWrapAmount <= 0n ? undefined : (
							<p className='detail'>
								{UI_STRING_NEED} <CurrencyValue value={initialReportSubmission.requiredWethWrapAmount} suffix={UI_STRING_WETH} copyable={false} /> {UI_STRING_MORE_WETH_FOR_THIS_REPORT}
							</p>
						)}
						{!isMainnet || initialReportSubmission.wrapRequiredWethMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.wrapRequiredWethMessage.message}</p>}
						{!isMainnet || initialReportSubmission.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.blockMessage.message}</p>}
						<div className='actions'>
							{!initialReportSubmission.hasWethWrapAction ? undefined : (
								<TransactionActionButton
									idleLabel={UI_STRING_WRAP_NEEDED_ETH_TO_WETH}
									pendingLabel={UI_STRING_WRAPPING_ETH}
									onClick={onWrapWethForInitialReport}
									pending={openOracleActiveAction === 'wrapWeth'}
									tone='secondary'
									availability={{
										disabled: !isConnected || !isMainnet || !initialReportSubmission.canWrapRequiredWeth,
										reason: wrapDisabledReason,
									}}
								/>
							)}
							<TransactionActionButton
								idleLabel={UI_STRING_SUBMIT_INITIAL_REPORT}
								pendingLabel={UI_STRING_SUBMITTING}
								onClick={onSubmitInitialReport}
								pending={openOracleActiveAction === 'submitInitialReport'}
								availability={{
									disabled: !isConnected || !isMainnet || !initialReportSubmission.canSubmit,
									reason: submitInitialReportDisabledReason,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		case 'dispute': {
			const disputeDisabledMessage = (() => {
				if (openOracleForm.reportId.trim() === '') return UI_STRING_LOAD_A_REPORT_FIRST

				return disputeAvailability.message
			})()
			const token1ApprovalGuardMessage = (() => {
				if (openOracleReportDetails === undefined) return UI_STRING_LOAD_A_REPORT_FIRST
				if (disputeSubmission?.token1ContributionAmount === undefined) return UI_TEMPLATE_ENTER_VALID_DISPUTE_AMOUNTS_BEFORE_APPROVING_REASON(token1Symbol)

				return undefined
			})()
			const token2ApprovalGuardMessage = (() => {
				if (openOracleReportDetails === undefined) return UI_STRING_LOAD_A_REPORT_FIRST
				if (disputeSubmission?.token2ContributionAmount === undefined) return UI_TEMPLATE_ENTER_VALID_DISPUTE_AMOUNTS_BEFORE_APPROVING_REASON(token2Symbol)

				return undefined
			})()
			const disputeToken1ApprovalGuardMessage = (() => {
				if (!isConnected) return UI_TEMPLATE_DISCONNECTED_WALLET_APPROVAL_REASON(token1Symbol)
				if (!isMainnet) return undefined
				return token1ApprovalGuardMessage
			})()
			const disputeToken2ApprovalGuardMessage = (() => {
				if (!isConnected) return UI_TEMPLATE_DISCONNECTED_WALLET_APPROVAL_REASON(token2Symbol)
				if (!isMainnet) return undefined
				return token2ApprovalGuardMessage
			})()
			const disputeActionDisabledReason = (() => {
				if (!isConnected) return UI_STRING_CONNECT_A_WALLET_BEFORE_DISPUTING_THE_REPORT
				if (!isMainnet) return undefined
				return disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined)
			})()
			return (
				<SectionBlock headingLevel={4} title={UI_STRING_DISPUTE_REPORT} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(UI_STRING_CURRENT_REPORT_STATE, [
									{ label: UI_STRING_REPORT, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: UI_STRING_CURRENT_REPORTER, value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRING_NONE : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: UI_STRING_CURRENT_PRICE, value: <CurrencyValue value={openOracleReportDetails.price} suffix={UI_TEMPLATE_TOKEN_PAIR_SUFFIX(token1Symbol, token2Symbol)} copyable={false} /> },
								])}
						<label className='field'>
							<span>{UI_STRING_TOKEN_TO_SWAP_OUT}</span>
							<EnumDropdown options={disputeTokenOptions} value={openOracleForm.disputeTokenToSwap} onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })} />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>{UI_TEMPLATE_NEW_TOKEN_AMOUNT_FIELD_LABEL(token1Symbol)}</span>
								<FormInput value={openOracleForm.disputeNewAmount1} onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>{UI_TEMPLATE_NEW_TOKEN_AMOUNT_FIELD_LABEL(token2Symbol)}</span>
								<FormInput value={openOracleForm.disputeNewAmount2} onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })} />
							</label>
						</div>
						{disputeSubmission?.expectedNewAmount1 === undefined ? undefined : <p className='detail'>{UI_TEMPLATE_NEW_AMOUNT_MUST_BE_EXACT_DETAIL(token1Symbol, disputeSubmission.expectedNewAmount1.toString())}</p>}
						<SectionBlock headingLevel={4} title={UI_TEMPLATE_TOKEN_APPROVAL_TITLE(token1Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRING_DISPUTING_THE_REPORT}
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={disputeToken1ApprovalGuardMessage}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={UI_TEMPLATE_APPROVING_TOKEN_PENDING_LABEL(token1Symbol)}
								requiredAmount={disputeSubmission?.token1ContributionAmount}
								resetKey={`dispute:token1:${token1Symbol}:${disputeSubmission?.token1ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token1Symbol}
								tokenUnits={disputeSubmission?.token1Decimals ?? 18}
							/>
						</SectionBlock>
						<SectionBlock headingLevel={4} title={UI_TEMPLATE_TOKEN_APPROVAL_TITLE(token2Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRING_DISPUTING_THE_REPORT}
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={disputeToken2ApprovalGuardMessage}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={UI_TEMPLATE_APPROVING_TOKEN_PENDING_LABEL(token2Symbol)}
								requiredAmount={disputeSubmission?.token2ContributionAmount}
								resetKey={`dispute:token2:${token2Symbol}:${disputeSubmission?.token2ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token2Symbol}
								tokenUnits={disputeSubmission?.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{!isMainnet || disputeSubmission?.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{disputeSubmission.blockMessage.message}</p>}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={UI_STRING_DISPUTE_AND_SWAP}
								pendingLabel={UI_STRING_SUBMITTING_DISPUTE}
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isMainnet || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
									reason: disputeActionDisabledReason,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'settle': {
			const settleDisabledMessage = (() => {
				if (openOracleForm.reportId.trim() === '') return UI_STRING_LOAD_A_REPORT_FIRST

				return settleAvailability.message
			})()
			const settleActionDisabledReason = (() => {
				if (!isConnected) return UI_STRING_CONNECT_A_WALLET_BEFORE_SETTLING_THE_REPORT
				if (!isMainnet) return undefined
				return settleDisabledMessage
			})()
			return (
				<SectionBlock headingLevel={4} title={UI_STRING_SETTLE_REPORT} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(UI_STRING_SETTLEMENT_SUMMARY, [
									{ label: UI_STRING_REPORT, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: UI_STRING_CURRENT_REPORTER, value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRING_NONE : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: UI_STRING_SETTLEMENT_TIMESTAMP, value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={UI_STRING_NOT_SETTLED} /> },
								])}
						<p className='detail'>{UI_STRING_SETTLEMENT_IS_CONFIRMATION_FIRST_REVIEW_THE_CURRENT_REPORT_STATE_AND_CONFIRM_ONLY_WHEN_THE_DISPUTE_WINDOW_IS_CLOSED}</p>
						<div className='actions'>
							<TransactionActionButton
								idleLabel={UI_STRING_SETTLE_REPORT}
								pendingLabel={UI_STRING_SETTLING_REPORT}
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
		case 'read-only':
			return (
				<SectionBlock headingLevel={4} title={UI_STRING_SETTLED_REPORT} variant='embedded'>
					<p className='detail'>{UI_STRING_THIS_REPORT_IS_SETTLED_NO_WRITE_ACTIONS_ARE_AVAILABLE}</p>
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
	isMainnet: boolean,
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
				label={UI_STRING_REPORT_ID}
				value={openOracleForm.reportId}
				onInput={reportId => onOpenOracleFormChange({ reportId })}
				action={
					<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
						{(() => {
							if (loadingOracleReport) return <LoadingText>{UI_STRING_LOADING_WITH_ELLIPSIS}</LoadingText>
							if (openOracleReportDetails === undefined) return UI_STRING_OPEN_REPORT

							return UI_STRING_REFRESH_REPORT
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
			<SectionBlock title={UI_STRING_REPORT_DETAILS}>
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
				eyebrow={UI_STRING_OPEN_ORACLE_REPORT_DETAILS}
				title={UI_TEMPLATE_REPORT_NUMBER_TITLE(openOracleReportDetails.reportId.toString())}
				items={[
					{ label: UI_STRING_STAGE, value: stage.label },
					{ label: UI_STRING_TOKEN_PAIR, value: UI_TEMPLATE_TOKEN_PAIR_SUFFIX(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
					{ label: UI_STRING_REPORTER, value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRING_NONE : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{
						label: UI_STRING_PRICE,
						value: <CurrencyValue value={openOracleReportDetails.price} suffix={UI_TEMPLATE_TOKEN_PAIR_SUFFIX(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
					},
				]}
			/>
			<LifecycleStageBanner stage={stage} />
			<SectionBlock title={UI_STRING_REPORT_ACTIONS} description={UI_STRING_OPEN_A_FOCUSED_ACTION_FLOW_FOR_THE_SELECTED_REPORT_WHEN_IT_IS_AVAILABLE}>
				<div className='action-readiness-grid'>
					{readinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<SectionBlock badge={<Badge tone={statusTone}>{status}</Badge>} title={UI_STRING_REPORT_DETAILS}>
				{reportControls}
				<MetricGrid variant='question'>
					{renderReportField(UI_STRING_REPORT_ID, openOracleReportDetails.reportId.toString())}
					{renderReportField(UI_STRING_ORACLE_ADDRESS, <AddressValue address={openOracleReportDetails.openOracleAddress} />)}
					{renderReportField(UI_STRING_CURRENT_REPORTER, openOracleReportDetails.currentReporter === zeroAddress ? UI_STRING_NONE_AWAITING_INITIAL_REPORT : <AddressValue address={openOracleReportDetails.currentReporter} />)}
					{renderReportField(UI_STRING_CURRENT_PRICE, <CurrencyValue value={openOracleReportDetails.price} suffix={UI_TEMPLATE_TOKEN_PAIR_SUFFIX(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
					{renderReportField(UI_STRING_SETTLEMENT_TIMESTAMP, <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={UI_STRING_NOT_SETTLED} />)}
				</MetricGrid>
			</SectionBlock>
			<div className='report-detail-stack'>
				<ReadOnlyDetailAccordion defaultOpen title={UI_STRING_IDENTITY}>
					{renderReportSection(UI_STRING_IDENTITY, [
						{
							label: UI_STRING_ORACLE_ADDRESS,
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
							label: UI_STRING_CURRENT_REPORTER,
							value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRING_NONE_AWAITING_INITIAL_REPORT : <AddressValue address={openOracleReportDetails.currentReporter} />,
						},
						{
							label: UI_STRING_INITIAL_REPORTER,
							value: openOracleReportDetails.initialReporter === zeroAddress ? UI_STRING_NONE : <AddressValue address={openOracleReportDetails.initialReporter} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRING_ECONOMICS}>
					{renderReportSection(UI_STRING_REPORT_AMOUNTS, [
						{
							label: UI_TEMPLATE_EXACT_TOKEN_REQUIRED_LABEL(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.exactToken1Report} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: UI_TEMPLATE_CURRENT_AMOUNT1_LABEL(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: UI_TEMPLATE_CURRENT_AMOUNT2_LABEL(openOracleReportDetails.token2Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} copyable={false} />,
						},
						{
							label: UI_STRING_PRICE,
							value: <CurrencyValue value={openOracleReportDetails.price} suffix={UI_TEMPLATE_TOKEN_PAIR_SUFFIX(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
						},
						{
							label: UI_STRING_FEE,
							value: <CurrencyValue value={openOracleReportDetails.fee} suffix={UI_STRING_ETH} copyable={false} />,
						},
						{
							label: UI_STRING_SETTLER_REWARD,
							value: <CurrencyValue value={openOracleReportDetails.settlerReward} suffix={UI_STRING_ETH} copyable={false} />,
						},
						{
							label: UI_STRING_ESCALATION_HALT,
							value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRING_STATUS}>
					{renderReportSection(UI_STRING_STATUS, [
						{
							label: UI_STRING_REPORT_TIMESTAMP,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.reportTimestamp} zeroText={UI_STRING_AWAITING_INITIAL_REPORT_OPEN_ORACLE_SECTION_AWAITING_INITIAL_REPORT_LABEL} />,
						},
						{
							label: UI_STRING_DISPUTE_OCCURRED,
							value: openOracleReportDetails.disputeOccurred ? UI_STRING_YES : UI_STRING_NO,
						},
						{
							label: UI_STRING_SETTLED,
							value: openOracleReportDetails.isDistributed ? UI_STRING_YES : UI_STRING_NO,
						},
						{
							label: UI_STRING_SETTLEMENT_TIMESTAMP,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={UI_STRING_NOT_SETTLED} />,
						},
						{
							label: UI_STRING_LAST_REPORT_OPPORTUNITY,
							value: openOracleReportDetails.lastReportOppoTime === 0n ? UI_STRING_NONE : `${openOracleReportDetails.lastReportOppoTime.toString()} ${openOracleReportDetails.timeType ? UI_STRING_PLURAL_SUFFIX : UI_STRING_BLOCKS_OPEN_ORACLE_SECTION_TIME_IN_BLOCKS_SUFFIX}`,
						},
						{
							label: UI_STRING_STATE_HASH,
							value: openOracleReportDetails.stateHash,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRING_SETTLEMENT}>
					{renderReportSection(UI_STRING_SETTLEMENT, [
						{
							label: UI_STRING_SETTLEMENT_TIME,
							value: `${openOracleReportDetails.settlementTime.toString()} ${openOracleReportDetails.timeType ? UI_STRING_PLURAL_SUFFIX : UI_STRING_BLOCKS_OPEN_ORACLE_SECTION_TIME_IN_BLOCKS_SUFFIX}`,
						},
						{
							label: UI_STRING_DISPUTE_DELAY,
							value: `${openOracleReportDetails.disputeDelay.toString()} ${openOracleReportDetails.timeType ? UI_STRING_PLURAL_SUFFIX : UI_STRING_BLOCKS_OPEN_ORACLE_SECTION_TIME_IN_BLOCKS_SUFFIX}`,
						},
						{
							label: UI_STRING_FEE_PERCENTAGE,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.feePercentage),
						},
						{
							label: UI_STRING_PROTOCOL_FEE,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.protocolFee),
						},
						{
							label: UI_STRING_MULTIPLIER,
							value: formatOpenOracleMultiplier(openOracleReportDetails.multiplier),
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRING_CALLBACK_EXTRA}>
					{renderReportSection(UI_STRING_CALLBACK_EXTRA, [
						{
							label: UI_STRING_CALLBACK_CONTRACT,
							value: openOracleReportDetails.callbackContract === zeroAddress ? UI_STRING_NONE : <AddressValue address={openOracleReportDetails.callbackContract} />,
						},
						{
							label: UI_STRING_CALLBACK_GAS_LIMIT,
							value: openOracleReportDetails.callbackGasLimit === 0 ? UI_STRING_NONE : openOracleReportDetails.callbackGasLimit.toString(),
						},
						{
							label: UI_STRING_PROTOCOL_FEE_RECIPIENT,
							value: openOracleReportDetails.protocolFeeRecipient === zeroAddress ? UI_STRING_NONE : <AddressValue address={openOracleReportDetails.protocolFeeRecipient} />,
						},
						{
							label: UI_STRING_TRACK_DISPUTES,
							value: openOracleReportDetails.trackDisputes ? UI_STRING_YES : UI_STRING_NO,
						},
						{
							label: UI_STRING_NUMBER_OF_REPORTS,
							value: openOracleReportDetails.numReports.toString(),
						},
					])}
				</ReadOnlyDetailAccordion>
			</div>

			<OperationModal isOpen={selectedReportModal === 'initial-report'} onClose={() => onSelectedReportModalChange(undefined)} title={UI_STRING_SUBMIT_INITIAL_REPORT} description={UI_STRING_REVIEW_PRICE_SOURCE_APPROVALS_AND_TOKEN_BALANCES_BEFORE_SUBMITTING_THE_INITIAL_REPORT}>
				{renderSelectedReportActionSection({
					actionMode: 'initial-report',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					isMainnet,
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

			<OperationModal isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title={UI_STRING_DISPUTE_AND_SWAP} description={UI_STRING_PROVIDE_THE_REPLACEMENT_SWAP_AMOUNTS_FOR_THE_SELECTED_REPORT}>
				{renderSelectedReportActionSection({
					actionMode: 'dispute',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					isMainnet,
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

			<OperationModal isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title={UI_STRING_SETTLE_REPORT} description={UI_STRING_CONFIRM_SETTLEMENT_ONCE_THE_SELECTED_REPORT_IS_READY}>
				{renderSelectedReportActionSection({
					actionMode: 'settle',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					isMainnet,
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
	const createValidationMessage = getOpenOracleCreateValidationMessage({ form: openOracleCreateForm })
	const createAvailabilityMessage = createGuardMessage ?? createValidationMessage
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
					setBrowseError(error instanceof Error ? error.message : UI_STRING_FAILED_TO_LOAD_OPEN_ORACLE_REPORTS)
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
						title={UI_STRING_BROWSE_REPORTS}
						description={UI_TEMPLATE_BROWSE_REPORTS_DESCRIPTION(BROWSE_PAGE_SIZE.toString())}
					>
						<ErrorNotice message={browseError} />
						<div className='filter-toolbar'>
							<label className='field'>
								<span>{UI_STRING_SEARCH_REPORTS}</span>
								<FormInput value={browseSearchText} onInput={event => setBrowseSearchText(event.currentTarget.value)} placeholder={UI_STRING_SEARCH_BY_REPORT_ID_TOKEN_SYMBOL_OR_TOKEN_ADDRESS} />
							</label>
							<label className='field'>
								<span>{UI_STRING_STATUS}</span>
								<select value={browseStatusFilter} onChange={event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
									<option value='all'>{UI_STRING_ALL_STATUSES}</option>
									<option value='Awaiting Initial Report'>{UI_STRING_AWAITING_INITIAL_REPORT}</option>
									<option value='Pending'>{UI_STRING_PENDING}</option>
									<option value='Disputed'>{UI_STRING_DISPUTED}</option>
									<option value='Settled'>{UI_STRING_SETTLED}</option>
								</select>
							</label>
						</div>
						{browsePage === undefined ? undefined : <p className='detail'>{UI_TEMPLATE_BROWSE_SHOWN_COUNT_SUMMARY(filteredBrowseReports.length.toString(), browsePage.reports.length.toString())}</p>}
						{loadingBrowse ? (
							<StateHint presentation={{ key: 'loading', badgeLabel: UI_STRING_LOADING, badgeTone: 'pending', detail: UI_STRING_REFRESHING_REPORT_SUMMARIES }} />
						) : (
							(() => {
								if (browsePage === undefined || browsePage.reports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: UI_STRING_NONE, badgeTone: 'muted', detail: UI_STRING_NO_OPEN_ORACLE_GAMES_FOUND }} />
								if (filteredBrowseReports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: UI_STRING_NO_MATCHES, badgeTone: 'muted', detail: UI_STRING_NO_REPORTS_MATCH_THE_CURRENT_SEARCH_AND_STATUS_FILTERS }} />

								return <div className='entity-card-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
							})()
						)}
					</SectionBlock>
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{openOracleResult?.action !== 'createReportInstance' ? undefined : (
						<SectionBlock title={UI_STRING_CREATE_SUCCESS} description={UI_STRING_THE_REPORT_INSTANCE_WAS_CREATED_SUCCESSFULLY}>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => onActiveViewChange('browse')}>
									{UI_STRING_RETURN_TO_BROWSE}
								</button>
								<button className='secondary' type='button' onClick={() => onActiveViewChange('create')}>
									{UI_STRING_CREATE_ANOTHER}
								</button>
							</div>
						</SectionBlock>
					)}
					<SectionBlock title={UI_STRING_OPEN_ORACLE_GAME} variant='plain' description={UI_STRING_DIRECT_OPEN_ORACLE_CREATION_FOR_PROTOCOL_TESTING_THIS_BYPASSES_POOL_MANAGED_ORACLE_MANAGER_STAGING_SO_CONFIRM_ADDRESSES_TOKEN_AMOUNTS_FEES_AND_TIMING_BEFORE_SUBMITTING}>
						<p className='notice warning'>{UI_STRING_USE_THIS_ONLY_WHEN_YOU_INTEND_TO_CREATE_A_STANDALONE_ORACLE_GAME_DIRECTLY_FROM_THE_CONNECTED_WALLET_POOL_MANAGED_ORACLE_REQUESTS_SHOULD_BE_STARTED_FROM_A_SELECTED_SECURITY_POOL}</p>
						<div className='form-grid'>
							<SectionBlock headingLevel={4} title={UI_STRING_TOKEN_PAIR} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRING_TOKEN1_ADDRESS}</span>
										<FormInput value={openOracleCreateForm.token1Address} onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} aria-label={UI_STRING_TOKEN1_ADDRESS} aria-describedby='open-oracle-token1-address-help' />
										<p id='open-oracle-token1-address-help' className='field-help'>
											{UI_STRING_BASE_TOKEN_FOR_THE_REPORTED_PAIR}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRING_TOKEN2_ADDRESS}</span>
										<FormInput value={openOracleCreateForm.token2Address} onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} aria-label={UI_STRING_TOKEN2_ADDRESS} aria-describedby='open-oracle-token2-address-help' />
										<p id='open-oracle-token2-address-help' className='field-help'>
											{UI_STRING_QUOTE_TOKEN_FOR_THE_REPORTED_PAIR}
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={UI_STRING_INITIAL_ECONOMICS} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRING_EXACT_TOKEN1_REPORT}</span>
										<FormInput value={openOracleCreateForm.exactToken1Report} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })} aria-label={UI_STRING_EXACT_TOKEN1_REPORT} aria-describedby='open-oracle-exact-token1-report-help' />
										<p id='open-oracle-exact-token1-report-help' className='field-help'>
											{UI_STRING_TOKEN1_AMOUNT_TO_REPORT_ENTERED_AS_A_DECIMAL_VALUE_FOR_THE_TOKEN1_ADDRESS}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRING_SETTLER_REWARD}</span>
										<FormInput value={openOracleCreateForm.settlerReward} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} aria-label={UI_STRING_SETTLER_REWARD} aria-describedby='open-oracle-settler-reward-help' />
										<p id='open-oracle-settler-reward-help' className='field-help'>
											{UI_STRING_ETH_PAID_TO_THE_ACCOUNT_THAT_SETTLES_THE_REPORT}
										</p>
									</label>
								</div>
								<label className='field'>
									<span>{UI_STRING_ETH_VALUE_TO_SEND}</span>
									<FormInput value={openOracleCreateForm.ethValue} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })} aria-label={UI_STRING_ETH_VALUE_TO_SEND} aria-describedby='open-oracle-eth-value-help' />
									<p id='open-oracle-eth-value-help' className='field-help'>
										{UI_STRING_ETH_SENT_WITH_CREATION_MUST_COVER_REQUIRED_FUNDING_AND_THE_SETTLER_REWARD}
									</p>
								</label>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRING_FEE_PERCENTAGE}</span>
										<FormInput value={openOracleCreateForm.feePercentage} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} aria-label={UI_STRING_FEE_PERCENTAGE} aria-describedby='open-oracle-fee-percentage-help' />
										<p id='open-oracle-fee-percentage-help' className='field-help'>
											{UI_STRING_FEE_CHARGED_DURING_DISPUTE_ECONOMICS_ENTERED_AS_A_PERCENTAGE}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRING_MULTIPLIER}</span>
										<FormInput value={openOracleCreateForm.multiplier} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} aria-label={UI_STRING_MULTIPLIER} aria-describedby='open-oracle-multiplier-help' />
										<p id='open-oracle-multiplier-help' className='field-help'>
											{UI_STRING_ESCALATION_MULTIPLIER_FOR_DISPUTE_ECONOMICS}
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={UI_STRING_TIMING} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRING_SETTLEMENT_TIME}</span>
										<FormInput value={openOracleCreateForm.settlementTime} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} aria-label={UI_STRING_SETTLEMENT_TIME} aria-describedby='open-oracle-settlement-time-help' />
										<p id='open-oracle-settlement-time-help' className='field-help'>
											{UI_STRING_DELAY_IN_SECONDS_AFTER_THE_INITIAL_REPORT_BEFORE_SETTLEMENT_CAN_BEGIN}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRING_ESCALATION_HALT}</span>
										<FormInput value={openOracleCreateForm.escalationHalt} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} aria-label={UI_STRING_ESCALATION_HALT} aria-describedby='open-oracle-escalation-halt-help' />
										<p id='open-oracle-escalation-halt-help' className='field-help'>
											{UI_STRING_TOKEN1_AMOUNT_WHERE_DISPUTE_ESCALATION_STOPS_ENTERED_AS_A_DECIMAL_VALUE_FOR_THE_TOKEN1_ADDRESS}
										</p>
									</label>
								</div>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRING_DISPUTE_DELAY}</span>
										<FormInput value={openOracleCreateForm.disputeDelay} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} aria-label={UI_STRING_DISPUTE_DELAY} aria-describedby='open-oracle-dispute-delay-help' />
										<p id='open-oracle-dispute-delay-help' className='field-help'>
											{UI_STRING_DELAY_IN_SECONDS_AFTER_THE_INITIAL_REPORT_BEFORE_DISPUTES_CAN_BEGIN}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRING_PROTOCOL_FEE}</span>
										<FormInput value={openOracleCreateForm.protocolFee} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} aria-label={UI_STRING_PROTOCOL_FEE} aria-describedby='open-oracle-protocol-fee-help' />
										<p id='open-oracle-protocol-fee-help' className='field-help'>
											{UI_STRING_PROTOCOL_FEE_CHARGED_DURING_DISPUTES_ENTERED_AS_A_PERCENTAGE}
										</p>
									</label>
								</div>
							</SectionBlock>

							<div className='actions'>
								<TransactionActionButton idleLabel={UI_STRING_CREATE_STANDALONE_ORACLE_GAME} pendingLabel={UI_STRING_CREATING} onClick={onCreateOpenOracleGame} pending={loadingOpenOracleCreate} availability={{ disabled: !isMainnet || createAvailabilityMessage !== undefined, reason: createAvailabilityMessage }} />
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
						isMainnet,
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
