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
import { UI_STRINGS } from '../lib/uiStrings.js'
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
const MAX_PROFIT_NOT_STARTED_REASON = UI_STRINGS.reportingSection.maxProfitNotStartedReason
const LOAD_REPORTING_PRESETS_REASON = UI_STRINGS.reportingSection.loadReportingDetailsReason
const SELECT_OUTCOME_PRESET_REASON = UI_STRINGS.reportingSection.selectOutcomePresetReason
const SELECTED_SIDE_ALREADY_LEADS_REASON = UI_STRINGS.reportingSection.selectedSideAlreadyLeadsReason
const MAX_PROFIT_WINDOW_FILLED_REASON = UI_STRINGS.reportingSection.maxProfitWindowFilledReason
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = UI_STRINGS.reportingSection.selectOutcomeAboveToEnableReportingMessage
const NO_SELECTED_SIDE_CAPACITY_REASON = UI_STRINGS.reportingSection.noSelectedSideCapacityReason
const BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON = UI_STRINGS.reportingSection.belowMinimumSelectedSideCapacityReason
const FORK_TRIGGERED_REPORT_REASON = UI_STRINGS.reportingSection.forkTriggeredReportReason
const FORK_TRIGGERED_SETTLEMENT_REASON = UI_STRINGS.reportingSection.forkTriggeredSettlementReason
const FORK_ALREADY_TRIGGERED_REPORT_REASON = UI_STRINGS.reportingSection.forkAlreadyTriggeredReportReason
const FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON = UI_STRINGS.reportingSection.forkAlreadyTriggeredSettlementReason
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
	return reportingDetails.questionOutcome === 'none' ? UI_STRINGS.reportingSection.pendingFinalizationLabel : getReportingOutcomeLabel(reportingDetails.questionOutcome)
}
function getWithdrawDepositClaimLabel(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	return details.questionOutcome === selectedOutcome ? UI_STRINGS.reportingSection.claimTypeWinningPayoutLabel : UI_STRINGS.reportingSection.claimTypeLosingDepositSettlementLabel
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
			label: UI_STRINGS.reportingSection.reportingNotEnabledTitle,
			tone: 'warning',
		}
	if (reportingDetails === undefined)
		return {
			availableActions: [],
			blockedActions: [],
			detail: UI_STRINGS.reportingSection.reportingOpenDetail,
			key: 'reporting-open',
			label: UI_STRINGS.reportingSection.reportingOpenTitle,
			tone: 'default',
		}
	if (isPoolQuestionFinalized(reportingDetails))
		return {
			availableActions: [],
			blockedActions: [],
			detail: UI_STRINGS.reportingSection.reportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
			key: 'escalation-resolved',
			label: UI_STRINGS.reportingSection.resolvedTitle,
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
				detail: UI_STRINGS.reportingSection.reportingActiveDetail,
				key: 'escalation-active',
				label: UI_STRINGS.reportingSection.activeTitle,
				tone: 'default',
			}
		case 'Fork Triggered':
			return {
				availableActions: [],
				blockedActions: [],
				detail: forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON,
				key: 'escalation-fork-triggered',
				label: UI_STRINGS.reportingSection.forkTriggeredTitle,
				tone: 'default',
			}
		case 'Timed Out':
			return {
				availableActions: [],
				blockedActions: [],
				detail: UI_STRINGS.reportingSection.reportingTimedOutDetail,
				key: 'escalation-timed-out',
				label: UI_STRINGS.reportingSection.timedOutTitle,
				tone: 'default',
			}
		case 'Resolved':
			return {
				availableActions: [],
				blockedActions: [],
				detail: UI_STRINGS.reportingSection.reportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
				key: 'escalation-resolved',
				label: UI_STRINGS.reportingSection.resolvedTitle,
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
	if (projectedFinalizationTimestamp !== undefined && currentTimestamp !== undefined && projectedFinalizationTimestamp <= currentTimestamp) return <>{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderImmediate(selectedOutcomeLabel)}</>
	if (rewardWindowFillTimestamp !== undefined && currentTimestamp !== undefined && rewardWindowFillTimestamp > currentTimestamp)
		return (
			<>
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeRewardWindowPrefix}
				<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={rewardWindowFillTimestamp} />
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeRewardWindowMiddle}
				{selectedOutcomeLabel}
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeRewardWindowSuffix}
				{selectedOutcomeLabel}
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeRewardWindowTail}
			</>
		)
	if (projectedFinalizationTimestamp !== undefined)
		return (
			<>
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeFinalizationPrefix}
				<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={projectedFinalizationTimestamp} />
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeFinalizationMiddle}
				{selectedOutcomeLabel}
				{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderBeforeFinalizationSuffix}
			</>
		)
	return <>{UI_STRINGS.reportingSection.reportingLatestOutcomeReminderLater(selectedOutcomeLabel)}</>
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
		reportLifecycleReason = UI_STRINGS.reportingSection.reportingHasEndedRefreshReason
	} else if (reportingStageKey === 'resolved') {
		reportLifecycleReason = UI_STRINGS.reportingSection.reportingPoolAlreadyFinalizedReason
	}
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		settlementLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON
	} else if (activeReportingDetails?.settlementState === 'migration-required') {
		settlementLifecycleReason = forkAlreadyTriggered ? UI_STRINGS.reportingSection.continueInForkAndMigrationReason : UI_STRINGS.reportingSection.migrationRequiredReason
	} else if (activeReportingDetails?.settlementState === 'migration-expired') {
		settlementLifecycleReason = UI_STRINGS.reportingSection.migrationExpiredReason
	} else if (reportingStageKey === 'activeLocked') {
		settlementLifecycleReason = UI_STRINGS.reportingSection.settlementLockedUntilFinalizedReason
	}
	const withdrawControlsLockedReason = showSettlementSection && loadingReportingDetails ? UI_STRINGS.reportingSection.loadingEscalationDepositsReason : pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
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
	const selectedOutcomeLabel = selectedOutcome === undefined ? UI_STRINGS.reportingSection.selectedSideLabel : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
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
					{UI_STRINGS.reportingSection.reportingProjectionProfitPrefix}
					{selectedOutcomeLabel}
					{UI_STRINGS.reportingSection.reportingProjectionProfitMiddle}
					<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRINGS.common.repLabel} />
					{UI_STRINGS.reportingSection.reportingProjectionProfitSuffix}
					{finalizationReminder}
				</>
			)
		}
		if (timerPreview.kind === 'not-started') {
			if (timerPreview.hypotheticalDuration > 0n)
				return (
					<>
						{UI_STRINGS.reportingSection.reportingProjectionNotStartedPrefix}
						{formatDuration(timerPreview.timeUntilStart)}
						{UI_STRINGS.reportingSection.reportingProjectionNotStartedSimpleSuffix}
						{UI_STRINGS.reportingSection.reportingProjectionNotStartedCheckBackPrefix}
						<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={projectedFinalizationTimestamp} />
						{UI_STRINGS.reportingSection.reportingProjectionNotStartedCheckBackMiddle}
						{selectedOutcomeLabel}
						{UI_STRINGS.reportingSection.reportingProjectionNotStartedCheckBackSuffix}
					</>
				)
			return (
				<>
					{UI_STRINGS.reportingSection.reportingProjectionNotStartedPrefix}
					{formatDuration(timerPreview.timeUntilStart)}
					{UI_STRINGS.reportingSection.reportingProjectionNotStartedSimpleSuffix}
					{finalizationReminder}
				</>
			)
		}
		if (selectedEstimate === undefined || activeReportingDetails === undefined) return undefined
		if (timerPreview.actualState === 'ends-immediately')
			return (
				<>
					{UI_STRINGS.reportingSection.reportingProjectionProfitPrefix}
					{selectedOutcomeLabel}
					{UI_STRINGS.reportingSection.reportingProjectionProfitMiddle}
					<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRINGS.common.repLabel} />
					{UI_STRINGS.reportingSection.reportingProjectionProfitSuffix}
					{UI_STRINGS.reportingSection.reportingProjectionEndsImmediatelyText}
					{finalizationReminder}
				</>
			)
		const projectedFinalizationDuration = formatDuration(getEscalationTimeRemaining(activeReportingDetails) + (timerPreview.timerIncrease ?? 0n))
		if (timerPreview.actualState === 'extends')
			return (
				<>
					{UI_STRINGS.reportingSection.reportingProjectionProfitPrefix}
					{selectedOutcomeLabel}
					{UI_STRINGS.reportingSection.reportingProjectionProfitMiddle}
					<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRINGS.common.repLabel} />
					{UI_STRINGS.reportingSection.reportingProjectionProfitSuffix}
					{UI_STRINGS.reportingSection.reportingProjectionExtendsPrefix}
					{formatDuration(timerPreview.timerIncrease ?? 0n)}
					{UI_STRINGS.reportingSection.reportingProjectionExtendsMiddle}
					{projectedFinalizationDuration}
					{UI_STRINGS.reportingSection.reportingProjectionNotStartedSimpleSuffix}
					{finalizationReminder}
				</>
			)
		return (
			<>
				{UI_STRINGS.reportingSection.reportingProjectionProfitPrefix}
				{selectedOutcomeLabel}
				{UI_STRINGS.reportingSection.reportingProjectionProfitMiddle}
				<CurrencyValue value={selectedEstimate.profit} suffix={UI_STRINGS.common.repLabel} />
				{UI_STRINGS.reportingSection.reportingProjectionProfitSuffix}
				{UI_STRINGS.reportingSection.reportingProjectionDoesNotExtendPrefix}
				{projectedFinalizationDuration}
				{UI_STRINGS.reportingSection.reportingProjectionNotStartedSimpleSuffix}
				{finalizationReminder}
			</>
		)
	}
	const projectedReportingPreview = getProjectedReportingPreview()
	const reportButtonLabel = selectedOutcome === undefined ? UI_STRINGS.reportingSection.reportOnSelectedSideLabel : UI_STRINGS.reportingSection.reportSelectedOutcomeButtonLabel(selectedOutcomeLabel)
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const maxProfitContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = (() => {
		if (selectedOutcome === undefined) return { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON }
		if (effectiveReportingDetails === undefined) return { amount: undefined, reason: LOAD_REPORTING_PRESETS_REASON }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep === undefined) return { amount: undefined, reason: UI_STRINGS.reportingSection.loadingAvailableVaultRepReason }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep <= 0n) return { amount: undefined, reason: UI_STRINGS.reportingSection.noUnlockedVaultRepReason }
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
		if (selectedSide === undefined) return { amount: undefined, reason: UI_STRINGS.reportingSection.selectedSideUnavailableReason }
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
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? UI_STRINGS.reportingSection.enterValidReportAmountReason : undefined
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
		reportingOpenNotice = selectedOutcome === undefined ? UI_STRINGS.reportingSection.reportingOpenSelectOutcomeMessage : UI_STRINGS.reportingSection.reportingOpenMessage
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
					<TransactionActionButton idleLabel={UI_STRINGS.reportingSection.triggerZoltarForkIdleLabel} pendingLabel={UI_STRINGS.reportingSection.triggeringZoltarForkLabel} onClick={onTriggerZoltarFork} pending={triggerZoltarForkPending} tone='primary' availability={resolvedTriggerZoltarForkAvailability} />
				) : undefined}
				{showForkWorkflowAction ? (
					<button className='secondary' type='button' onClick={onOpenForkWorkflow}>
						{UI_STRINGS.reportingSection.openForkAndMigrationLabel}
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
	const reportingWorkflowSummary = reportingStage?.detail ?? UI_STRINGS.reportingSection.reportingWorkflowSummary
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStageBanner !== undefined || reportingOpenNotice !== undefined)
	const sections = (
		<>
			{showFullReporting ? (
				<SectionBlock className='reporting-workflow-section' title={UI_STRINGS.reportingSection.reportingWorkflowTitle} density='compact' variant='plain'>
					<div className='workflow-summary-strip workflow-guide workflow-guide-compact'>
						<div className='workflow-guide-intro'>
							<p className='detail'>{reportingWorkflowSummary}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>{UI_STRINGS.reportingSection.reportingWorkflowStepOutcomeLabel}</span>
							<span>{UI_STRINGS.reportingSection.reportingWorkflowStepLockRepLabel}</span>
							<span>{UI_STRINGS.reportingSection.reportingWorkflowStepSettleLabel}</span>
						</div>
					</div>
				</SectionBlock>
			) : undefined}

			{showReportingHeaderStack ? (
				<div className='reporting-header-stack'>
					{showSecurityPoolAddressInput ? (
						<LookupFieldRow
							label={UI_STRINGS.reportingSection.securityPoolAddressLabel}
							value={reportingForm.securityPoolAddress}
							onInput={securityPoolAddress => onReportingFormChange({ securityPoolAddress })}
							placeholder={UI_STRINGS.common.hexValuePlaceholder}
							action={
								<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails || preOpenLockedReason !== undefined} title={preOpenLockedReason}>
									{loadingReportingDetails ? <LoadingText>{UI_STRINGS.reportingSection.loadingEscalationLabel}</LoadingText> : UI_STRINGS.reportingSection.loadingReportingLabel}
								</button>
							}
						/>
					) : undefined}
					{reportingOpenNotice === undefined ? <LifecycleStageBanner stage={reportingStageBanner} /> : <p className='notice success'>{reportingOpenNotice}</p>}
				</div>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-metrics-section' title={UI_STRINGS.reportingSection.reportingMetricsTitle} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={UI_STRINGS.reportingSection.nonDecisionThresholdLabel}>
							<CurrencyValue value={effectiveReportingDetails?.nonDecisionThreshold} suffix={UI_STRINGS.common.repLabel} />
						</MetricField>
						<MetricField label={UI_STRINGS.reportingSection.timeLeftLabel}>{activeReportingDetails === undefined ? UI_STRINGS.common.metricUnavailablePlaceholder : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label={UI_STRINGS.reportingSection.escalationStartedLabel}>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
						</MetricField>
						<MetricField label={UI_STRINGS.reportingSection.startBondLabel}>
							<CurrencyValue value={effectiveReportingDetails?.startBond} suffix={UI_STRINGS.common.repLabel} />
						</MetricField>
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-outcome-section' title={UI_STRINGS.reportingSection.reportingOutcomeTitle} variant='embedded'>
					<div className='escalation-sides-shell'>
						<div className='escalation-sides-legend'>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-total' />
								<span className='panel-label'>{UI_STRINGS.reportingSection.totalSideStakeLabel}</span>
							</div>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-user' />
								<span className='panel-label'>{UI_STRINGS.reportingSection.selectedSideStakeLabel}</span>
							</div>
							<div className='escalation-sides-legend-item escalation-sides-legend-item-binding'>
								<span aria-hidden='true' className='escalation-sides-legend-marker' />
								<span className='panel-label'>{UI_STRINGS.reportingSection.leadHoldingCapitalLabel}</span>
								<CurrencyValue copyable={false} value={displayBindingCapital} suffix={UI_STRINGS.common.repLabel} />
							</div>
						</div>
						<div className='escalation-sides' role='radiogroup' aria-label={UI_STRINGS.reportingSection.reportOutcomeAriaLabel}>
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
							{UI_STRINGS.reportingSection.availableUnlockedVaultRepPrefix} <CurrencyValue value={effectiveReportingDetails.viewerVaultAvailableEscalationRep} suffix={UI_STRINGS.common.repLabel} />.
						</p>
					)}
					<div className='field'>
						<label htmlFor='reporting-contribution-amount'>
							<span>{UI_STRINGS.reportingSection.contributionAmountLabel}</span>
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
								{UI_STRINGS.common.maxLabel}
							</button>
						</div>
						<p className='field-help'>{UI_STRINGS.reportingSection.contributionAmountHelpText}</p>
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
							{UI_STRINGS.reportingSection.minToTakeTheLeadLabel}
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
							{UI_STRINGS.reportingSection.maxProfitLabel}
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
							{UI_STRINGS.reportingSection.reportingContributionLockPrefix}
							<CurrencyValue value={actualReportDepositAmount} suffix={UI_STRINGS.common.repLabel} />
							{UI_STRINGS.reportingSection.reportingContributionLockSuffix}
						</p>
					)}
					<div className='actions'>
						<TransactionActionButton
							idleLabel={reportButtonLabel}
							pendingLabel={UI_STRINGS.reportingSection.submitReportPendingLabel}
							onClick={onReportOutcome}
							pending={reportingActiveAction === 'reportOutcome'}
							availability={{ disabled: !isMainnet || !reportOutcomeEnabled || reportGuardMessage !== undefined, reason: reportGuardMessage }}
						/>
					</div>
					{projectedReportingPreview === undefined ? undefined : <p className='detail'>{projectedReportingPreview}</p>}
				</SectionBlock>
			) : undefined}

			{showSettlementSection ? (
				<SectionBlock className='reporting-settlement-section' title={UI_STRINGS.reportingSection.reportingSettlementTitle} variant='embedded'>
					{reportingStageKey === 'forkTriggered' ? <p className='detail'>{forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' ? <p className='detail'>{forkAlreadyTriggered ? UI_STRINGS.reportingSection.continueInForkAndMigrationReason : UI_STRINGS.reportingSection.migrationRequiredReason}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-expired' ? <p className='detail'>{UI_STRINGS.reportingSection.migrationExpiredReason}</p> : undefined}
					{hasImportedForkedDeposits ? <p className='detail'>{UI_STRINGS.reportingSection.thisPoolAlsoHasForkCarriedEscalationPositionsDetail}</p> : undefined}
					{loadingReportingDetails ? (
						<p className='detail'>
							<LoadingText>{UI_STRINGS.reportingSection.loadingEscalationDepositsDetail}</LoadingText>
						</p>
					) : undefined}
					{shouldShowWithdrawEmptyState && activeReportingDetails?.settlementState !== 'migration-required' && activeReportingDetails?.settlementState !== 'migration-expired' ? <p className='detail'>{UI_STRINGS.reportingSection.withdrawEmptyStateDetail}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
						? undefined
						: withdrawableSides.map(side => {
								const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key]
								const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex)
								const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key)
								const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : UI_STRINGS.reportingSection.settleAllForThisSideReason)
								const isPendingSide = withdrawActionPending && pendingWithdrawOutcome === side.key

								return (
									<SectionBlock key={side.key} density='compact' headingLevel={4} title={side.label} variant='embedded'>
										<div className='field'>
											<span>{UI_STRINGS.reportingSection.chooseDepositsToSettleLabel}</span>
											<EscalationDepositSelectionList
												disabled={withdrawControlsLocked || withdrawActionPending}
												items={side.userDeposits.map(deposit => {
													const claimAmount = getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit)
													return {
														deposit,
														details: [
															<>
																{UI_STRINGS.reportingSection.initiallyDepositedLabel} <CurrencyValue value={deposit.amount} suffix={UI_STRINGS.common.repLabel} />
															</>,
															claimAmount === undefined ? (
																UI_STRINGS.reportingSection.worthAfterFinalizationPendingLabel
															) : (
																<>
																	{UI_STRINGS.reportingSection.worthNowLabel} <CurrencyValue value={claimAmount} suffix={UI_STRINGS.common.repLabel} />
																</>
															),
															`${UI_STRINGS.reportingSection.currentClaimTypePrefix} ${claimLabel ?? UI_STRINGS.reportingSection.pendingFinalizationLabel}`,
															<>
																{UI_STRINGS.reportingSection.entryDepthLabel} <CurrencyValue value={deposit.cumulativeAmount} suffix={UI_STRINGS.common.repLabel} />
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
												idleLabel={UI_STRINGS.reportingSection.settleSelectedDepositsLabel(side.label)}
												pendingLabel={UI_STRINGS.reportingSection.settlingDepositsPendingLabel(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, selectedWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												tone='secondary'
												availability={{ disabled: !isMainnet || !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, reason: withdrawSelectedGuardMessage }}
											/>
											<TransactionActionButton
												idleLabel={UI_STRINGS.reportingSection.settleAllDepositsLabel(side.label)}
												pendingLabel={UI_STRINGS.reportingSection.settlingDepositsPendingLabel(side.label)}
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
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRINGS.reportingSection.reportingWorkflowCardTitle}>
			{sections}
		</RouteWorkflowPanel>
	)
}
