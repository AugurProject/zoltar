import * as commonCopy from '../../../copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { EscalationSide } from './EscalationSide.js'
import { LifecycleStageBanner } from '../../security-pools/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricField } from '../../../components/MetricField.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { assertNever } from '../../../lib/assert.js'
import { pickFirstReason } from '../../../lib/actionAvailability.js'
import { formatCurrencyInputBalance, formatDuration } from '../../../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../../markets/lib/marketForm.js'
import { isMainnetChain } from '../../../lib/network.js'
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
import { deriveSecurityPoolReportingStage, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import type { LifecycleStagePresentation, ReportingSectionProps } from '../../types.js'
import type { EscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '../../../types/contracts.js'
type ReportingStatus = 'active' | 'missing' | 'not-started'
type EscalationSideDisplay = {
	balance: bigint | undefined
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}
const MAX_PROFIT_NOT_STARTED_REASON = reportingCopy.maxProfitPrestartReason
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.presetDetailsRequired
const SELECT_OUTCOME_PRESET_REASON = reportingCopy.presetOutcomeSelectionRequired
const SELECTED_SIDE_ALREADY_LEADS_REASON = reportingCopy.selectedSideLeadsReason
const MAX_PROFIT_WINDOW_FILLED_REASON = reportingCopy.maxProfitWindowFilledReason
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = reportingCopy.reportingActivationHint
const NO_SELECTED_SIDE_CAPACITY_REASON = reportingCopy.selectedSideCapacityEmpty
const BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON = reportingCopy.selectedSideBelowMinimumReason
const FORK_TRIGGERED_REPORT_REASON = reportingCopy.forkTriggerInstruction
const FORK_TRIGGERED_SETTLEMENT_REASON = reportingCopy.forkRequiredSettlementReason
const FORK_ALREADY_TRIGGERED_REPORT_REASON = reportingCopy.forkAlreadyTriggeredReportReason
const FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON = reportingCopy.forkAlreadyTriggeredSettlementReason
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
	return reportingDetails.questionOutcome === 'none' ? reportingCopy.pendingFinalization : getReportingOutcomeLabel(reportingDetails.questionOutcome)
}
function getWithdrawDepositClaimLabel(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey) {
	if (details === undefined || details.status !== 'active') return undefined
	if (!isPoolQuestionFinalized(details)) return undefined
	return details.questionOutcome === selectedOutcome ? reportingCopy.winningPayout : reportingCopy.losingDepositSettlement
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
			label: reportingCopy.reportingNotEnabled,
			tone: 'warning',
		}
	if (reportingDetails === undefined)
		return {
			availableActions: [],
			blockedActions: [],
			detail: reportingCopy.reportingDetailsRequired,
			key: 'reporting-open',
			label: reportingCopy.reportingOpen,
			tone: 'default',
		}
	if (isPoolQuestionFinalized(reportingDetails))
		return {
			availableActions: [],
			blockedActions: [],
			detail: reportingCopy.formatReportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
			key: 'escalation-resolved',
			label: reportingCopy.resolved,
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
				detail: reportingCopy.liveEscalationHelpText,
				key: 'escalation-active',
				label: commonCopy.active,
				tone: 'default',
			}
		case 'Fork Triggered':
			return {
				availableActions: [],
				blockedActions: [],
				detail: forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON,
				key: 'escalation-fork-triggered',
				label: commonCopy.forkTriggered,
				tone: 'default',
			}
		case 'Timed Out':
			return {
				availableActions: [],
				blockedActions: [],
				detail: reportingCopy.timeoutResolutionDetail,
				key: 'escalation-timed-out',
				label: reportingCopy.timedOut,
				tone: 'default',
			}
		case 'Resolved':
			return {
				availableActions: [],
				blockedActions: [],
				detail: reportingCopy.formatReportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
				key: 'escalation-resolved',
				label: reportingCopy.resolved,
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
	if (projectedFinalizationTimestamp !== undefined && currentTimestamp !== undefined && projectedFinalizationTimestamp <= currentTimestamp) return <>{reportingCopy.formatLatestOutcomeReminder(selectedOutcomeLabel)}</>
	if (rewardWindowFillTimestamp !== undefined && currentTimestamp !== undefined && rewardWindowFillTimestamp > currentTimestamp)
		return (
			<>
				{reportingCopy.latestOutcomeCheckLead}
				<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={rewardWindowFillTimestamp} />
				{reportingCopy.confirmationSeparator}
				{selectedOutcomeLabel}
				{reportingCopy.remainingRewardLead}
				{selectedOutcomeLabel}
				{reportingCopy.rewardWindowFilledTail}
			</>
		)
	if (projectedFinalizationTimestamp !== undefined)
		return (
			<>
				{reportingCopy.latestOutcomeCheckLead}
				<TimestampValue {...(currentTimestamp === undefined ? {} : { currentTimestamp })} timestamp={projectedFinalizationTimestamp} />
				{reportingCopy.confirmationSeparator}
				{selectedOutcomeLabel}
				{reportingCopy.leadingOutcomeTail}
			</>
		)
	return <>{reportingCopy.formatReportingLatestOutcomeReminderLater(selectedOutcomeLabel)}</>
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
		reportLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason
	} else if (reportingStageKey === 'resolved') {
		reportLifecycleReason = reportingCopy.poolFinalizedReason
	}
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		settlementLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON
	} else if (activeReportingDetails?.settlementState === 'migration-required') {
		settlementLifecycleReason = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail
	} else if (activeReportingDetails?.settlementState === 'migration-expired') {
		settlementLifecycleReason = reportingCopy.unresolvedMigrationExpiredDetail
	} else if (reportingStageKey === 'activeLocked') {
		settlementLifecycleReason = reportingCopy.questionFinalizationRequired
	}
	const withdrawControlsLockedReason = showSettlementSection && loadingReportingDetails ? reportingCopy.loadingEscalationDeposits : pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
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
	const selectedOutcomeLabel = selectedOutcome === undefined ? reportingCopy.selectedSide : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
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
					{reportingCopy.conditionalLead}
					{selectedOutcomeLabel}
					{reportingCopy.projectedWinPayoutLead}
					<CurrencyValue value={selectedEstimate.profit} suffix={commonCopy.rep} />
					{reportingCopy.profitSeparator}
					{finalizationReminder}
				</>
			)
		}
		if (timerPreview.kind === 'not-started') {
			if (timerPreview.hypotheticalDuration > 0n)
				return (
					<>
						{reportingCopy.uncontestedFinalizationLead}
						{formatDuration(timerPreview.timeUntilStart)}
						{reportingCopy.projectionNotStartedTail}
						{reportingCopy.latestOutcomeCheckLead}
						<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={projectedFinalizationTimestamp} />
						{reportingCopy.confirmationSeparator}
						{selectedOutcomeLabel}
						{reportingCopy.laterDisputeStatusTail}
					</>
				)
			return (
				<>
					{reportingCopy.uncontestedFinalizationLead}
					{formatDuration(timerPreview.timeUntilStart)}
					{reportingCopy.projectionNotStartedTail}
					{finalizationReminder}
				</>
			)
		}
		if (selectedEstimate === undefined || activeReportingDetails === undefined) return undefined
		if (timerPreview.actualState === 'ends-immediately')
			return (
				<>
					{reportingCopy.conditionalLead}
					{selectedOutcomeLabel}
					{reportingCopy.projectedWinPayoutLead}
					<CurrencyValue value={selectedEstimate.profit} suffix={commonCopy.rep} />
					{reportingCopy.profitSeparator}
					{reportingCopy.immediateFinalizationLead}
					{finalizationReminder}
				</>
			)
		const projectedFinalizationDuration = formatDuration(getEscalationTimeRemaining(activeReportingDetails) + (timerPreview.timerIncrease ?? 0n))
		if (timerPreview.actualState === 'extends')
			return (
				<>
					{reportingCopy.conditionalLead}
					{selectedOutcomeLabel}
					{reportingCopy.projectedWinPayoutLead}
					<CurrencyValue value={selectedEstimate.profit} suffix={commonCopy.rep} />
					{reportingCopy.profitSeparator}
					{reportingCopy.timerExtensionLead}
					{formatDuration(timerPreview.timerIncrease ?? 0n)}
					{reportingCopy.uncontestedFinalizationTail}
					{projectedFinalizationDuration}
					{reportingCopy.projectionNotStartedTail}
					{finalizationReminder}
				</>
			)
		return (
			<>
				{reportingCopy.conditionalLead}
				{selectedOutcomeLabel}
				{reportingCopy.projectedWinPayoutLead}
				<CurrencyValue value={selectedEstimate.profit} suffix={commonCopy.rep} />
				{reportingCopy.profitSeparator}
				{reportingCopy.noTimerExtensionProjectionLead}
				{projectedFinalizationDuration}
				{reportingCopy.projectionNotStartedTail}
				{finalizationReminder}
			</>
		)
	}
	const projectedReportingPreview = getProjectedReportingPreview()
	const resultingAvailableReportingRep =
		effectiveReportingDetails?.viewerVaultAvailableEscalationRep === undefined || actualReportDepositAmount === undefined || actualReportDepositAmount > effectiveReportingDetails.viewerVaultAvailableEscalationRep ? undefined : effectiveReportingDetails.viewerVaultAvailableEscalationRep - actualReportDepositAmount
	const reportButtonLabel = selectedOutcome === undefined ? reportingCopy.reportOnSelectedSide : reportingCopy.formatReportSelectedOutcomeButtonLabel(selectedOutcomeLabel)
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const maxProfitContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = (() => {
		if (selectedOutcome === undefined) return { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON }
		if (effectiveReportingDetails === undefined) return { amount: undefined, reason: LOAD_REPORTING_PRESETS_REASON }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep === undefined) return { amount: undefined, reason: reportingCopy.loadingAvailableVaultRep }
		if (effectiveReportingDetails.viewerVaultAvailableEscalationRep <= 0n) return { amount: undefined, reason: reportingCopy.unlockedReportingRepEmpty }
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
		if (selectedSide === undefined) return { amount: undefined, reason: reportingCopy.selectedSideIsUnavailable }
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
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? reportingCopy.reportAmountPreviewRequired : undefined
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
		reportingOpenNotice = selectedOutcome === undefined ? reportingCopy.reportingOutcomeSelectionHint : reportingCopy.reportingOpenDetail
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
				{showTriggerZoltarForkAction ? <TransactionActionButton idleLabel={reportingCopy.triggerZoltarFork} pendingLabel={reportingCopy.triggeringZoltarFork} onClick={onTriggerZoltarFork} pending={triggerZoltarForkPending} tone='primary' availability={resolvedTriggerZoltarForkAvailability} /> : undefined}
				{showForkWorkflowAction ? (
					<button className='secondary' type='button' onClick={onOpenForkWorkflow}>
						{reportingCopy.openForkAndMigration}
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
	const reportingWorkflowSummary = reportingStage?.detail ?? reportingCopy.outcomeSelectionHelpText
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStageBanner !== undefined || reportingOpenNotice !== undefined)
	const sections = (
		<>
			{showFullReporting ? (
				<SectionBlock className='reporting-workflow-section' title={reportingCopy.reportingWorkflow} density='compact' variant='plain'>
					<div className='workflow-summary-strip workflow-guide workflow-guide-compact'>
						<div className='workflow-guide-intro'>
							<p className='detail'>{reportingWorkflowSummary}</p>
						</div>
						<div className='workflow-summary-strip-steps'>
							<span className='current'>{reportingCopy.step1Outcome}</span>
							<span>{reportingCopy.step2LockRep}</span>
							<span>{reportingCopy.step3Settle}</span>
						</div>
					</div>
				</SectionBlock>
			) : undefined}

			{showReportingHeaderStack ? (
				<div className='reporting-header-stack'>
					{showSecurityPoolAddressInput ? (
						<LookupFieldRow
							label={commonCopy.securityPoolAddress}
							value={reportingForm.securityPoolAddress}
							onInput={securityPoolAddress => onReportingFormChange({ securityPoolAddress })}
							placeholder={commonCopy.hexValuePlaceholder}
							action={
								<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails || preOpenLockedReason !== undefined} title={preOpenLockedReason}>
									{loadingReportingDetails ? <LoadingText>{reportingCopy.loadingEscalation}</LoadingText> : reportingCopy.refreshReporting}
								</button>
							}
						/>
					) : undefined}
					{reportingOpenNotice === undefined ? <LifecycleStageBanner stage={reportingStageBanner} /> : <p className='notice success'>{reportingOpenNotice}</p>}
				</div>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-metrics-section' title={reportingCopy.escalationMetrics} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={reportingCopy.nonDecisionThreshold}>
							<CurrencyValue value={effectiveReportingDetails?.nonDecisionThreshold} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={reportingCopy.timeLeft}>{activeReportingDetails === undefined ? commonCopy.metricUnavailablePlaceholder : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label={reportingCopy.escalationStarted}>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
						</MetricField>
						<MetricField label={reportingCopy.startBond}>
							<CurrencyValue value={effectiveReportingDetails?.startBond} suffix={commonCopy.rep} />
						</MetricField>
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock className='reporting-outcome-section' title={reportingCopy.reportOutcome} variant='embedded'>
					<div className='escalation-sides-shell'>
						<div className='escalation-sides-legend'>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-total' />
								<span className='panel-label'>{reportingCopy.totalSideStake}</span>
							</div>
							<div className='escalation-sides-legend-item'>
								<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-user' />
								<span className='panel-label'>{reportingCopy.yourSideStake}</span>
							</div>
							<div className='escalation-sides-legend-item escalation-sides-legend-item-binding'>
								<span aria-hidden='true' className='escalation-sides-legend-marker' />
								<span className='panel-label'>{reportingCopy.leadHoldingCapital}</span>
								<CurrencyValue copyable={false} value={displayBindingCapital} suffix={commonCopy.rep} />
							</div>
						</div>
						<div className='escalation-sides' role='radiogroup' aria-label={reportingCopy.reportOutcomeAriaLabel}>
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
							{reportingCopy.availableUnlockedVaultRepForReporting} <CurrencyValue value={effectiveReportingDetails.viewerVaultAvailableEscalationRep} suffix={commonCopy.rep} />.
						</p>
					)}
					<div className='field'>
						<label htmlFor='reporting-contribution-amount'>
							<span>{reportingCopy.contributionAmountRep}</span>
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
								{commonCopy.max}
							</button>
						</div>
						<p className='field-help'>{reportingCopy.escalationDepositHelpText}</p>
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
							{reportingCopy.minToTakeTheLead}
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
							{reportingCopy.maxProfit}
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
							{reportingCopy.currentEscalationLockLead}
							<CurrencyValue value={actualReportDepositAmount} suffix={commonCopy.rep} />
							{reportingCopy.acceptedAmountTail}
						</p>
					)}
					<TransactionReview
						primary={[
							{ label: reportingCopy.repPlacedAtRisk, value: <CurrencyValue value={actualReportDepositAmount} suffix={commonCopy.rep} /> },
							{ label: reportingCopy.backedOutcome, value: selectedOutcome === undefined ? reportingCopy.selectedSide : selectedOutcomeLabel },
						]}
						details={[
							{ label: reportingCopy.currentTentativeOutcome, value: leadingOutcome === undefined ? reportingCopy.pendingFinalization : getReportingOutcomeLabel(leadingOutcome) },
							{ label: reportingCopy.timerEffect, value: projectedReportingPreview ?? commonCopy.metricUnavailablePlaceholder },
							{ label: reportingCopy.availableVaultRepAfterReport, value: <CurrencyValue value={resultingAvailableReportingRep} suffix={commonCopy.rep} /> },
							{ label: transactionReviewCopy.protocolFee, value: transactionReviewCopy.noProtocolFee },
							{ label: transactionReviewCopy.contract, value: effectiveReportingDetails === undefined ? commonCopy.unavailable : <AddressValue address={effectiveReportingDetails.securityPoolAddress} /> },
							{ label: transactionReviewCopy.network, value: transactionReviewCopy.ethereumMainnet },
						]}
						risks={[reportingCopy.ifThisSideLoses, reportingCopy.reportingLockRisk, reportingCopy.reportTimerRisk]}
					/>
					<div className='actions'>
						<TransactionActionButton
							idleLabel={reportButtonLabel}
							pendingLabel={reportingCopy.submittingReport}
							onClick={onReportOutcome}
							pending={reportingActiveAction === 'reportOutcome'}
							availability={{ disabled: !isMainnet || !reportOutcomeEnabled || reportGuardMessage !== undefined, reason: !isMainnet ? commonCopy.mainnetRequiredReason : reportGuardMessage }}
						/>
					</div>
					{projectedReportingPreview === undefined ? undefined : <p className='detail'>{projectedReportingPreview}</p>}
				</SectionBlock>
			) : undefined}

			{showSettlementSection ? (
				<SectionBlock className='reporting-settlement-section' title={reportingCopy.settleEscalationDeposits} variant='embedded'>
					{reportingStageKey === 'forkTriggered' ? <p className='detail'>{forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' ? <p className='detail'>{forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-expired' ? <p className='detail'>{reportingCopy.unresolvedMigrationExpiredDetail}</p> : undefined}
					{hasImportedForkedDeposits ? <p className='detail'>{reportingCopy.forkCarriedSettlementRedirectDetail}</p> : undefined}
					{loadingReportingDetails ? (
						<p className='detail'>
							<LoadingText>{reportingCopy.loadingEscalationDepositsDetail}</LoadingText>
						</p>
					) : undefined}
					{shouldShowWithdrawEmptyState && activeReportingDetails?.settlementState !== 'migration-required' && activeReportingDetails?.settlementState !== 'migration-expired' ? <p className='detail'>{reportingCopy.walletUnsettledDepositsEmpty}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
						? undefined
						: withdrawableSides.map(side => {
								const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key]
								const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex)
								const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key)
								const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : reportingCopy.settlementSelectionRequired)
								const isPendingSide = withdrawActionPending && pendingWithdrawOutcome === side.key

								return (
									<SectionBlock key={side.key} density='compact' headingLevel={4} title={side.label} variant='embedded'>
										<div className='field'>
											<span>{reportingCopy.chooseDepositsToSettle}</span>
											<EscalationDepositSelectionList
												disabled={withdrawControlsLocked || withdrawActionPending}
												items={side.userDeposits.map(deposit => {
													const claimAmount = getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit)
													return {
														deposit,
														details: [
															<>
																{reportingCopy.initiallyDeposited} <CurrencyValue value={deposit.amount} suffix={commonCopy.rep} />
															</>,
															claimAmount === undefined ? (
																reportingCopy.worthAfterFinalizationPendingFinalization
															) : (
																<>
																	{reportingCopy.worthNow} <CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
																</>
															),
															`${reportingCopy.currentClaimType} ${claimLabel ?? reportingCopy.pendingFinalization}`,
															<>
																{reportingCopy.entryDepth} <CurrencyValue value={deposit.cumulativeAmount} suffix={commonCopy.rep} />
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
												idleLabel={reportingCopy.formatSettleSelectedDepositsLabel(side.label)}
												pendingLabel={reportingCopy.formatSettlingDepositsPendingLabel(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, selectedWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												tone='secondary'
												availability={{ disabled: !isMainnet || !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, reason: withdrawSelectedGuardMessage }}
											/>
											<TransactionActionButton
												idleLabel={reportingCopy.formatSettleAllDepositsLabel(side.label)}
												pendingLabel={reportingCopy.formatSettlingDepositsPendingLabel(side.label)}
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
		<RouteWorkflowPanel showHeader={showHeader} title={reportingCopy.reportingWorkflow}>
			{sections}
		</RouteWorkflowPanel>
	)
}
