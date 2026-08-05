import * as commonCopy from '../../../copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { EscalationSide } from './EscalationSide.js'
import { LifecycleStageBanner } from '../../security-pools/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingAwareText, LoadingText } from '../../../components/LoadingText.js'
import { MetricField } from '../../../components/MetricField.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { TransactionUniverseValue } from '../../universes/components/TransactionUniverseValue.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { WarningSurface } from '../../../components/WarningSurface.js'
import { assertNever } from '../../../lib/assert.js'
import { pickFirstReason } from '../../../lib/actionAvailability.js'
import { formatCurrencyInputBalance, formatDuration } from '../../../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../../markets/lib/marketForm.js'
import { getWrongNetworkMessage, isActiveAppChain } from '../../../lib/network.js'
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
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.presetDetailsRequired
const MAX_PROFIT_NOT_STARTED_REASON = reportingCopy.maxProfitPrestartReason
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
function isRedundantPresetReason(reason: string | undefined) {
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === MAX_PROFIT_NOT_STARTED_REASON || reason === SELECT_OUTCOME_PRESET_REASON || reason === SELECTED_SIDE_ALREADY_LEADS_REASON || reason === MAX_PROFIT_WINDOW_FILLED_REASON
}
function getOutcomeSides(reportingDetails: ReportingDetails | undefined) {
	if (reportingDetails?.status === 'active')
		return reportingDetails.sides.map<EscalationSideDisplay>(side => ({
			balance: side.balance,
			key: side.key,
			label: side.label,
			userDeposits: side.userDeposits,
			userStake: side.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n),
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
	onOpenPriceOracle,
	onTriggerZoltarFork,
	onReportOutcome,
	onReportingFormChange,
	onWithdrawEscalation,
	previewMarketDetails,
	reportingActiveAction,
	reportingDetails,
	reportingError,
	reportingForm,
	reportActionGuardMessage,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	mode = 'full-reporting',
	triggerZoltarForkAvailability,
	triggerZoltarForkPending = false,
}: ReportingSectionProps) {
	const presetBlockerId = useId()
	const reportingStageDetailId = useId()
	const settlementDisabledReasonId = useId()
	const lastTimedOutRefreshBoundaryKey = useRef<string | undefined>(undefined)
	const [pendingWithdrawOutcome, setPendingWithdrawOutcome] = useState<ReportingOutcomeKey | undefined>(undefined)
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
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
	const fullReportingLoadingReason = showFullReporting && loadingReportingDetails ? reportingCopy.reportingDetailsRequired : undefined
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(fullReportingLoadingReason, lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		settlementLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON
	} else if (reportingStageKey === 'timedOut') {
		settlementLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason
	} else if (activeReportingDetails?.settlementState === 'migration-required') {
		settlementLifecycleReason = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail
	} else if (activeReportingDetails?.settlementState === 'migration-expired') {
		settlementLifecycleReason = reportingCopy.unresolvedMigrationExpiredDetail
	} else if (reportingStageKey === 'activeLocked') {
		settlementLifecycleReason = reportingCopy.questionFinalizationRequired
	}
	let withdrawControlsLockedReason: string | undefined
	if (showSettlementSection && loadingReportingDetails) {
		withdrawControlsLockedReason = showFullReporting ? reportingCopy.reportingDetailsRequired : reportingCopy.loadingEscalationDeposits
	} else {
		withdrawControlsLockedReason = pickFirstReason(lockedReason, reportingState.reportingStage === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
	}
	let settlementContextMessage: string | undefined
	if (activeReportingDetails?.settlementState === 'migration-required') settlementContextMessage = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail
	else if (activeReportingDetails?.settlementState === 'migration-expired') settlementContextMessage = reportingCopy.unresolvedMigrationExpiredDetail
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
	const reportingTimerChange = (() => {
		if (timerPreview === undefined) return undefined
		if (timerPreview.kind === 'not-started') return reportingCopy.startsEscalation
		if (timerPreview.actualState === 'ends-immediately') return reportingCopy.finalizesImmediately
		if (timerPreview.actualState === 'extends') return reportingCopy.formatTimerExtension(formatDuration(timerPreview.timerIncrease ?? 0n))
		return reportingCopy.noTimerChange
	})()
	const reportingRecheckTimestamp = rewardWindowFillTimestamp !== undefined && effectiveCurrentTimestamp !== undefined && rewardWindowFillTimestamp > effectiveCurrentTimestamp ? rewardWindowFillTimestamp : projectedFinalizationTimestamp
	const resultingAvailableReportingRep =
		effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep === undefined || actualReportDepositAmount === undefined || actualReportDepositAmount > effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep
			? undefined
			: effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep - actualReportDepositAmount
	const reportButtonLabel = selectedOutcome === undefined ? reportingCopy.reportOnSelectedSide : reportingCopy.formatReportSelectedOutcomeButtonLabel(selectedOutcomeLabel)
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const maxProfitContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const presetBlocker = reportControlsLocked ? undefined : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].find(reason => reason !== undefined && !isRedundantPresetReason(reason))
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = (() => {
		if (selectedOutcome === undefined) return { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON }
		if (effectiveReportingDetails === undefined) return { amountAttoRep: undefined, reason: LOAD_REPORTING_PRESETS_REASON }
		if (effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep === undefined) return { amountAttoRep: undefined, reason: reportingCopy.loadingPoolHeldVaultRepBacking }
		if (effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep <= 0n) return { amountAttoRep: undefined, reason: reportingCopy.poolHeldVaultRepBackingEmpty }
		if (remainingSelectedOutcomeCapacity !== undefined && remainingSelectedOutcomeCapacity <= 0n) return { amountAttoRep: undefined, reason: NO_SELECTED_SIDE_CAPACITY_REASON }
		if (effectiveReportingDetails.status === 'not-started') {
			const cappedAmount = remainingSelectedOutcomeCapacity === undefined || effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep < remainingSelectedOutcomeCapacity ? effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep : remainingSelectedOutcomeCapacity
			if (cappedAmount < effectiveReportingDetails.startBondAttoRep) return { amountAttoRep: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON }
			return {
				amountAttoRep: cappedAmount,
				reason: undefined,
			}
		}
		const selectedSide = effectiveReportingDetails.sides.find(side => side.key === selectedOutcome)
		if (selectedSide === undefined) return { amountAttoRep: undefined, reason: reportingCopy.selectedSideIsUnavailable }
		const maxContributionPreview = previewReportingContribution(effectiveReportingDetails, selectedOutcome, effectiveReportingDetails.nonDecisionThresholdAttoRep - selectedSide.balance)
		if (maxContributionPreview.actualDepositAmount === undefined) return { amountAttoRep: undefined, reason: maxContributionPreview.reason }
		let cappedAmount = maxContributionPreview.actualDepositAmount
		if (cappedAmount > effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep) cappedAmount = effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep
		if (remainingSelectedOutcomeCapacity !== undefined && cappedAmount > remainingSelectedOutcomeCapacity) cappedAmount = remainingSelectedOutcomeCapacity
		if (cappedAmount < effectiveReportingDetails.startBondAttoRep) return { amountAttoRep: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON }
		return {
			amountAttoRep: cappedAmount,
			reason: undefined,
		}
	})()
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? reportingCopy.reportAmountPreviewRequired : undefined
	const reportGuardMessage =
		fullReportingLoadingReason ??
		reportActionGuardMessage ??
		reportControlsLockedReason ??
		getReportingReportGuardMessage({
			actualDepositAmount: actualReportDepositAmount,
			accountAddress: accountState.address,
			contributionPreviewReason: reportContributionPreview?.reason,
			isOnActiveAppChain,
			remainingSelectedOutcomeCapacity,
			reportAmount: reportingForm.reportAmount,
			reportingStatus,
			selectedOutcome,
			selectedAmount,
			viewerPoolHeldVaultRepBackingAttoRep: effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep,
			viewerVaultExists: effectiveReportingDetails?.viewerVaultExists ?? false,
		})
	const reportButtonGuardMessage = fullReportingLoadingReason ?? (reportActionGuardMessage === undefined ? reportGuardMessage : reportingCopy.currentOraclePriceRequired)
	const reportActionDisabledReason = !isOnActiveAppChain ? (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) : reportButtonGuardMessage
	const withdrawGuardMessage =
		withdrawControlsLockedReason ??
		getReportingWithdrawGuardMessage({
			accountAddress: accountState.address,
			isOnActiveAppChain,
			reportingStatus,
		})
	let displayedWithdrawGuardMessage = withdrawGuardMessage
	if (loadingReportingDetails) {
		displayedWithdrawGuardMessage = showFullReporting ? reportingCopy.reportingDetailsRequired : reportingCopy.loadingEscalationDepositsDetail
	}
	const reportOutcomeSelectionMessage = showFullReporting && reportingStatus !== 'missing' && selectedOutcome === undefined && !reportControlsLocked ? SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE : undefined
	let reportingOpenNotice: string | undefined
	if (showFullReporting && reportingStatus === 'not-started' && effectiveReportingDetails?.questionOutcome === 'none') {
		reportingOpenNotice = reportingCopy.reportingOpenDetail
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
	const sharedReportSettlementDisabledReason = showFullReporting && reportActionDisabledReason !== undefined && reportActionDisabledReason === displayedWithdrawGuardMessage ? reportActionDisabledReason : undefined
	let sharedReportSettlementDisabledReasonId: string | undefined
	if (sharedReportSettlementDisabledReason !== undefined) {
		sharedReportSettlementDisabledReasonId = reportingStageBanner?.detail === sharedReportSettlementDisabledReason ? reportingStageDetailId : settlementDisabledReasonId
	}
	const shouldRenderSharedReportSettlementDisabledReason = sharedReportSettlementDisabledReason !== undefined && sharedReportSettlementDisabledReasonId === settlementDisabledReasonId
	const reportDisabledReasonElementId = sharedReportSettlementDisabledReasonId ?? (reportingStageBanner?.detail === reportActionDisabledReason ? reportingStageDetailId : undefined)
	const settlementActionDisabledReasonId = sharedReportSettlementDisabledReasonId ?? settlementDisabledReasonId
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStageBanner !== undefined || reportingOpenNotice !== undefined)
	const sections = (
		<>
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
					{reportingOpenNotice === undefined ? <LifecycleStageBanner detailId={reportingStageDetailId} flat stage={reportingStageBanner} /> : <p className='notice success'>{reportingOpenNotice}</p>}
				</div>
			) : undefined}

			{showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-metrics-section' title={reportingCopy.escalationMetrics} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={reportingCopy.nonDecisionThresholdAttoRep}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.nonDecisionThresholdAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={reportingCopy.timeLeft}>{activeReportingDetails === undefined ? commonCopy.metricUnavailablePlaceholder : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label={reportingCopy.escalationStarted}>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
						</MetricField>
						<MetricField label={reportingCopy.startBondAttoRep}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.startBondAttoRep} suffix={commonCopy.rep} />
						</MetricField>
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-outcome-section' title={reportingCopy.reportOutcome} variant='embedded'>
					{reportActionGuardMessage === undefined ? undefined : (
						<WarningSurface ariaLive='polite' role='status' surface='flat' variant='compact'>
							<p>{reportActionGuardMessage}</p>
							{onOpenPriceOracle === undefined ? undefined : (
								<div className='actions'>
									<button className='secondary' type='button' onClick={onOpenPriceOracle}>
										{reportingCopy.managePoolPrice}
									</button>
								</div>
							)}
						</WarningSurface>
					)}
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
					{effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep === undefined ? undefined : (
						<p className='detail'>
							{reportingCopy.availablePoolHeldVaultRepBackingForReporting} <CurrencyValue value={effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep} suffix={commonCopy.rep} />.
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
									if (maxContributionAmount.amountAttoRep === undefined) return
									onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxContributionAmount.amountAttoRep) })
								}}
								disabled={reportControlsLocked || maxContributionAmount.amountAttoRep === undefined}
								title={reportControlsLocked ? reportControlsLockedReason : maxContributionAmount.reason}
							>
								{commonCopy.max}
							</button>
						</div>
					</div>

					<div className='actions'>
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (minimumOutcomeChangeContribution.amountAttoRep === undefined) return
								onReportingFormChange({ reportAmount: formatCurrencyInputBalance(minimumOutcomeChangeContribution.amountAttoRep) })
							}}
							disabled={reportControlsLocked || minimumOutcomeChangeContribution.amountAttoRep === undefined}
							aria-describedby={presetBlocker !== undefined && minimumOutcomeChangeContribution.reason === presetBlocker ? presetBlockerId : undefined}
							title={reportControlsLocked ? reportControlsLockedReason : minimumOutcomeChangeContribution.reason}
						>
							{reportingCopy.minToTakeTheLead}
						</button>
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (maxProfitContribution.amountAttoRep === undefined) return
								onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxProfitContribution.amountAttoRep) })
							}}
							disabled={reportControlsLocked || maxProfitContribution.amountAttoRep === undefined}
							aria-describedby={presetBlocker !== undefined && maxProfitContribution.reason === presetBlocker ? presetBlockerId : undefined}
							title={reportControlsLocked ? reportControlsLockedReason : maxProfitContribution.reason}
						>
							{reportingCopy.maxProfit}
						</button>
					</div>
					{presetBlocker === undefined ? undefined : (
						<p id={presetBlockerId} className='detail'>
							{presetBlocker}
						</p>
					)}

					{reportAmountError === undefined ? undefined : <p className='detail'>{reportAmountError}</p>}
					{actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (
						<p className='detail'>
							{reportingCopy.currentEscalationDisputeStakeLead}
							<CurrencyValue value={actualReportDepositAmount} suffix={commonCopy.rep} />
							{reportingCopy.acceptedAmountTail}
						</p>
					)}
					<TransactionReview
						context={[
							{ label: commonCopy.question, value: marketDetails?.title ?? commonCopy.unavailable },
							{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={effectiveReportingDetails?.universeId} /> },
						]}
						primary={[
							{ label: reportingCopy.disputeStakedRepAfterReport, value: <CurrencyValue value={actualReportDepositAmount} suffix={commonCopy.rep} /> },
							{ label: reportingCopy.backedOutcome, value: selectedOutcome === undefined ? reportingCopy.selectedSide : selectedOutcomeLabel },
						]}
						details={[
							{ label: reportingCopy.formatEstimatedProfitLabel(selectedOutcomeLabel), value: selectedEstimate === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={selectedEstimate.profit} suffix={commonCopy.rep} /> },
							{ label: reportingCopy.timerChange, value: reportingTimerChange ?? commonCopy.metricUnavailablePlaceholder },
							{
								label: reportingCopy.recheckBy,
								value: reportingRecheckTimestamp === undefined ? commonCopy.metricUnavailablePlaceholder : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={reportingRecheckTimestamp} />,
							},
							{ label: reportingCopy.poolHeldVaultRepBackingAfterReport, value: <CurrencyValue value={resultingAvailableReportingRep} suffix={commonCopy.rep} /> },
							{ label: reportingCopy.assumption, value: reportingCopy.projectionAssumption },
						]}
						risks={[reportingCopy.reportingDisputeStakeRisk, reportingCopy.reportTimerRisk, reportingCopy.escalationClaimNonTradeableDetail]}
						technicalDetails={[
							{ label: transactionReviewCopy.protocolFee, value: transactionReviewCopy.noProtocolFee },
							{ label: transactionReviewCopy.contract, value: effectiveReportingDetails === undefined ? commonCopy.unavailable : <AddressValue address={effectiveReportingDetails.securityPoolAddress} /> },
							{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
						]}
					/>
					<div className='reporting-shared-action-region'>
						{shouldRenderSharedReportSettlementDisabledReason ? (
							<p className='detail' id={settlementDisabledReasonId}>
								<LoadingAwareText>{sharedReportSettlementDisabledReason}</LoadingAwareText>
							</p>
						) : undefined}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={reportButtonLabel}
								pendingLabel={reportingCopy.submittingReport}
								onClick={onReportOutcome}
								pending={reportingActiveAction === 'reportOutcome'}
								availability={{ disabled: !isOnActiveAppChain || !reportOutcomeEnabled || reportButtonGuardMessage !== undefined, reason: reportActionDisabledReason }}
								disabledReasonElementId={reportDisabledReasonElementId}
								showDisabledReason={reportDisabledReasonElementId === undefined}
							/>
						</div>
					</div>
				</SectionBlock>
			) : undefined}

			{showSettlementSection && reportingReady !== false ? (
				<SectionBlock className='reporting-settlement-section' title={reportingCopy.settleEscalationDeposits} variant='embedded'>
					{displayedWithdrawGuardMessage === undefined || displayedWithdrawGuardMessage === sharedReportSettlementDisabledReason ? undefined : (
						<p className='detail' id={settlementDisabledReasonId}>
							<LoadingAwareText>{displayedWithdrawGuardMessage}</LoadingAwareText>
						</p>
					)}
					{settlementContextMessage === undefined || settlementContextMessage === withdrawGuardMessage ? undefined : <p className='detail'>{settlementContextMessage}</p>}
					{hasImportedForkedDeposits ? <p className='detail'>{reportingCopy.forkCarriedSettlementRedirectDetail}</p> : undefined}
					{shouldShowWithdrawEmptyState && activeReportingDetails?.settlementState !== 'migration-required' && activeReportingDetails?.settlementState !== 'migration-expired' ? <p className='detail'>{reportingCopy.walletUnsettledDepositsEmpty}</p> : undefined}
					{activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
						? undefined
						: withdrawableSides.map(side => {
								const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key]
								const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex)
								const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key)
								const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : reportingCopy.settlementSelectionRequired)
								const withdrawSelectedUsesSharedReason = withdrawGuardMessage !== undefined && withdrawSelectedGuardMessage === withdrawGuardMessage
								const withdrawAllUsesSharedReason = withdrawGuardMessage !== undefined
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
																{reportingCopy.initiallyDeposited} <CurrencyValue value={deposit.amountAttoRep} suffix={commonCopy.rep} />
															</>,
															claimAmount === undefined ? (
																reportingCopy.worthAfterFinalizationPendingFinalization
															) : (
																<>
																	{reportingCopy.worthNow} <CurrencyValue value={claimAmount} suffix={commonCopy.rep} />
																</>
															),
														],
														secondaryDetails: [
															`${reportingCopy.currentClaimType} ${claimLabel ?? reportingCopy.pendingFinalization}`,
															<>
																{reportingCopy.entryDepth} <CurrencyValue value={deposit.cumulativeAmountAttoRep} suffix={commonCopy.rep} />
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
												disabledReasonElementId={withdrawSelectedUsesSharedReason ? settlementActionDisabledReasonId : undefined}
												tone='secondary'
												availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, reason: withdrawSelectedGuardMessage }}
												showDisabledReason={!withdrawSelectedUsesSharedReason}
											/>
											<TransactionActionButton
												idleLabel={reportingCopy.formatSettleAllDepositsLabel(side.label)}
												pendingLabel={reportingCopy.formatSettlingDepositsPendingLabel(side.label)}
												onClick={() => handleWithdrawEscalation(side.key, allWithdrawDepositIndexes)}
												pending={isPendingSide}
												disabled={withdrawActionPending && pendingWithdrawOutcome !== side.key}
												disabledReasonElementId={withdrawAllUsesSharedReason ? settlementActionDisabledReasonId : undefined}
												tone='secondary'
												availability={{ disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }}
												showDisabledReason={!withdrawAllUsesSharedReason}
											/>
										</div>
									</SectionBlock>
								)
							})}
				</SectionBlock>
			) : undefined}
			{forkTriggeredActions}

			<ErrorNotice message={reportingError} />
			{reportingError === undefined || showSecurityPoolAddressInput ? undefined : (
				<div className='actions'>
					<button className='secondary' disabled={loadingReportingDetails} onClick={onLoadReporting} type='button'>
						{loadingReportingDetails ? <LoadingText>{reportingCopy.loadingEscalation}</LoadingText> : reportingCopy.retryReporting}
					</button>
				</div>
			)}
		</>
	)
	if (embedInCard) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={reportingCopy.reportingWorkflow}>
			{sections}
		</RouteWorkflowPanel>
	)
}
