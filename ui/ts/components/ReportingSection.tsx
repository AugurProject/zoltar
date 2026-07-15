import { useEffect, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from './CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { EscalationSide } from './EscalationSide.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { assertNever } from '../lib/assert.js'
import { pickFirstReason } from '../lib/actionAvailability.js'
import { formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import {
	calculateEstimatedEscalationReturn,
	ESCALATION_GAME_ACTIVATION_DELAY,
	getEscalationDepositClaimAmount,
	getEscalationPhase,
	getEscalationTimeRemaining,
	getLeadingEscalationOutcome,
	getReportingMaxProfitContribution,
	getReportingMinimumOutcomeChangeContribution,
	getRemainingSelectedOutcomeContributionCapacity,
	getSelectedOutcomeRewardWindowFillTimestamp,
	getReportingTimerPreview,
	isPoolQuestionFinalized,
	isReportingClosed,
	previewReportingContribution,
} from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingLockedUntilMessage, getReportingOutcomeLabel, hasReportingOpened } from '../lib/reporting.js'
import { deriveSecurityPoolReportingStage, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import {
	UI_STRING_1_OUTCOME,
	UI_STRING_2_LOCK_REP,
	UI_STRING_3_SETTLE,
	UI_STRING_ACTIVE,
	UI_STRING_AND_IF_NO_ONE_DISPUTES_AFTER_IT_THE_MARKET_WOULD_FINALIZE_IN,
	UI_STRING_AVAILABLE_UNLOCKED_VAULT_REP_FOR_REPORTING,
	UI_STRING_BASED_ON_THE_CURRENT_ESCALATION_STATE_THIS_ACTION_WOULD_LOCK,
	UI_STRING_CHECK_BACK_NO_LATER_THAN,
	UI_STRING_CHOOSE_DEPOSITS_TO_SETTLE,
	UI_STRING_CONNECTED_WALLET_HAS_NO_UNSETTLED_ESCALATION_DEPOSITS,
	UI_STRING_CONTINUE_IN_FORK_AND_MIGRATION_TO_MIGRATE_UNRESOLVED_ESCALATION_DEPOSITS_INTO_A_CHILD_UNIVERSE,
	UI_STRING_CONTRIBUTION_AMOUNT_REP,
	UI_STRING_CURRENT_CLAIM_TYPE,
	UI_STRING_ENTER_A_VALID_REPORT_AMOUNT_TO_PREVIEW_PROFIT,
	UI_STRING_ENTRY_DEPTH,
	UI_STRING_ESCALATION_DEPOSITS_CANNOT_BE_SETTLED_UNTIL_THE_QUESTION_IS_FINALIZED,
	UI_STRING_ESCALATION_DEPOSITS_REMAIN_LOCKED_AFTER_NON_DECISION_TRIGGER_ZOLTAR_FORK_HERE_IF_THIS_POOL_SHOULD_FORK_THE_UNIVERSE,
	UI_STRING_ESCALATION_DEPOSITS_REMAIN_LOCKED_AFTER_NON_DECISION_ZOLTAR_FORK_HAS_ALREADY_BEEN_TRIGGERED_FOR_THIS_POOL_SO_CONTINUE_IN_FORK_AND_MIGRATION,
	UI_STRING_ESCALATION_ENDED_BY_TIMEOUT_THE_WINNER_IS_COMPUTED,
	UI_STRING_ESCALATION_HAS_ENDED_REFRESH_REPORTING_TO_VIEW_THE_FINALIZED_OUTCOME_BEFORE_SETTLING_DEPOSITS,
	UI_STRING_ESCALATION_IS_LIVE_REVIEW_THE_BOND_SIDE_BALANCES_AND_TIME_REMAINING_BEFORE_CONTRIBUTING_OR_WITHDRAWING,
	UI_STRING_ESCALATION_METRICS,
	UI_STRING_ESCALATION_REACHED_NON_DECISION_AND_ZOLTAR_FORK_HAS_ALREADY_BEEN_TRIGGERED_FOR_THIS_POOL_CONTINUE_IN_FORK_AND_MIGRATION,
	UI_STRING_ESCALATION_REACHED_NON_DECISION_TRIGGER_ZOLTAR_FORK_HERE_IF_THIS_POOL_SHOULD_FORK_THE_UNIVERSE,
	UI_STRING_ESCALATION_STARTED,
	UI_STRING_FORK_TRIGGERED,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_IF,
	UI_STRING_IF_NO_ONE_DISPUTES_AFTER_THIS_REPORT_THE_MARKET_WOULD_FINALIZE_IN,
	UI_STRING_INITIALLY_DEPOSITED,
	UI_STRING_INSTEAD_OF_THE_FULL_ENTERED_AMOUNT,
	UI_STRING_IS_FILLED,
	UI_STRING_IS_STILL_LEADING_IF_LATER_DISPUTES_KEEP_ESCALATION_OPEN,
	UI_STRING_IS_THE_LEADING_OUTCOME_BEFORE_FINALIZATION,
	UI_STRING_IS_THE_LEADING_OUTCOME_BEFORE_THE_REMAINING_REWARD_ELIGIBLE_REP_ON,
	UI_STRING_LEAD_HOLDING_CAPITAL,
	UI_STRING_LOAD_REPORTING_DETAILS_BEFORE_USING_PRESETS,
	UI_STRING_LOAD_REPORTING_DETAILS_TO_VIEW_THE_ESCALATION_STATE_FOR_THIS_POOL,
	UI_STRING_LOADING_AVAILABLE_VAULT_REP,
	UI_STRING_LOADING_ESCALATION,
	UI_STRING_LOADING_ESCALATION_DEPOSITS,
	UI_STRING_LOADING_ESCALATION_DEPOSITS_REPORTING_SECTION_LOADING_ESCALATION_DEPOSITS_DETAIL,
	UI_STRING_LOSING_DEPOSIT_SETTLEMENT,
	UI_STRING_MAX,
	UI_STRING_MAX_PROFIT,
	UI_STRING_MAX_PROFIT_BECOMES_AVAILABLE_AFTER_THE_ESCALATION_GAME_STARTS,
	UI_STRING_MAX_PROFIT_PRESET_UNAVAILABLE_BECAUSE_THE_REWARD_WINDOW_IS_ALREADY_FILLED_ON_THE_SELECTED_SIDE,
	UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER,
	UI_STRING_MIN_TO_TAKE_THE_LEAD,
	UI_STRING_NO_REMAINING_CONTRIBUTION_CAPACITY_IS_AVAILABLE_ON_THE_SELECTED_SIDE,
	UI_STRING_NO_UNLOCKED_VAULT_REP_AVAILABLE_FOR_REPORTING,
	UI_STRING_NON_DECISION_THRESHOLD,
	UI_STRING_OF_PROFIT,
	UI_STRING_OPEN_FORK_AND_MIGRATION,
	UI_STRING_PENDING_FINALIZATION,
	UI_STRING_REFRESH_REPORTING,
	UI_STRING_REMAINING_SELECTED_SIDE_CAPACITY_IS_BELOW_THE_MINIMUM_REPORT_BOND,
	UI_STRING_REP,
	UI_STRING_REPORT_ON_SELECTED_SIDE,
	UI_STRING_REPORT_OUTCOME,
	UI_STRING_REPORT_OUTCOME_REPORTING_SECTION_REPORT_OUTCOME_ARIA_LABEL,
	UI_STRING_REPORTING_IS_OPEN,
	UI_STRING_REPORTING_IS_OPEN_SELECT_AN_OUTCOME_SIDE_BELOW_TO_ENABLE_REPORTING,
	UI_STRING_REPORTING_NOT_ENABLED,
	UI_STRING_REPORTING_OPEN,
	UI_STRING_REPORTING_SECTION_REPORTING_PROJECTION_NOT_STARTED_SIMPLE_SUFFIX,
	UI_STRING_REPORTING_WORKFLOW,
	UI_STRING_RESOLVED,
	UI_STRING_SECURITY_POOL_ADDRESS,
	UI_STRING_SELECT_AN_OUTCOME_SIDE_ABOVE_TO_ENABLE_REPORTING,
	UI_STRING_SELECT_AN_OUTCOME_SIDE_BEFORE_USING_PRESETS,
	UI_STRING_SELECT_AT_LEAST_ONE_DEPOSIT_TO_SETTLE_OR_USE_SETTLE_ALL_FOR_THIS_SIDE,
	UI_STRING_SELECT_THE_ANSWER_YOU_BELIEVE_SHOULD_FINALIZE_LOCK,
	UI_STRING_SELECTED_SIDE,
	UI_STRING_SELECTED_SIDE_ALREADY_LEADS,
	UI_STRING_SELECTED_SIDE_IS_UNAVAILABLE,
	UI_STRING_SETTLE_ESCALATION_DEPOSITS,
	UI_STRING_START_BOND,
	UI_STRING_SUBMITTING_REPORT,
	UI_STRING_THE_MIGRATION_WINDOW_FOR_THESE_UNRESOLVED_ESCALATION_DEPOSITS_HAS_CLOSED,
	UI_STRING_THESE_ESCALATION_DEPOSITS_MUST_MIGRATE_IN_FORK_AND_MIGRATION,
	UI_STRING_THIS_CONTRIBUTION_WOULD_END_THE_ESCALATION_AND_FINALIZE_THE_MARKET_IMMEDIATELY,
	UI_STRING_THIS_CONTRIBUTION_WOULD_EXTEND_THE_TIMER_BY,
	UI_STRING_THIS_CONTRIBUTION_WOULD_NOT_EXTEND_THE_TIMER_AND_IF_NO_ONE_DISPUTES_AFTER_IT_THE_MARKET_WOULD_FINALIZE_IN,
	UI_STRING_THIS_IS_THE_REP_YOU_ARE_WILLING_TO_LOCK_ON_THE_SELECTED_SIDE_LARGER_AMOUNTS_CAN_CHANGE_THE_PROPOSED_OUTCOME_OR_EXTEND_THE_ESCALATION_TIMER,
	UI_STRING_THIS_POOL_ALSO_HAS_FORK_CARRIED_ESCALATION_POSITIONS_SETTLE_THOSE_IN_FORK_AND_MIGRATION,
	UI_STRING_THIS_POOL_IS_ALREADY_FINALIZED,
	UI_STRING_TIME_LEFT,
	UI_STRING_TIMED_OUT,
	UI_STRING_TO_CONFIRM,
	UI_STRING_TOTAL_SIDE_STAKE,
	UI_STRING_TRIGGER_ZOLTAR_FORK,
	UI_STRING_TRIGGERING_ZOLTAR_FORK,
	UI_STRING_WINNING_PAYOUT,
	UI_STRING_WINS_AND_NO_ONE_ELSE_CONTRIBUTES_AFTERWARD_THIS_AMOUNT_PROJECTS_ROUGHLY,
	UI_STRING_WORTH_AFTER_FINALIZATION_PENDING_FINALIZATION,
	UI_STRING_WORTH_NOW,
	UI_STRING_YOUR_SIDE_STAKE,
	UI_TEMPLATE_REPORT_SELECTED_OUTCOME_BUTTON_LABEL,
	UI_TEMPLATE_REPORTING_LATEST_OUTCOME_REMINDER_IMMEDIATE,
	UI_TEMPLATE_REPORTING_LATEST_OUTCOME_REMINDER_LATER,
	UI_TEMPLATE_REPORTING_RESOLVED_DETAIL_LABEL,
	UI_TEMPLATE_SETTLE_ALL_DEPOSITS_LABEL,
	UI_TEMPLATE_SETTLE_SELECTED_DEPOSITS_LABEL,
	UI_TEMPLATE_SETTLING_DEPOSITS_PENDING_LABEL,
} from '../lib/uiStrings.js'
import type { LifecycleStagePresentation, ReportingSectionProps } from '../types/components.js'
import type { EscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'
type ReportingStatus = 'active' | 'missing' | 'not-started'
type EscalationSideDisplay = {
	balance: bigint | undefined
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}
const MAX_PROFIT_NOT_STARTED_REASON = UI_STRING_MAX_PROFIT_BECOMES_AVAILABLE_AFTER_THE_ESCALATION_GAME_STARTS
const LOAD_REPORTING_PRESETS_REASON = UI_STRING_LOAD_REPORTING_DETAILS_BEFORE_USING_PRESETS
const SELECT_OUTCOME_PRESET_REASON = UI_STRING_SELECT_AN_OUTCOME_SIDE_BEFORE_USING_PRESETS
const SELECTED_SIDE_ALREADY_LEADS_REASON = UI_STRING_SELECTED_SIDE_ALREADY_LEADS
const MAX_PROFIT_WINDOW_FILLED_REASON = UI_STRING_MAX_PROFIT_PRESET_UNAVAILABLE_BECAUSE_THE_REWARD_WINDOW_IS_ALREADY_FILLED_ON_THE_SELECTED_SIDE
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = UI_STRING_SELECT_AN_OUTCOME_SIDE_ABOVE_TO_ENABLE_REPORTING
const NO_SELECTED_SIDE_CAPACITY_REASON = UI_STRING_NO_REMAINING_CONTRIBUTION_CAPACITY_IS_AVAILABLE_ON_THE_SELECTED_SIDE
const BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON = UI_STRING_REMAINING_SELECTED_SIDE_CAPACITY_IS_BELOW_THE_MINIMUM_REPORT_BOND
const FORK_TRIGGERED_REPORT_REASON = UI_STRING_ESCALATION_REACHED_NON_DECISION_TRIGGER_ZOLTAR_FORK_HERE_IF_THIS_POOL_SHOULD_FORK_THE_UNIVERSE
const FORK_TRIGGERED_SETTLEMENT_REASON = UI_STRING_ESCALATION_DEPOSITS_REMAIN_LOCKED_AFTER_NON_DECISION_TRIGGER_ZOLTAR_FORK_HERE_IF_THIS_POOL_SHOULD_FORK_THE_UNIVERSE
const FORK_ALREADY_TRIGGERED_REPORT_REASON = UI_STRING_ESCALATION_REACHED_NON_DECISION_AND_ZOLTAR_FORK_HAS_ALREADY_BEEN_TRIGGERED_FOR_THIS_POOL_CONTINUE_IN_FORK_AND_MIGRATION
const FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON = UI_STRING_ESCALATION_DEPOSITS_REMAIN_LOCKED_AFTER_NON_DECISION_ZOLTAR_FORK_HAS_ALREADY_BEEN_TRIGGERED_FOR_THIS_POOL_SO_CONTINUE_IN_FORK_AND_MIGRATION
function getOutcomeSides(reportingDetails: ReportingDetails | undefined) {
	if (reportingDetails?.status === 'active')
		return reportingDetails.sides.map<EscalationSideDisplay>(side => ({
			balance: side.balance,
			key: side.key,
			label: side.label,
			userDeposits: side.userDeposits,
			userStake: side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n),
		}))
	if (reportingDetails?.status === 'not-started')
		return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
			balance: 0n,
			key: option.value,
			label: option.label,
			userDeposits: [],
			userStake: 0n,
		}))
	return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
		balance: undefined,
		key: option.value,
		label: option.label,
		userDeposits: undefined,
		userStake: undefined,
	}))
}
function isHiddenPresetReason(reason: string | undefined) {
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === MAX_PROFIT_NOT_STARTED_REASON || reason === SELECT_OUTCOME_PRESET_REASON || reason === SELECTED_SIDE_ALREADY_LEADS_REASON || reason === MAX_PROFIT_WINDOW_FILLED_REASON
}
function getResolvedReportingOutcomeLabel(reportingDetails: ReportingDetails) {
	return reportingDetails.questionOutcome === 'none' ? UI_STRING_PENDING_FINALIZATION : getReportingOutcomeLabel(reportingDetails.questionOutcome)
}
function getWithdrawDepositClaimLabel(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	return details.questionOutcome === selectedOutcome ? UI_STRING_WINNING_PAYOUT : UI_STRING_LOSING_DEPOSIT_SETTLEMENT
}

function getReportingStagePresentation({
	effectiveCurrentTimestamp,
	forkAlreadyTriggered,
	marketDetails,
	reportingDetails,
}: {
	effectiveCurrentTimestamp: bigint | undefined
	forkAlreadyTriggered: boolean
	marketDetails: ReportingDetails['marketDetails'] | ReportingSectionProps['previewMarketDetails']
	reportingDetails: ReportingDetails | undefined
}): LifecycleStagePresentation | undefined {
	if (effectiveCurrentTimestamp === undefined || marketDetails === undefined) return undefined
	if (!hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp))
		return {
			availableActions: [],
			blockedActions: [],
			detail: getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp),
			key: 'reporting-not-enabled',
			label: UI_STRING_REPORTING_NOT_ENABLED,
			tone: 'warning',
		}
	if (reportingDetails === undefined)
		return {
			availableActions: [],
			blockedActions: [],
			detail: UI_STRING_LOAD_REPORTING_DETAILS_TO_VIEW_THE_ESCALATION_STATE_FOR_THIS_POOL,
			key: 'reporting-open',
			label: UI_STRING_REPORTING_OPEN,
			tone: 'default',
		}
	if (isPoolQuestionFinalized(reportingDetails))
		return {
			availableActions: [],
			blockedActions: [],
			detail: UI_TEMPLATE_REPORTING_RESOLVED_DETAIL_LABEL(getResolvedReportingOutcomeLabel(reportingDetails)),
			key: 'escalation-resolved',
			label: UI_STRING_RESOLVED,
			tone: 'success',
		}
	if (reportingDetails.status === 'not-started') return undefined
	const escalationPhase = getEscalationPhase(reportingDetails)
	switch (escalationPhase) {
		case 'Pending Start':
			return undefined
		case 'Active':
			return {
				availableActions: [],
				blockedActions: [],
				detail: UI_STRING_ESCALATION_IS_LIVE_REVIEW_THE_BOND_SIDE_BALANCES_AND_TIME_REMAINING_BEFORE_CONTRIBUTING_OR_WITHDRAWING,
				key: 'escalation-active',
				label: UI_STRING_ACTIVE,
				tone: 'default',
			}
		case 'Fork Triggered':
			return {
				availableActions: [],
				blockedActions: [],
				detail: forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON,
				key: 'escalation-fork-triggered',
				label: UI_STRING_FORK_TRIGGERED,
				tone: 'default',
			}
		case 'Timed Out':
			return {
				availableActions: [],
				blockedActions: [],
				detail: UI_STRING_ESCALATION_ENDED_BY_TIMEOUT_THE_WINNER_IS_COMPUTED,
				key: 'escalation-timed-out',
				label: UI_STRING_TIMED_OUT,
				tone: 'default',
			}
		case 'Resolved':
			return {
				availableActions: [],
				blockedActions: [],
				detail: UI_TEMPLATE_REPORTING_RESOLVED_DETAIL_LABEL(getResolvedReportingOutcomeLabel(reportingDetails)),
				key: 'escalation-resolved',
				label: UI_STRING_RESOLVED,
				tone: 'success',
			}
		default:
			return assertNever(escalationPhase)
	}
}
function getEscalationGameStartTimestamp(activationTime: bigint | undefined) {
	if (activationTime === undefined) return undefined
	return activationTime > ESCALATION_GAME_ACTIVATION_DELAY ? activationTime - ESCALATION_GAME_ACTIVATION_DELAY : 0n
}
function getLatestOutcomeReminder({ currentTimestamp, projectedFinalizationTimestamp, rewardWindowFillTimestamp, selectedOutcomeLabel }: { currentTimestamp: bigint | undefined; projectedFinalizationTimestamp: bigint | undefined; rewardWindowFillTimestamp: bigint | undefined; selectedOutcomeLabel: string }) {
	if (projectedFinalizationTimestamp !== undefined && currentTimestamp !== undefined && projectedFinalizationTimestamp <= currentTimestamp) return <>{UI_TEMPLATE_REPORTING_LATEST_OUTCOME_REMINDER_IMMEDIATE(selectedOutcomeLabel)}</>
	if (rewardWindowFillTimestamp !== undefined && currentTimestamp !== undefined && rewardWindowFillTimestamp > currentTimestamp)
		return (
			<>
				{UI_STRING_CHECK_BACK_NO_LATER_THAN}
				<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={rewardWindowFillTimestamp} />
				{UI_STRING_TO_CONFIRM}
				{selectedOutcomeLabel}
				{UI_STRING_IS_THE_LEADING_OUTCOME_BEFORE_THE_REMAINING_REWARD_ELIGIBLE_REP_ON}
				{selectedOutcomeLabel}
				{UI_STRING_IS_FILLED}
			</>
		)
	if (projectedFinalizationTimestamp !== undefined)
		return (
			<>
				{UI_STRING_CHECK_BACK_NO_LATER_THAN}
				<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={projectedFinalizationTimestamp} />
				{UI_STRING_TO_CONFIRM}
				{selectedOutcomeLabel}
				{UI_STRING_IS_THE_LEADING_OUTCOME_BEFORE_FINALIZATION}
			</>
		)
	return <>{UI_TEMPLATE_REPORTING_LATEST_OUTCOME_REMINDER_LATER(selectedOutcomeLabel)}</>
}
function getEffectiveReportingDetails(reportingDetails: ReportingDetails | undefined, currentTimestamp: bigint | undefined) {
	if (reportingDetails === undefined || currentTimestamp === undefined || reportingDetails.currentTime === currentTimestamp) return reportingDetails
	return {
		...reportingDetails,
		currentTime: currentTimestamp,
	}
}
export function ReportingSection({
	accountState,
	currentTimestamp,
	embedInCard = false,
	forkAlreadyTriggered = false,
	loadingReportingDetails,
	lockedReason,
	onLoadReporting,
	onOpenForkWorkflow,
	onTriggerZoltarFork,
	onReportOutcome,
	onReportingFormChange,
	onWithdrawEscalation,
	previewMarketDetails,
	reportingActiveAction,
	reportingDetails,
	reportingError,
	reportingForm,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	mode = 'full-reporting',
	triggerZoltarForkAvailability,
	triggerZoltarForkPending = false,
}: ReportingSectionProps) {
	const lastTimedOutRefreshBoundaryKey = useRef<string | undefined>(undefined)
	const [pendingWithdrawOutcome, setPendingWithdrawOutcome] = useState<ReportingOutcomeKey | undefined>(undefined)
	const isMainnet = isMainnetChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime
	const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp)
	const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined
	const escalationPhase = activeReportingDetails === undefined ? undefined : getEscalationPhase(activeReportingDetails)
	const escalationGameStartTimestamp = getEscalationGameStartTimestamp(activeReportingDetails?.activationTime)
	const reportingStatus: ReportingStatus = effectiveReportingDetails === undefined ? 'missing' : effectiveReportingDetails.status
	const marketDetails = effectiveReportingDetails?.marketDetails ?? previewMarketDetails
	const showFullReporting = mode === 'full-reporting'
	const showWithdrawOnly = mode === 'withdraw-only'
	const showSettlementSection = showFullReporting || showWithdrawOnly
	const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp)
	const preOpenLockedReason = lockedReason ?? (reportingReady === false && marketDetails !== undefined && effectiveCurrentTimestamp !== undefined ? getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp) : undefined)
	const reportingStageKey = deriveSecurityPoolReportingStage({
		reportingDetails: effectiveReportingDetails,
		reportingReady,
	})
	const reportingState = evaluateSecurityPoolState({
		reportingStage: reportingStageKey,
		universeHasForked: false,
	})
	const reportOutcomeEnabled = reportingState.actions.reportOutcome.enabled
	const withdrawEscalationEnabled = reportingState.actions.withdrawEscalation.enabled
	let reportLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		reportLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON
	} else if (reportingStageKey === 'timedOut') {
		reportLifecycleReason = UI_STRING_ESCALATION_HAS_ENDED_REFRESH_REPORTING_TO_VIEW_THE_FINALIZED_OUTCOME_BEFORE_SETTLING_DEPOSITS
	} else if (reportingStageKey === 'resolved') {
		reportLifecycleReason = UI_STRING_THIS_POOL_IS_ALREADY_FINALIZED
	}
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		settlementLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON
	} else if (activeReportingDetails?.settlementState === 'migration-required') {
		settlementLifecycleReason = forkAlreadyTriggered ? UI_STRING_CONTINUE_IN_FORK_AND_MIGRATION_TO_MIGRATE_UNRESOLVED_ESCALATION_DEPOSITS_INTO_A_CHILD_UNIVERSE : UI_STRING_THESE_ESCALATION_DEPOSITS_MUST_MIGRATE_IN_FORK_AND_MIGRATION
	} else if (activeReportingDetails?.settlementState === 'migration-expired') {
		settlementLifecycleReason = UI_STRING_THE_MIGRATION_WINDOW_FOR_THESE_UNRESOLVED_ESCALATION_DEPOSITS_HAS_CLOSED
	} else if (reportingStageKey === 'activeLocked') {
		settlementLifecycleReason = UI_STRING_ESCALATION_DEPOSITS_CANNOT_BE_SETTLED_UNTIL_THE_QUESTION_IS_FINALIZED
	}
	const withdrawControlsLockedReason = showSettlementSection && loadingReportingDetails ? UI_STRING_LOADING_ESCALATION_DEPOSITS : pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
	const withdrawControlsLocked = !withdrawEscalationEnabled || withdrawControlsLockedReason !== undefined
	const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount)
	const selectedOutcome = reportingForm.selectedOutcome
	const selectedWithdrawDepositIndexesByOutcome = reportingForm.selectedWithdrawDepositIndexesByOutcome
	const withdrawableSides = activeReportingDetails?.sides.filter(side => side.userDeposits.length > 0) ?? []
	let displayBindingCapital: bigint | undefined
	if (effectiveReportingDetails !== undefined) {
		displayBindingCapital = effectiveReportingDetails.status === 'not-started' ? 0n : effectiveReportingDetails.bindingCapital
	}
	const outcomeSides = getOutcomeSides(effectiveReportingDetails)
	const chartScaleMax = outcomeSides.reduce(
		(maxBalance, side) => {
			if (side.balance === undefined || side.balance <= maxBalance) return maxBalance
			return side.balance
		},
		displayBindingCapital !== undefined && displayBindingCapital > 1n ? displayBindingCapital : 1n,
	)
	const leadingOutcome = activeReportingDetails === undefined ? undefined : getLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const selectedEstimate = activeReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : calculateEstimatedEscalationReturn(activeReportingDetails, selectedOutcome, selectedAmount)
	const timerPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : getReportingTimerPreview(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const selectedOutcomeLabel = selectedOutcome === undefined ? UI_STRING_SELECTED_SIDE : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
	let projectedFinalizationTimestamp: bigint | undefined
	if (timerPreview !== undefined && effectiveCurrentTimestamp !== undefined) {
		if (timerPreview.kind === 'not-started') {
			projectedFinalizationTimestamp = effectiveCurrentTimestamp + timerPreview.timeUntilEnd
		} else if (timerPreview.actualState === 'ends-immediately') {
			projectedFinalizationTimestamp = effectiveCurrentTimestamp
		} else if (activeReportingDetails !== undefined) {
			projectedFinalizationTimestamp = effectiveCurrentTimestamp + getEscalationTimeRemaining(activeReportingDetails) + (timerPreview.timerIncrease ?? 0n)
		}
	}
	const rewardWindowFillTimestamp = activeReportingDetails === undefined || selectedOutcome === undefined || actualReportDepositAmount === undefined ? undefined : getSelectedOutcomeRewardWindowFillTimestamp(activeReportingDetails, selectedOutcome, actualReportDepositAmount)
	const getProjectedReportingPreview = () => {
		if (activeReportingDetails !== undefined && isReportingClosed(activeReportingDetails)) return undefined
		const finalizationReminder = getLatestOutcomeReminder({
			currentTimestamp: effectiveCurrentTimestamp,
			projectedFinalizationTimestamp,
			rewardWindowFillTimestamp,
			selectedOutcomeLabel,
		})
		if (timerPreview === undefined) {
			if (selectedEstimate === undefined) return undefined
			return (
				<>
					{UI_STRING_IF}
					{selectedOutcomeLabel}
					{UI_STRING_WINS_AND_NO_ONE_ELSE_CONTRIBUTES_AFTERWARD_THIS_AMOUNT_PROJECTS_ROUGHLY}
					<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRING_REP} />
					{UI_STRING_OF_PROFIT}
					{finalizationReminder}
				</>
			)
		}
		if (timerPreview.kind === 'not-started') {
			if (timerPreview.hypotheticalDuration > 0n)
				return (
					<>
						{UI_STRING_IF_NO_ONE_DISPUTES_AFTER_THIS_REPORT_THE_MARKET_WOULD_FINALIZE_IN}
						{formatDuration(timerPreview.timeUntilStart)}
						{UI_STRING_REPORTING_SECTION_REPORTING_PROJECTION_NOT_STARTED_SIMPLE_SUFFIX}
						{UI_STRING_CHECK_BACK_NO_LATER_THAN}
						<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={projectedFinalizationTimestamp} />
						{UI_STRING_TO_CONFIRM}
						{selectedOutcomeLabel}
						{UI_STRING_IS_STILL_LEADING_IF_LATER_DISPUTES_KEEP_ESCALATION_OPEN}
					</>
				)
			return (
				<>
					{UI_STRING_IF_NO_ONE_DISPUTES_AFTER_THIS_REPORT_THE_MARKET_WOULD_FINALIZE_IN}
					{formatDuration(timerPreview.timeUntilStart)}
					{UI_STRING_REPORTING_SECTION_REPORTING_PROJECTION_NOT_STARTED_SIMPLE_SUFFIX}
					{finalizationReminder}
				</>
			)
		}
		if (selectedEstimate === undefined || activeReportingDetails === undefined) return undefined
		if (timerPreview.actualState === 'ends-immediately')
			return (
				<>
					{UI_STRING_IF}
					{selectedOutcomeLabel}
					{UI_STRING_WINS_AND_NO_ONE_ELSE_CONTRIBUTES_AFTERWARD_THIS_AMOUNT_PROJECTS_ROUGHLY}
					<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRING_REP} />
					{UI_STRING_OF_PROFIT}
					{UI_STRING_THIS_CONTRIBUTION_WOULD_END_THE_ESCALATION_AND_FINALIZE_THE_MARKET_IMMEDIATELY}
					{finalizationReminder}
				</>
			)
		const projectedFinalizationDuration = formatDuration(getEscalationTimeRemaining(activeReportingDetails) + (timerPreview.timerIncrease ?? 0n))
		if (timerPreview.actualState === 'extends')
			return (
				<>
					{UI_STRING_IF}
					{selectedOutcomeLabel}
					{UI_STRING_WINS_AND_NO_ONE_ELSE_CONTRIBUTES_AFTERWARD_THIS_AMOUNT_PROJECTS_ROUGHLY}
					<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRING_REP} />
					{UI_STRING_OF_PROFIT}
					{UI_STRING_THIS_CONTRIBUTION_WOULD_EXTEND_THE_TIMER_BY}
					{formatDuration(timerPreview.timerIncrease ?? 0n)}
					{UI_STRING_AND_IF_NO_ONE_DISPUTES_AFTER_IT_THE_MARKET_WOULD_FINALIZE_IN}
					{projectedFinalizationDuration}
					{UI_STRING_REPORTING_SECTION_REPORTING_PROJECTION_NOT_STARTED_SIMPLE_SUFFIX}
					{finalizationReminder}
				</>
			)
		return (
			<>
				{UI_STRING_IF}
				{selectedOutcomeLabel}
				{UI_STRING_WINS_AND_NO_ONE_ELSE_CONTRIBUTES_AFTERWARD_THIS_AMOUNT_PROJECTS_ROUGHLY}
				<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRING_REP} />
				{UI_STRING_OF_PROFIT}
				{UI_STRING_THIS_CONTRIBUTION_WOULD_NOT_EXTEND_THE_TIMER_AND_IF_NO_ONE_DISPUTES_AFTER_IT_THE_MARKET_WOULD_FINALIZE_IN}
				{projectedFinalizationDuration}
				{UI_STRING_REPORTING_SECTION_REPORTING_PROJECTION_NOT_STARTED_SIMPLE_SUFFIX}
				{finalizationReminder}
			</>
		)
	}
	const projectedReportingPreview = getProjectedReportingPreview()
	const reportButtonLabel = selectedOutcome === undefined ? UI_STRING_REPORT_ON_SELECTED_SIDE : UI_TEMPLATE_REPORT_SELECTED_OUTCOME_BUTTON_LABEL(selectedOutcomeLabel)
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const maxProfitContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = (() => {
		if (selectedOutcome === undefined) return { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON }
		if (effectiveReportingDetails === undefined) return { amount: undefined, reason: LOAD_REPORTING_PRESETS_REASON }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep === undefined) return { amount: undefined, reason: UI_STRING_LOADING_AVAILABLE_VAULT_REP }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep <= 0n) return { amount: undefined, reason: UI_STRING_NO_UNLOCKED_VAULT_REP_AVAILABLE_FOR_REPORTING }
		if (remainingSelectedOutcomeCapacity !== undefined && remainingSelectedOutcomeCapacity <= 0n) return { amount: undefined, reason: NO_SELECTED_SIDE_CAPACITY_REASON }
		if (effectiveReportingDetails.status === 'not-started') {
			const cappedAmount = remainingSelectedOutcomeCapacity === undefined || effectiveReportingDetails.viewerVaultAvailableEscalationRep < remainingSelectedOutcomeCapacity ? effectiveReportingDetails.viewerVaultAvailableEscalationRep : remainingSelectedOutcomeCapacity
			if (cappedAmount < effectiveReportingDetails.startBond) return { amount: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON }
			return {
				amount: cappedAmount,
				reason: undefined,
			}
		}
		const selectedSide = effectiveReportingDetails.sides.find(side => side.key === selectedOutcome)
		if (selectedSide === undefined) return { amount: undefined, reason: UI_STRING_SELECTED_SIDE_IS_UNAVAILABLE }
		const maxContributionPreview = previewReportingContribution(effectiveReportingDetails, selectedOutcome, effectiveReportingDetails.nonDecisionThreshold - selectedSide.balance)
		if (maxContributionPreview.actualDepositAmount === undefined) return { amount: undefined, reason: maxContributionPreview.reason }
		let cappedAmount = maxContributionPreview.actualDepositAmount
		if (cappedAmount > effectiveReportingDetails.viewerVaultAvailableEscalationRep) cappedAmount = effectiveReportingDetails.viewerVaultAvailableEscalationRep
		if (remainingSelectedOutcomeCapacity !== undefined && cappedAmount > remainingSelectedOutcomeCapacity) cappedAmount = remainingSelectedOutcomeCapacity
		if (cappedAmount < effectiveReportingDetails.startBond) return { amount: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON }
		return {
			amount: cappedAmount,
			reason: undefined,
		}
	})()
	const presetReasons = reportControlsLocked ? [] : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].filter((reason, index, reasons): reason is string => reason !== undefined && !isHiddenPresetReason(reason) && reasons.indexOf(reason) === index)
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? UI_STRING_ENTER_A_VALID_REPORT_AMOUNT_TO_PREVIEW_PROFIT : undefined
	const reportGuardMessage =
		reportControlsLockedReason ??
		getReportingReportGuardMessage({
			actualDepositAmount: actualReportDepositAmount,
			accountAddress: accountState.address,
			contributionPreviewReason: reportContributionPreview?.reason,
			isMainnet,
			remainingSelectedOutcomeCapacity,
			reportAmount: reportingForm.reportAmount,
			reportingStatus,
			selectedOutcome,
			selectedAmount,
			viewerVaultAvailableEscalationRep: effectiveReportingDetails?.viewerVaultAvailableEscalationRep,
			viewerVaultExists: effectiveReportingDetails?.viewerVaultExists ?? false,
		})
	const withdrawGuardMessage =
		withdrawControlsLockedReason ??
		getReportingWithdrawGuardMessage({
			accountAddress: accountState.address,
			isMainnet,
			reportingStatus,
		})
	const reportOutcomeSelectionMessage = showFullReporting && reportingStatus !== 'missing' && selectedOutcome === undefined && !reportControlsLocked ? SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE : undefined
	let reportingOpenNotice: string | undefined
	if (showFullReporting && reportingStatus === 'not-started' && effectiveReportingDetails?.questionOutcome === 'none') {
		reportingOpenNotice = selectedOutcome === undefined ? UI_STRING_REPORTING_IS_OPEN_SELECT_AN_OUTCOME_SIDE_BELOW_TO_ENABLE_REPORTING : UI_STRING_REPORTING_IS_OPEN
	}
	const withdrawActionPending = reportingActiveAction === 'withdrawEscalation'
	const shouldShowWithdrawEmptyState = !loadingReportingDetails && reportingStatus !== 'missing' && withdrawableSides.length === 0
	const hasImportedForkedDeposits = activeReportingDetails?.sides.some(side => side.importedUserDeposits.length > 0) ?? false
	const showForkWorkflowAction = reportingStageKey === 'forkTriggered' && forkAlreadyTriggered && onOpenForkWorkflow !== undefined
	const showTriggerZoltarForkAction = reportingStageKey === 'forkTriggered' && !forkAlreadyTriggered && onTriggerZoltarFork !== undefined
	const resolvedTriggerZoltarForkAvailability = triggerZoltarForkAvailability ?? { disabled: false, reason: undefined }
	const forkTriggeredActions =
		reportingStageKey !== 'forkTriggered' || (!showForkWorkflowAction && !showTriggerZoltarForkAction) ? undefined : (
			<div className='actions'>
				{showTriggerZoltarForkAction ? <TransactionActionButton idleLabel={UI_STRING_TRIGGER_ZOLTAR_FORK} pendingLabel={UI_STRING_TRIGGERING_ZOLTAR_FORK} onClick={onTriggerZoltarFork} pending={triggerZoltarForkPending} tone='primary' availability={resolvedTriggerZoltarForkAvailability} /> : undefined}
				{showForkWorkflowAction ? (
					<button className='secondary' type='button' onClick={onOpenForkWorkflow}>
						{UI_STRING_OPEN_FORK_AND_MIGRATION}
					</button>
				) : undefined}
			</div>
		)

	const handleWithdrawEscalation = (outcome: ReportingOutcomeKey, depositIndexes?: bigint[]) => {
		setPendingWithdrawOutcome(outcome)
		onWithdrawEscalation(outcome, depositIndexes)
	}
	useEffect(() => {
		if (activeReportingDetails === undefined) return
		if (escalationPhase !== 'Timed Out') return
		if (loadingReportingDetails) return
		if (isPoolQuestionFinalized(activeReportingDetails) || activeReportingDetails.hasReachedNonDecision) return
		const refreshBoundaryKey = `${activeReportingDetails.securityPoolAddress}:${activeReportingDetails.escalationEndTime.toString()}`
		if (lastTimedOutRefreshBoundaryKey.current === refreshBoundaryKey) return
		lastTimedOutRefreshBoundaryKey.current = refreshBoundaryKey
		void onLoadReporting()
	}, [activeReportingDetails, escalationPhase, loadingReportingDetails, onLoadReporting])

	useEffect(() => {
		if (reportingActiveAction === 'withdrawEscalation') return
		setPendingWithdrawOutcome(undefined)
	}, [reportingActiveAction])
	const reportingStage = showFullReporting
		? getReportingStagePresentation({
				effectiveCurrentTimestamp,
				forkAlreadyTriggered,
				marketDetails,
				reportingDetails: effectiveReportingDetails,
			})
		: undefined
	const reportingStageBanner = reportingStage?.key === 'escalation-active' ? undefined : reportingStage
	const reportingWorkflowSummary = reportingStage?.detail ?? UI_STRING_SELECT_THE_ANSWER_YOU_BELIEVE_SHOULD_FINALIZE_LOCK
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStageBanner !== undefined || reportingOpenNotice !== undefined)
	const sections = (
		<>
			{showFullReporting ? (
				<SectionBlock className='reporting-workflow-section' title={UI_STRING_REPORTING_WORKFLOW} density='compact' variant='plain'>
					<div className='workflow-summary-strip workflow-guide workflow-guide-compact'>
						<div className='workflow-guide-intro'>
							<p className='detail'>{reportingWorkflowSummary}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>{UI_STRING_1_OUTCOME}</span>
							<span>{UI_STRING_2_LOCK_REP}</span>
							<span>{UI_STRING_3_SETTLE}</span>
						</div>
					</div>
				</SectionBlock>
			) : undefined}

			{showReportingHeaderStack ? (
				<div className='reporting-header-stack'>
					{showSecurityPoolAddressInput ? (
						<LookupFieldRow
							label={UI_STRING_SECURITY_POOL_ADDRESS}
							value={reportingForm.securityPoolAddress}
							onInput={securityPoolAddress => onReportingFormChange({ securityPoolAddress })}
							placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER}
							action={
								<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails || preOpenLockedReason !== undefined} title={preOpenLockedReason}>
									{loadingReportingDetails ? <LoadingText>{UI_STRING_LOADING_ESCALATION}</LoadingText> : UI_STRING_REFRESH_REPORTING}
								</button>
							}
						/>
					) : undefined}
					{reportingOpenNotice === undefined ? <LifecycleStageBanner stage={reportingStageBanner} /> : <p className='notice success'>{reportingOpenNotice}</p>}
				</div>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-metrics-section' title={UI_STRING_ESCALATION_METRICS} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={UI_STRING_NON_DECISION_THRESHOLD}>
							<CurrencyValue value={effectiveReportingDetails?.nonDecisionThreshold} suffix={UI_STRING_REP} />
						</MetricField>
						<MetricField label={UI_STRING_TIME_LEFT}>{activeReportingDetails === undefined ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label={UI_STRING_ESCALATION_STARTED}>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
						</MetricField>
						<MetricField label={UI_STRING_START_BOND}>
							<CurrencyValue value={effectiveReportingDetails?.startBond} suffix={UI_STRING_REP} />
						</MetricField>
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-outcome-section' title={UI_STRING_REPORT_OUTCOME} variant='embedded'>
					<div className='escalation-sides-shell'>
						<div className='escalation-sides-legend'>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-total' />
								<span className='panel-label'>{UI_STRING_TOTAL_SIDE_STAKE}</span>
							</div>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-user' />
								<span className='panel-label'>{UI_STRING_YOUR_SIDE_STAKE}</span>
							</div>
							<div className='escalation-sides-legend-item escalation-sides-legend-item-binding'>
								<span aria-hidden='true' className='escalation-sides-legend-marker' />
								<span className='panel-label'>{UI_STRING_LEAD_HOLDING_CAPITAL}</span>
								<CurrencyValue copyable={false} value={displayBindingCapital} suffix={UI_STRING_REP} />
							</div>
						</div>
						<div className='escalation-sides' role='radiogroup' aria-label={UI_STRING_REPORT_OUTCOME_REPORTING_SECTION_REPORT_OUTCOME_ARIA_LABEL}>
							{outcomeSides.map((side, index) => (
								<EscalationSide
									key={side.key}
									bindingCapital={displayBindingCapital}
									chartScaleMax={chartScaleMax}
									disabled={showWithdrawOnly ? withdrawControlsLocked : reportControlsLocked}
									isLeading={leadingOutcome === side.key}
									isSelected={selectedOutcome !== undefined && selectedOutcome === side.key}
									isTabStop={selectedOutcome === undefined ? index === 0 : selectedOutcome === side.key}
									onSelect={() => onReportingFormChange({ selectedOutcome: side.key })}
									side={side}
								/>
							))}
						</div>
					</div>
					{reportOutcomeSelectionMessage === undefined ? undefined : <p className='detail'>{reportOutcomeSelectionMessage}</p>}
					{effectiveReportingDetails?.viewerVaultAvailableEscalationRep === undefined ? undefined : (
						<p className='detail'>
							{UI_STRING_AVAILABLE_UNLOCKED_VAULT_REP_FOR_REPORTING} <CurrencyValue value={effectiveReportingDetails.viewerVaultAvailableEscalationRep} suffix={UI_STRING_REP} />.
						</p>
					)}
					<div className='field'>
						<label htmlFor='reporting-contribution-amount'>
							<span>{UI_STRING_CONTRIBUTION_AMOUNT_REP}</span>
						</label>
						<div className='field-inline'>
							<FormInput id='reporting-contribution-amount' className='field-inline-input' value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} disabled={reportControlsLocked} />
							<button
								className='quiet field-inline-action'
								type='button'
								onClick={() => {
									if (maxContributionAmount.amount === undefined) return
									onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxContributionAmount.amount) })
								}}
								disabled={reportControlsLocked || maxContributionAmount.amount === undefined}
								title={reportControlsLocked ? reportControlsLockedReason : maxContributionAmount.reason}
							>
								{UI_STRING_MAX}
							</button>
						</div>
						<p className='field-help'>{UI_STRING_THIS_IS_THE_REP_YOU_ARE_WILLING_TO_LOCK_ON_THE_SELECTED_SIDE_LARGER_AMOUNTS_CAN_CHANGE_THE_PROPOSED_OUTCOME_OR_EXTEND_THE_ESCALATION_TIMER}</p>
					</div>

					<div className='actions'>
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (minimumOutcomeChangeContribution.amount === undefined) return
								onReportingFormChange({ reportAmount: formatCurrencyInputBalance(minimumOutcomeChangeContribution.amount) })
							}}
							disabled={reportControlsLocked || minimumOutcomeChangeContribution.amount === undefined}
							title={reportControlsLocked ? reportControlsLockedReason : minimumOutcomeChangeContribution.reason}
						>
							{UI_STRING_MIN_TO_TAKE_THE_LEAD}
						</button>
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (maxProfitContribution.amount === undefined) return
								onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxProfitContribution.amount) })
							}}
							disabled={reportControlsLocked || maxProfitContribution.amount === undefined}
							title={reportControlsLocked ? reportControlsLockedReason : maxProfitContribution.reason}
						>
							{UI_STRING_MAX_PROFIT}
						</button>
					</div>

					{presetReasons.map(reason => (
						<p key={reason} className='detail'>
							{reason}
						</p>
					))}
					{reportAmountError === undefined ? undefined : <p className='detail'>{reportAmountError}</p>}
					{actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (
						<p className='detail'>
							{UI_STRING_BASED_ON_THE_CURRENT_ESCALATION_STATE_THIS_ACTION_WOULD_LOCK}
							<CurrencyValue value={actualReportDepositAmount} suffix={UI_STRING_REP} />
							{UI_STRING_INSTEAD_OF_THE_FULL_ENTERED_AMOUNT}
						</p>
					)}
					<div className='actions'>
						<TransactionActionButton idleLabel={reportButtonLabel} pendingLabel={UI_STRING_SUBMITTING_REPORT} onClick={onReportOutcome} pending={reportingActiveAction === 'reportOutcome'} availability={{ disabled: !isMainnet || !reportOutcomeEnabled || reportGuardMessage !== undefined, reason: reportGuardMessage }} />
					</div>
					{projectedReportingPreview === undefined ? undefined : <p className='detail'>{projectedReportingPreview}</p>}
				</SectionBlock>
			) : undefined}

			{showSettlementSection ? (
				<SectionBlock className='reporting-settlement-section' title={UI_STRING_SETTLE_ESCALATION_DEPOSITS} variant='embedded'>
					{reportingStageKey === 'forkTriggered' ? <p className='detail'>{forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' ? <p className='detail'>{forkAlreadyTriggered ? UI_STRING_CONTINUE_IN_FORK_AND_MIGRATION_TO_MIGRATE_UNRESOLVED_ESCALATION_DEPOSITS_INTO_A_CHILD_UNIVERSE : UI_STRING_THESE_ESCALATION_DEPOSITS_MUST_MIGRATE_IN_FORK_AND_MIGRATION}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-expired' ? <p className='detail'>{UI_STRING_THE_MIGRATION_WINDOW_FOR_THESE_UNRESOLVED_ESCALATION_DEPOSITS_HAS_CLOSED}</p> : undefined}
					{hasImportedForkedDeposits ? <p className='detail'>{UI_STRING_THIS_POOL_ALSO_HAS_FORK_CARRIED_ESCALATION_POSITIONS_SETTLE_THOSE_IN_FORK_AND_MIGRATION}</p> : undefined}
					{loadingReportingDetails ? (
						<p className='detail'>
							<LoadingText>{UI_STRING_LOADING_ESCALATION_DEPOSITS_REPORTING_SECTION_LOADING_ESCALATION_DEPOSITS_DETAIL}</LoadingText>
						</p>
					) : undefined}
					{shouldShowWithdrawEmptyState && activeReportingDetails?.settlementState !== 'migration-required' && activeReportingDetails?.settlementState !== 'migration-expired' ? <p className='detail'>{UI_STRING_CONNECTED_WALLET_HAS_NO_UNSETTLED_ESCALATION_DEPOSITS}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
						? undefined
						: withdrawableSides.map(side => {
								const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key]
								const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex)
								const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key)
								const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : UI_STRING_SELECT_AT_LEAST_ONE_DEPOSIT_TO_SETTLE_OR_USE_SETTLE_ALL_FOR_THIS_SIDE)
								const isPendingSide = withdrawActionPending && pendingWithdrawOutcome === side.key

								return (
									<SectionBlock key={side.key} density='compact' headingLevel={4} title={side.label} variant='embedded'>
										<div className='field'>
											<span>{UI_STRING_CHOOSE_DEPOSITS_TO_SETTLE}</span>
											<EscalationDepositSelectionList
												disabled={withdrawControlsLocked || withdrawActionPending}
												items={side.userDeposits.map(deposit => {
													const claimAmount = getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit)
													return {
														deposit,
														details: [
															<>
																{UI_STRING_INITIALLY_DEPOSITED} <CurrencyValue value={deposit.amount} suffix={UI_STRING_REP} />
															</>,
															claimAmount === undefined ? (
																UI_STRING_WORTH_AFTER_FINALIZATION_PENDING_FINALIZATION
															) : (
																<>
																	{UI_STRING_WORTH_NOW} <CurrencyValue value={claimAmount} suffix={UI_STRING_REP} />
																</>
															),
															`${UI_STRING_CURRENT_CLAIM_TYPE} ${claimLabel ?? UI_STRING_PENDING_FINALIZATION}`,
															<>
																{UI_STRING_ENTRY_DEPTH} <CurrencyValue value={deposit.cumulativeAmount} suffix={UI_STRING_REP} />
															</>,
														],
													}
												})}
												onSelectionChange={nextSelectedWithdrawDepositIndexes =>
													onReportingFormChange({
														selectedWithdrawDepositIndexesByOutcome: {
															...selectedWithdrawDepositIndexesByOutcome,
															[side.key]: nextSelectedWithdrawDepositIndexes,
														},
													})
												}
												selectedDepositIndexes={selectedWithdrawDepositIndexes}
											/>
										</div>

										<div className='actions'>
											<TransactionActionButton
												idleLabel={UI_TEMPLATE_SETTLE_SELECTED_DEPOSITS_LABEL(side.label)}
												pendingLabel={UI_TEMPLATE_SETTLING_DEPOSITS_PENDING_LABEL(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, selectedWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												tone='secondary'
												availability={{ disabled: !isMainnet || !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, reason: withdrawSelectedGuardMessage }}
											/>
											<TransactionActionButton
												idleLabel={UI_TEMPLATE_SETTLE_ALL_DEPOSITS_LABEL(side.label)}
												pendingLabel={UI_TEMPLATE_SETTLING_DEPOSITS_PENDING_LABEL(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, allWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												tone='secondary'
												availability={{ disabled: !isMainnet || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }}
											/>
										</div>
									</SectionBlock>
								)
							})}
				</SectionBlock>
			) : undefined}
			{forkTriggeredActions}

			<ErrorNotice message={reportingError} />
		</>
	)
	if (embedInCard) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRING_REPORTING_WORKFLOW}>
			{sections}
		</RouteWorkflowPanel>
	)
}
