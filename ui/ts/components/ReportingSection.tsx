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
import { getReportingActionSafetyId } from '../lib/actionSafety/ids.js'
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
const MAX_PROFIT_NOT_STARTED_REASON = 'Max profit becomes available after the escalation game starts.'
const LOAD_REPORTING_PRESETS_REASON = 'Load reporting details before using presets.'
const SELECT_OUTCOME_PRESET_REASON = 'Select an outcome side before using presets.'
const SELECTED_SIDE_ALREADY_LEADS_REASON = 'Selected side already leads.'
const MAX_PROFIT_WINDOW_FILLED_REASON = 'Max profit preset unavailable because the reward window is already filled on the selected side.'
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = 'Select an outcome side above to enable reporting.'
const NO_SELECTED_SIDE_CAPACITY_REASON = 'No remaining contribution capacity is available on the selected side.'
const BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON = 'Remaining selected-side capacity is below the minimum report bond.'
const FORK_TRIGGERED_REPORT_REASON = 'Escalation reached non-decision. Trigger Zoltar Fork here if this pool should fork the universe.'
const FORK_TRIGGERED_SETTLEMENT_REASON = 'Escalation deposits remain locked after non-decision. Trigger Zoltar Fork here if this pool should fork the universe.'
const FORK_ALREADY_TRIGGERED_REPORT_REASON = 'Escalation reached non-decision and Zoltar fork has already been triggered for this pool. Continue in Fork & Migration.'
const FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON = 'Escalation deposits remain locked after non-decision. Zoltar fork has already been triggered for this pool, so continue in Fork & Migration.'
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
	return reportingDetails.questionOutcome === 'none' ? 'Pending finalization' : getReportingOutcomeLabel(reportingDetails.questionOutcome)
}
function getWithdrawDepositClaimLabel(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	return details.questionOutcome === selectedOutcome ? 'Winning payout' : 'Losing deposit settlement'
}

function getWithdrawSelectedButtonLabel(sideLabel: string) {
	return `Settle Selected ${sideLabel} Deposits`
}

function getWithdrawAllButtonLabel(sideLabel: string) {
	return `Settle All ${sideLabel} Deposits`
}

function getWithdrawPendingLabel(sideLabel: string) {
	return `Settling ${sideLabel} deposits...`
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
			blockedActions: ['Report outcome', 'Settle escalation deposits'],
			detail: getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp),
			key: 'reporting-not-enabled',
			label: 'Reporting Not Enabled',
			tone: 'warning',
		}
	if (reportingDetails === undefined)
		return {
			availableActions: ['Refresh reporting'],
			blockedActions: [],
			detail: 'Load reporting details to view the escalation state for this pool.',
			key: 'reporting-open',
			label: 'Reporting Open',
			tone: 'default',
		}
	if (isPoolQuestionFinalized(reportingDetails))
		return {
			availableActions: ['Settle escalation deposits'],
			blockedActions: [],
			detail: `Market finalized as ${getResolvedReportingOutcomeLabel(reportingDetails)}.`,
			key: 'escalation-resolved',
			label: 'Resolved',
			tone: 'success',
		}
	if (reportingDetails.status === 'not-started') return undefined
	const escalationPhase = getEscalationPhase(reportingDetails)
	switch (escalationPhase) {
		case 'Pending Start':
			return undefined
		case 'Active':
			return {
				availableActions: ['Report outcome'],
				blockedActions: ['Settle escalation deposits until finalization'],
				detail: 'Escalation is live. Review the bond, side balances, and time remaining before contributing or withdrawing.',
				key: 'escalation-active',
				label: 'Active',
				tone: 'default',
			}
		case 'Fork Triggered':
			return {
				availableActions: [forkAlreadyTriggered ? 'Continue in Fork & Migration' : 'Trigger Zoltar Fork'],
				blockedActions: ['Settle escalation deposits on the parent pool'],
				detail: forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON,
				key: 'escalation-fork-triggered',
				label: 'Fork Triggered',
				tone: 'default',
			}
		case 'Timed Out':
			return {
				availableActions: ['Refresh reporting'],
				blockedActions: [],
				detail: 'Escalation ended by timeout. The winner is computed from the current stakes; refresh reporting if the resolved outcome is not loaded yet.',
				key: 'escalation-timed-out',
				label: 'Timed Out',
				tone: 'default',
			}
		case 'Resolved':
			return {
				availableActions: ['Settle escalation deposits'],
				blockedActions: [],
				detail: `Market finalized as ${getResolvedReportingOutcomeLabel(reportingDetails)}.`,
				key: 'escalation-resolved',
				label: 'Resolved',
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
	if (projectedFinalizationTimestamp !== undefined && currentTimestamp !== undefined && projectedFinalizationTimestamp <= currentTimestamp) return <>Check back immediately to confirm the market finalized as {selectedOutcomeLabel}.</>
	if (rewardWindowFillTimestamp !== undefined && currentTimestamp !== undefined && rewardWindowFillTimestamp > currentTimestamp)
		return (
			<>
				Check back no later than <TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={rewardWindowFillTimestamp} /> to confirm {selectedOutcomeLabel} is the leading outcome before the remaining reward-eligible REP on {selectedOutcomeLabel} is filled.
			</>
		)
	if (projectedFinalizationTimestamp !== undefined)
		return (
			<>
				Check back no later than <TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={projectedFinalizationTimestamp} /> to confirm {selectedOutcomeLabel} is the leading outcome before finalization.
			</>
		)
	return <>Check back later to confirm {selectedOutcomeLabel} is the leading outcome.</>
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
		reportLifecycleReason = 'Escalation has ended. Refresh reporting to view the finalized outcome before settling deposits.'
	} else if (reportingStageKey === 'resolved') {
		reportLifecycleReason = 'This pool is already finalized.'
	}
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		settlementLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON
	} else if (activeReportingDetails?.settlementState === 'migration-required') {
		settlementLifecycleReason = forkAlreadyTriggered ? 'Continue in Fork & Migration to migrate unresolved escalation deposits into a child universe.' : 'These escalation deposits must migrate in Fork & Migration.'
	} else if (activeReportingDetails?.settlementState === 'migration-expired') {
		settlementLifecycleReason = 'The migration window for these unresolved escalation deposits has closed.'
	} else if (reportingStageKey === 'activeLocked') {
		settlementLifecycleReason = 'Escalation deposits cannot be settled until the question is finalized.'
	}
	const withdrawControlsLockedReason = showSettlementSection && loadingReportingDetails ? 'Loading escalation deposits.' : pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
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
	const selectedOutcomeLabel = selectedOutcome === undefined ? 'Selected Side' : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
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
					If {selectedOutcomeLabel} wins and no one else contributes afterward, this amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit. {finalizationReminder}
				</>
			)
		}
		if (timerPreview.kind === 'not-started') {
			if (timerPreview.hypotheticalDuration > 0n)
				return (
					<>
						If no one disputes after this report, the market would finalize in {formatDuration(timerPreview.timeUntilStart)}. Check back no later than <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={projectedFinalizationTimestamp} /> to
						confirm {selectedOutcomeLabel} is still leading if later disputes keep escalation open.
					</>
				)
			return (
				<>
					If no one disputes after this report, the market would finalize in {formatDuration(timerPreview.timeUntilStart)}. {finalizationReminder}
				</>
			)
		}
		if (selectedEstimate === undefined || activeReportingDetails === undefined) return undefined
		if (timerPreview.actualState === 'ends-immediately')
			return (
				<>
					If {selectedOutcomeLabel} wins and no one else contributes afterward, this amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit. This contribution would end the escalation and finalize the market immediately. {finalizationReminder}
				</>
			)
		const projectedFinalizationDuration = formatDuration(getEscalationTimeRemaining(activeReportingDetails) + (timerPreview.timerIncrease ?? 0n))
		if (timerPreview.actualState === 'extends')
			return (
				<>
					If {selectedOutcomeLabel} wins and no one else contributes afterward, this amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit. This contribution would extend the timer by {formatDuration(timerPreview.timerIncrease ?? 0n)}, and if no one disputes after it, the
					market would finalize in {projectedFinalizationDuration}. {finalizationReminder}
				</>
			)
		return (
			<>
				If {selectedOutcomeLabel} wins and no one else contributes afterward, this amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit. This contribution would not extend the timer, and if no one disputes after it, the market would finalize in {projectedFinalizationDuration}
				. {finalizationReminder}
			</>
		)
	}
	const projectedReportingPreview = getProjectedReportingPreview()
	const reportButtonLabel = selectedOutcome === undefined ? 'Report On Selected Side' : `Report ${selectedOutcomeLabel}`
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const maxProfitContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = (() => {
		if (selectedOutcome === undefined) return { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON }
		if (effectiveReportingDetails === undefined) return { amount: undefined, reason: LOAD_REPORTING_PRESETS_REASON }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep === undefined) return { amount: undefined, reason: 'Loading available vault REP.' }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep <= 0n) return { amount: undefined, reason: 'No unlocked vault REP available for reporting.' }
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
		if (selectedSide === undefined) return { amount: undefined, reason: 'Selected side is unavailable.' }
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
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? 'Enter a valid report amount to preview profit.' : undefined
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
		reportingOpenNotice = selectedOutcome === undefined ? 'Reporting is open. Select an outcome side below to enable reporting.' : 'Reporting is open.'
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
				{showTriggerZoltarForkAction ? (
					<TransactionActionButton safetyId='reporting.triggerZoltarFork' idleLabel='Trigger Zoltar Fork' pendingLabel='Triggering Zoltar fork...' onClick={onTriggerZoltarFork} pending={triggerZoltarForkPending} tone='primary' availability={resolvedTriggerZoltarForkAvailability} />
				) : undefined}
				{showForkWorkflowAction ? (
					<button className='secondary' type='button' onClick={onOpenForkWorkflow}>
						Open Fork & Migration
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
	const reportingWorkflowSummary = reportingStage?.detail ?? 'Select the answer you believe should finalize, lock REP behind it, and return after finalization to settle deposits.'
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStage !== undefined || reportingOpenNotice !== undefined)
	const sections = (
		<>
			{showFullReporting ? (
				<SectionBlock className='reporting-workflow-section' title='Reporting Workflow' density='compact' variant='plain' description='Reporting is the dispute game that locks vault REP behind an outcome until the market finalizes or forks.'>
					<div className='workflow-summary-strip workflow-guide workflow-guide-compact'>
						<div className='workflow-guide-intro'>
							<strong>Current guidance</strong>
							<p className='detail'>{reportingWorkflowSummary}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>1. Outcome</span>
							<span>2. Lock REP</span>
							<span>3. Settle</span>
						</div>
					</div>
				</SectionBlock>
			) : undefined}

			{showReportingHeaderStack ? (
				<div className='reporting-header-stack'>
					{showSecurityPoolAddressInput ? (
						<LookupFieldRow
							label='Security Pool Address'
							value={reportingForm.securityPoolAddress}
							onInput={securityPoolAddress => onReportingFormChange({ securityPoolAddress })}
							placeholder='0x...'
							action={
								<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails || preOpenLockedReason !== undefined} title={preOpenLockedReason}>
									{loadingReportingDetails ? <LoadingText>Loading escalation...</LoadingText> : 'Refresh reporting'}
								</button>
							}
						/>
					) : undefined}
					{reportingOpenNotice === undefined ? <LifecycleStageBanner stage={reportingStage} /> : <p className='notice success'>{reportingOpenNotice}</p>}
				</div>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-metrics-section' title='Escalation Metrics' variant='embedded' description='These values show how much stake is required, how long the current dispute window lasts, and whether the question is close to finalization.'>
					<div className='escalation-metrics'>
						<MetricField label='Non-decision threshold'>
							<CurrencyValue value={effectiveReportingDetails?.nonDecisionThreshold} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{activeReportingDetails === undefined ? '—' : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label='Escalation started'>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
						</MetricField>
						<MetricField label='Start Bond'>
							<CurrencyValue value={effectiveReportingDetails?.startBond} suffix='REP' />
						</MetricField>
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-outcome-section' title='Report Outcome' variant='embedded' description='Choose the side you believe should become final. Reporting locks REP behind that outcome until the question finalizes or moves into fork migration.'>
					<div className='escalation-sides-shell'>
						<div className='escalation-sides-legend'>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-total' />
								<span className='panel-label'>Total side stake</span>
							</div>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-user' />
								<span className='panel-label'>Your side stake</span>
							</div>
							<div className='escalation-sides-legend-item escalation-sides-legend-item-binding'>
								<span aria-hidden='true' className='escalation-sides-legend-marker' />
								<span className='panel-label'>Lead-holding capital</span>
								<CurrencyValue copyable={false} value={displayBindingCapital} suffix='REP' />
							</div>
						</div>
						<div className='escalation-sides' role='radiogroup' aria-label='Report outcome'>
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
							Available unlocked vault REP for reporting: <CurrencyValue value={effectiveReportingDetails.viewerVaultAvailableEscalationRep} suffix='REP' />.
						</p>
					)}
					<div className='field'>
						<label htmlFor='reporting-contribution-amount'>
							<span>Contribution Amount (REP)</span>
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
								Max
							</button>
						</div>
						<p className='field-help'>This is the REP you are willing to lock on the selected side. Larger amounts can change the proposed outcome or extend the escalation timer.</p>
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
							Min to take the lead
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
							Max profit
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
							Based on the current escalation state, this action would lock <CurrencyValue value={actualReportDepositAmount} suffix='REP' /> instead of the full entered amount.
						</p>
					)}
					<div className='actions'>
						<TransactionActionButton
							safetyId={getReportingActionSafetyId('reportOutcome')}
							idleLabel={reportButtonLabel}
							pendingLabel='Submitting report...'
							onClick={onReportOutcome}
							pending={reportingActiveAction === 'reportOutcome'}
							availability={{ disabled: !reportOutcomeEnabled || reportGuardMessage !== undefined, reason: reportGuardMessage }}
						/>
					</div>
					{projectedReportingPreview === undefined ? undefined : <p className='detail'>{projectedReportingPreview}</p>}
				</SectionBlock>
			) : undefined}

			{showSettlementSection ? (
				<SectionBlock className='reporting-settlement-section' title='Settle Escalation Deposits' variant='embedded' description='After finalization, settle your deposits to unlock balances or claim the final payout for the winning side.'>
					{reportingStageKey === 'forkTriggered' ? <p className='detail'>{forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' ? <p className='detail'>{forkAlreadyTriggered ? 'Continue in Fork & Migration to migrate unresolved escalation deposits into a child universe.' : 'These escalation deposits must migrate in Fork & Migration.'}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-expired' ? <p className='detail'>The migration window for these unresolved escalation deposits has closed.</p> : undefined}
					{hasImportedForkedDeposits ? <p className='detail'>This pool also has fork-carried escalation positions. Settle those in Fork & Migration.</p> : undefined}
					{loadingReportingDetails ? (
						<p className='detail'>
							<LoadingText>Loading escalation deposits...</LoadingText>
						</p>
					) : undefined}
					{shouldShowWithdrawEmptyState && activeReportingDetails?.settlementState !== 'migration-required' && activeReportingDetails?.settlementState !== 'migration-expired' ? <p className='detail'>Connected wallet has no unsettled escalation deposits.</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
						? undefined
						: withdrawableSides.map(side => {
								const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key]
								const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex)
								const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key)
								const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : 'Select at least one deposit to settle or use Settle all for this side.')
								const isPendingSide = withdrawActionPending && pendingWithdrawOutcome === side.key

								return (
									<SectionBlock key={side.key} density='compact' headingLevel={4} title={side.label} variant='embedded'>
										<div className='field'>
											<span>Choose deposits to settle</span>
											<EscalationDepositSelectionList
												disabled={withdrawControlsLocked || withdrawActionPending}
												items={side.userDeposits.map(deposit => {
													const claimAmount = getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit)
													return {
														deposit,
														details: [
															<>
																Initially deposited: <CurrencyValue value={deposit.amount} suffix='REP' />
															</>,
															claimAmount === undefined ? (
																'Worth after finalization: Pending finalization'
															) : (
																<>
																	Worth now: <CurrencyValue value={claimAmount} suffix='REP' />
																</>
															),
															`Current claim type: ${claimLabel ?? 'Pending finalization'}`,
															<>
																Entry depth: <CurrencyValue value={deposit.cumulativeAmount} suffix='REP' />
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
												safetyId={getReportingActionSafetyId('withdrawEscalation')}
												idleLabel={getWithdrawSelectedButtonLabel(side.label)}
												pendingLabel={getWithdrawPendingLabel(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, selectedWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												tone='secondary'
												availability={{ disabled: !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, reason: withdrawSelectedGuardMessage }}
											/>
											<TransactionActionButton
												safetyId={getReportingActionSafetyId('withdrawEscalation')}
												idleLabel={getWithdrawAllButtonLabel(side.label)}
												pendingLabel={getWithdrawPendingLabel(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, allWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												tone='secondary'
												availability={{ disabled: !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }}
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
		<RouteWorkflowPanel showHeader={showHeader} title='Reporting & Escalation'>
			{sections}
		</RouteWorkflowPanel>
	)
}
