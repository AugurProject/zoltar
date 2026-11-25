import { getReportingSubmissionTimingGuard } from '../../../protocol/reportingTiming.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ReportingDepositPreview } from './ReportingDepositPreview.js'
import { getDisplayedLeadingEscalationOutcome, getReportingLockedUntilMessage, getReportingOutcomeLabel, hasReportingOpened, deriveReportingStage, isReportingOutcomeEnabled, isWithdrawEscalationEnabled } from '../lib/reporting.js'
import { ReportingViewerStatus } from './ReportingViewerStatus.js'
import { EscalationReminderLine } from './EscalationReminderLine.js'
import { EscalationExplainer } from './EscalationExplainer.js'
import { formatReportingDeadline } from '../lib/reportingViewerStatus.js'
import { EscalationPhaseStepper } from './EscalationPhaseStepper.js'
import { ReportingResultCard } from './ReportingResultCard.js'
import { ReportingSides } from './ReportingSides.js'
import { getOutcomeSides, ReportingOutcomePicker } from './ReportingOutcomePicker.js'
import { useKeyedConfirmation } from '../hooks/useKeyedConfirmation.js'
import { getReportingMaxContribution } from '../lib/reportingMaxContribution.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import * as glossaryCopy from '../../../copy/glossary.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { RepAmount } from './RepAmount.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { getActiveAppChainWalletBlocker, withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { pickFirstReason } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration, formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import { parseOptionalRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getWrongNetworkReason, isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getEscalationPhase, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, getRemainingSelectedOutcomeContributionCapacity, getSecondLargestEscalationBalance, isPoolQuestionFinalized, previewReportingContribution, reportingContributionTriggersFork } from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { getEffectiveReportingDetails, getEscalationGameStartTimestamp, getReportingStagePresentation } from '../lib/reportingStagePresentation.js'
import { ReportingSettlementSection } from './ReportingSettlementSection.js'
import { ForkTriggeredActions } from './ForkTriggeredActions.js'
import { useOldActionDataNotice } from '../../useStatoblastPageRefresh.js'
import { GlossaryTerm } from '../../glossary/components/GlossaryTerm.js'
import type { ReportingSectionProps } from '../../oracleTypes.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
function formatInheritedAttritionElapsed(elapsed: bigint | undefined) {
	if (elapsed === undefined) return commonCopy.metricUnavailablePlaceholder
	return elapsed < 0n ? reportingCopy.attritionBeginsAfter(formatDuration(-elapsed)) : formatDuration(elapsed)
}
function formatKnownAmount(amount: bigint | undefined) {
	return amount === undefined ? commonCopy.metricUnavailablePlaceholder : formatCurrencyBalance(amount)
}
type ReportingStatus = 'active' | 'missing' | 'not-started'
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.loadingReportingDetails
const SELECT_OUTCOME_PRESET_REASON = reportingCopy.presetOutcomeSelectionRequired
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = reportingCopy.reportingActivationHint
function isRedundantPresetReason(reason: string | undefined) {
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === SELECT_OUTCOME_PRESET_REASON
}
export function ReportingSection({
	accountState,
	actionDataReadAt,
	oracleBlocker,
	currentTimestamp,
	embedInCard = false,
	designedOverview = false,
	manageDeadlineRefresh = true,
	forkAlreadyTriggered = false,
	loadingReportingDetails,
	lockedReason,
	onApproveReportingRep,
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
	showLifecycle = true,
	allowInProgressClaims = true,
	mode = 'full-reporting',
	triggerZoltarForkApproval,
	triggerZoltarForkAvailability,
	triggerZoltarForkPending = false,
}: ReportingSectionProps) {
	const oldActionData = useOldActionDataNotice(actionDataReadAt)
	const presetBlockerId = useId()
	const reportingStageDetailId = useId()
	const reportDisabledReasonId = useId()
	// Which side is settling stays here so the settlement section can unmount and remount without losing the pending marker.
	const [pendingWithdrawOutcome, setPendingWithdrawOutcome] = useState<ReportingOutcomeKey | undefined>(undefined)
	const handleWithdrawEscalation = (outcome: ReportingOutcomeKey, depositIndexes?: bigint[]) => {
		setPendingWithdrawOutcome(outcome)
		onWithdrawEscalation(outcome, depositIndexes)
	}
	useEffect(() => {
		if (reportingActiveAction === 'withdrawEscalation') return
		setPendingWithdrawOutcome(undefined)
	}, [reportingActiveAction])
	const settlementDisabledReasonId = useId()
	const lastTimedOutRefreshBoundaryKey = useRef<string | undefined>(undefined)
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const walletBlocker = getActiveAppChainWalletBlocker({ accountAddress: accountState.address, isOnActiveAppChain })
	const reportActionButtonRef = useRef<HTMLButtonElement>(null)
	const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime
	const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp)
	const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined
	const escalationPhase = activeReportingDetails === undefined ? undefined : getEscalationPhase(activeReportingDetails)
	const escalationGameStartTimestamp = getEscalationGameStartTimestamp(activeReportingDetails?.activationTime)
	const inactiveCountdown = effectiveReportingDetails === undefined ? commonCopy.metricUnavailablePlaceholder : reportingCopy.startsWithFirstReport
	const reportingStatus: ReportingStatus = effectiveReportingDetails === undefined ? 'missing' : effectiveReportingDetails.status
	const marketDetails = effectiveReportingDetails?.marketDetails ?? previewMarketDetails
	const showFullReporting = mode === 'full-reporting'
	const showWithdrawOnly = mode === 'withdraw-only'
	const showSettlementSection = showWithdrawOnly || (showFullReporting && (allowInProgressClaims || activeReportingDetails?.settlementState === 'resolved'))
	const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp)
	const preOpenLockedReason = lockedReason ?? (reportingReady === false && marketDetails !== undefined && effectiveCurrentTimestamp !== undefined ? getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp) : undefined)
	const reportingStageKey = deriveReportingStage({
		reportingDetails: effectiveReportingDetails,
		reportingReady,
	})
	const reportOutcomeEnabled = isReportingOutcomeEnabled(reportingStageKey)
	const withdrawEscalationEnabled = isWithdrawEscalationEnabled(reportingStageKey)
	let reportLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		reportLifecycleReason = forkAlreadyTriggered ? reportingCopy.forkAlreadyTriggeredReportReason : reportingCopy.forkTriggerInstruction
	} else if (reportingStageKey === 'timedOut') {
		reportLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason
	} else if (reportingStageKey === 'resolved') {
		reportLifecycleReason = reportingCopy.poolFinalizedReason
	}
	const fullReportingLoadingReason = showFullReporting && loadingReportingDetails ? reportingCopy.loadingReportingDetails : undefined
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(fullReportingLoadingReason, effectiveReportingDetails?.reportingBlockedReason, reportActionGuardMessage, lockedReason, reportingStageKey === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
	const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined
	let settlementLifecycleReason: string | undefined
	if (reportingStageKey === 'forkTriggered') {
		settlementLifecycleReason = forkAlreadyTriggered ? reportingCopy.forkAlreadyTriggeredSettlementReason : reportingCopy.forkRequiredSettlementReason
	} else if (reportingStageKey === 'timedOut') {
		settlementLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason
	} else if (activeReportingDetails?.settlementState === 'migration-required') {
		settlementLifecycleReason = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail
	} else if (reportingStageKey === 'activeLocked') {
		settlementLifecycleReason = reportingCopy.questionFinalizationRequired
	}
	let withdrawControlsLockedReason: string | undefined
	if (showSettlementSection && loadingReportingDetails) {
		withdrawControlsLockedReason = showFullReporting ? reportingCopy.loadingReportingDetails : reportingCopy.loadingEscalationDeposits
	} else {
		withdrawControlsLockedReason = pickFirstReason(lockedReason, reportingStageKey === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
	}
	let settlementContextMessage: string | undefined
	if (activeReportingDetails?.settlementState === 'migration-required') settlementContextMessage = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail
	const withdrawControlsLocked = !withdrawEscalationEnabled || withdrawControlsLockedReason !== undefined
	const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount)
	const selectedOutcome = reportingForm.selectedOutcome
	const selectedWithdrawDepositIndexesByOutcome = reportingForm.selectedWithdrawDepositIndexesByOutcome
	let displayBindingCapital: bigint | undefined
	if (effectiveReportingDetails !== undefined) {
		displayBindingCapital = effectiveReportingDetails.status === 'not-started' ? 0n : effectiveReportingDetails.bindingCapital
	}
	const outcomeSides = getOutcomeSides(effectiveReportingDetails)
	const chartScaleMax = effectiveReportingDetails?.nonDecisionThresholdAttoRep
	const forkProgressBalance = getSecondLargestEscalationBalance(outcomeSides)
	const finalized = isPoolQuestionFinalized(effectiveReportingDetails)
	const leadingOutcome = activeReportingDetails === undefined || (escalationPhase === 'Timed Out' && !finalized) ? undefined : getDisplayedLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const walletDepositAmount = actualReportDepositAmount
	const selectedOutcomeLabel = selectedOutcome === undefined ? reportingCopy.selectedSide : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
	const availableReportingRep = effectiveReportingDetails?.viewerWalletRepBalanceAttoRep
	const reportTriggersFork = reportingContributionTriggersFork(effectiveReportingDetails, selectedOutcome, selectedAmount)
	// A confirmation covers one exact fork-triggering report; any change to the pool, side, or amount asks again.
	const forkConfirmation = useKeyedConfirmation(reportTriggersFork ? `${effectiveReportingDetails?.questionLedgerAddress ?? ''}:${selectedOutcome ?? ''}:${selectedAmount?.toString() ?? ''}` : undefined)
	const reportDisplayAmount = formatCurrencyBalance(actualReportDepositAmount ?? selectedAmount ?? 0n)
	const reportButtonLabel = selectedOutcome === undefined ? reportingCopy.reportOnSelectedSide : commonCopy.launchAction((reportTriggersFork ? reportingCopy.reportAndTriggerForkLabel : reportingCopy.reportAmountLabel)(selectedOutcomeLabel, reportDisplayAmount))
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const minimumPresetAmount = minimumOutcomeChangeContribution.amountAttoRep ?? (effectiveReportingDetails?.status === 'not-started' ? effectiveReportingDetails.startBondAttoRep : undefined)
	let minimumPresetKind: Parameters<typeof reportingCopy.minimumPreset>[0] = reportingStatus === 'active' ? 'lead' : 'start'
	if (reportingContributionTriggersFork(effectiveReportingDetails, selectedOutcome, minimumOutcomeChangeContribution.amountAttoRep)) minimumPresetKind = 'fork'
	const maxProfitContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const presetBlocker = reportControlsLocked ? undefined : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].find(reason => reason !== undefined && !isRedundantPresetReason(reason))
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = getReportingMaxContribution({ availableReportingRep, details: effectiveReportingDetails, forkConfirmed: forkConfirmation.confirmed, selectedOutcome, usesWalletFunding: true })
	const presetReasons = [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason, maxContributionAmount.reason].filter((reason, index, reasons) => reason !== undefined && !isRedundantPresetReason(reason) && reason !== presetBlocker && reasons.indexOf(reason) === index)
	const reportGuardParameters = {
		actualDepositAmount: actualReportDepositAmount,
		accountAddress: accountState.address,
		walletDepositAmount,
		contributionPreviewReason: reportContributionPreview?.reason,
		isOnActiveAppChain,
		remainingSelectedOutcomeCapacity,
		reportAmount: reportingForm.reportAmount,
		reportingStatus,
		selectedOutcome,
		selectedAmount,
		viewerWalletRepAllowanceAttoRep: effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep,
		viewerWalletRepBalanceAttoRep: effectiveReportingDetails?.viewerWalletRepBalanceAttoRep,
	}
	const forkConfirmationReason = reportTriggersFork && !forkConfirmation.confirmed ? reportingCopy.forkTriggerConfirmationRequired : undefined
	const reportPrerequisiteReason = getReportingReportGuardMessage(reportGuardParameters)
	// The fork confirmation and the REP approval are independent steps, so when both are missing the reason names both instead of hiding the confirmation behind the approval.
	const reportReadinessReason = forkConfirmationReason !== undefined && reportPrerequisiteReason === reportingCopy.reportingRepApprovalRequired ? reportingCopy.forkTriggerConfirmationAndApprovalRequired : (reportPrerequisiteReason ?? forkConfirmationReason)
	const reportGuardMessage = fullReportingLoadingReason ?? reportActionGuardMessage ?? reportControlsLockedReason ?? getReportingSubmissionTimingGuard(activeReportingDetails) ?? reportReadinessReason
	const visiblePresetReasons = presetReasons.filter(reason => reason !== reportingCopy.poolHeldVaultRepBackingEmpty || reportGuardMessage !== reportingCopy.noVaultRepSelectWallet)
	const reportingApprovalGuardMessage = getReportingReportGuardMessage({ ...reportGuardParameters, requireAllowance: false })
	const reportingApprovalSatisfied = walletDepositAmount !== undefined && effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep !== undefined && effectiveReportingDetails.viewerWalletRepAllowanceAttoRep >= walletDepositAmount
	// The approval shares the report's network, lifecycle, and amount checks, but not the allowance it raises.
	const reportingApprovalGuard = !isOnActiveAppChain ? getWrongNetworkReason() : (reportControlsLockedReason ?? getReportingSubmissionTimingGuard(activeReportingDetails) ?? reportingApprovalGuardMessage)

	const reportButtonGuardMessage = fullReportingLoadingReason ?? (reportActionGuardMessage === undefined ? reportGuardMessage : reportingCopy.currentOraclePriceRequired)
	const reportActionDisabledReason = !isOnActiveAppChain ? getWrongNetworkReason() : reportButtonGuardMessage
	// The wallet blocks reporting when it is on another network, or when no earlier reason precedes the wallet-first report guard.
	const reportWalletBlocker = !isOnActiveAppChain || pickFirstReason(fullReportingLoadingReason, reportActionGuardMessage, reportControlsLockedReason) === undefined ? walletBlocker : undefined
	const hasPositiveReportAmount = selectedAmount !== undefined && selectedAmount > 0n
	const reportActionAvailability = withWalletBlocker(
		{ disabled: !isOnActiveAppChain || !reportOutcomeEnabled || !hasPositiveReportAmount || reportButtonGuardMessage !== undefined, loading: fullReportingLoadingReason !== undefined && reportActionDisabledReason === fullReportingLoadingReason, reason: reportActionDisabledReason },
		reportWalletBlocker,
	)
	const withdrawGuardMessage =
		withdrawControlsLockedReason ??
		getReportingWithdrawGuardMessage({
			accountAddress: accountState.address,
			isOnActiveAppChain,
			reportingStatus,
		})
	let displayedWithdrawGuardMessage = withdrawGuardMessage
	if (loadingReportingDetails) {
		displayedWithdrawGuardMessage = showFullReporting ? reportingCopy.loadingReportingDetails : reportingCopy.loadingEscalationDeposits
	}
	const reportOutcomeSelectionMessage = showFullReporting && reportingStatus !== 'missing' && selectedOutcome === undefined && !reportControlsLocked && reportActionDisabledReason === reportingCopy.reportOutcomeSelectionRequired ? SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE : undefined
	const showForkWorkflowAction = reportingStageKey === 'forkTriggered' && forkAlreadyTriggered && onOpenForkWorkflow !== undefined
	const showTriggerZoltarForkAction = reportingStageKey === 'forkTriggered' && !forkAlreadyTriggered && onTriggerZoltarFork !== undefined
	// Zoltar rejects a fork until the parent fork response period ends; equal timestamps are allowed.
	const parentForkResponseReason =
		activeReportingDetails !== undefined && effectiveCurrentTimestamp !== undefined && effectiveCurrentTimestamp < activeReportingDetails.earliestForkTime
			? zoltarCopy.formatParentForkResponseActiveReason(formatTimestamp(activeReportingDetails.earliestForkTime), formatRelativeTimestamp(activeReportingDetails.earliestForkTime, effectiveCurrentTimestamp))
			: undefined
	const forkUnavailableReason = activeReportingDetails?.canTriggerOwnFork === false ? reportingCopy.inheritedOutcomeCannotFork : parentForkResponseReason
	const resolvedTriggerZoltarForkAvailability = triggerZoltarForkAvailability?.disabled === true || forkUnavailableReason === undefined ? (triggerZoltarForkAvailability ?? { disabled: false, reason: undefined }) : { disabled: true, reason: forkUnavailableReason }
	const forkTriggeredActions =
		reportingStageKey !== 'forkTriggered' || (!showForkWorkflowAction && !showTriggerZoltarForkAction) ? undefined : (
			<ForkTriggeredActions
				actionDataNotice={oldActionData}
				approval={showTriggerZoltarForkAction ? triggerZoltarForkApproval : undefined}
				designedOverview={designedOverview}
				forkButton={
					showTriggerZoltarForkAction ? (
						<TransactionActionButton
							idleLabel={resolvedTriggerZoltarForkAvailability.loading === true ? reportingCopy.checkingFork : reportingCopy.triggerZoltarFork}
							pendingLabel={reportingCopy.triggeringZoltarFork}
							onClick={onTriggerZoltarFork}
							pending={triggerZoltarForkPending}
							availability={resolvedTriggerZoltarForkAvailability}
						/>
					) : undefined
				}
				forkPending={triggerZoltarForkPending}
				onOpenForkWorkflow={showForkWorkflowAction ? onOpenForkWorkflow : undefined}
				questionLedgerAddress={activeReportingDetails?.questionLedgerAddress}
			/>
		)
	useEffect(() => {
		if (!manageDeadlineRefresh || activeReportingDetails === undefined) return
		if (escalationPhase !== 'Timed Out') return
		if (loadingReportingDetails) return
		if (isPoolQuestionFinalized(activeReportingDetails) || activeReportingDetails.hasReachedNonDecision) return
		const refreshBoundaryKey = `${activeReportingDetails.questionLedgerAddress}:${activeReportingDetails.escalationEndTime.toString()}`
		if (lastTimedOutRefreshBoundaryKey.current === refreshBoundaryKey) return
		lastTimedOutRefreshBoundaryKey.current = refreshBoundaryKey
		void onLoadReporting()
	}, [activeReportingDetails, escalationPhase, loadingReportingDetails, manageDeadlineRefresh, onLoadReporting])

	const reportingStage = showFullReporting
		? getReportingStagePresentation({
				effectiveCurrentTimestamp,
				forkAlreadyTriggered,
				marketDetails,
				reportingDetails: effectiveReportingDetails,
			})
		: undefined
	const reportingStageBanner = reportingStage
	const sharedReportSettlementDisabledReason = showFullReporting && reportActionDisabledReason !== undefined && reportActionDisabledReason === displayedWithdrawGuardMessage ? reportActionDisabledReason : undefined
	let sharedReportSettlementDisabledReasonId: string | undefined
	if (sharedReportSettlementDisabledReason !== undefined) {
		sharedReportSettlementDisabledReasonId = reportingStageBanner?.detail === sharedReportSettlementDisabledReason ? reportingStageDetailId : settlementDisabledReasonId
	}
	const shouldRenderSharedReportSettlementDisabledReason = sharedReportSettlementDisabledReason !== undefined && sharedReportSettlementDisabledReasonId === settlementDisabledReasonId
	const reportDisabledReasonElementId = sharedReportSettlementDisabledReasonId ?? (reportingStageBanner?.detail === reportActionDisabledReason ? reportingStageDetailId : undefined)
	const standaloneReportDisabledReason = reportOutcomeSelectionMessage === undefined && reportDisabledReasonElementId === undefined ? reportActionDisabledReason : undefined
	const effectiveReportDisabledReasonElementId = reportDisabledReasonElementId ?? (standaloneReportDisabledReason === undefined && reportOutcomeSelectionMessage === undefined ? undefined : reportDisabledReasonId)
	const settlementActionDisabledReasonId = sharedReportSettlementDisabledReasonId ?? settlementDisabledReasonId
	const reportActionButton = (
		<TransactionActionButton
			idleLabel={reportButtonLabel}
			pendingLabel={(reportTriggersFork ? reportingCopy.reportingAndTriggeringFork : reportingCopy.reportingAmount)(selectedOutcomeLabel, reportDisplayAmount)}
			onClick={onReportOutcome}
			pending={reportingActiveAction === 'reportOutcome'}
			actionButtonRef={reportActionButtonRef}
			availability={reportActionAvailability}
			disabledReasonElementId={effectiveReportDisabledReasonElementId}
			showDisabledReason={false}
		/>
	)
	const showReportingHeaderStack = showLifecycle && showFullReporting && reportingStageBanner !== undefined
	const reportTitle = designedOverview ? reportingCopy.reportAnOutcome : reportingCopy.reportOutcome
	const settlementSection =
		showSettlementSection && reportingReady !== false ? (
			<ReportingSettlementSection
				actionDataNotice={oldActionData}
				designedOverview={designedOverview}
				showPositions={!showFullReporting}
				activeReportingDetails={activeReportingDetails}
				displayedWithdrawGuardMessage={displayedWithdrawGuardMessage}
				effectiveReportingDetails={effectiveReportingDetails}
				isOnActiveAppChain={isOnActiveAppChain}
				loadingReportingDetails={loadingReportingDetails}
				onReportingFormChange={onReportingFormChange}
				onWithdrawEscalation={handleWithdrawEscalation}
				pendingWithdrawOutcome={pendingWithdrawOutcome}
				reportingActiveAction={reportingActiveAction}
				reportingStatusMissing={reportingStatus === 'missing'}
				selectedWithdrawDepositIndexesByOutcome={selectedWithdrawDepositIndexesByOutcome}
				settlementActionDisabledReasonId={settlementActionDisabledReasonId}
				settlementContextMessage={settlementContextMessage}
				settlementDisabledReasonId={settlementDisabledReasonId}
				settlementWalletBlocker={withdrawControlsLockedReason === undefined ? walletBlocker : undefined}
				sharedReportSettlementDisabledReason={sharedReportSettlementDisabledReason}
				withdrawControlsLocked={withdrawControlsLocked}
				withdrawEscalationEnabled={withdrawEscalationEnabled}
				withdrawGuardMessage={withdrawGuardMessage}
			/>
		) : undefined
	const reportSidesPanel = (
		<ReportingSides
			forkProgressBalance={forkProgressBalance}
			chartScaleMax={chartScaleMax}
			displayBindingCapital={displayBindingCapital}
			finalized={finalized}
			outcomeSides={outcomeSides}
			disabled={showWithdrawOnly ? withdrawControlsLocked : reportControlsLocked}
			questionOutcome={effectiveReportingDetails?.questionOutcome}
			leadingOutcome={leadingOutcome}
			selectedOutcome={selectedOutcome}
			onSelect={outcome => onReportingFormChange({ selectedOutcome: outcome })}
		/>
	)
	const depositPreview = (
		<ReportingDepositPreview
			designedOverview={designedOverview}
			details={effectiveReportingDetails}
			outcome={selectedOutcome}
			outcomeLabel={selectedOutcomeLabel}
			amount={selectedAmount}
			forkConfirmation={{ confirmed: forkConfirmation.confirmed, disabled: reportControlsLocked || reportingActiveAction !== undefined, onChange: forkConfirmation.setConfirmed }}
		/>
	)
	const sections = (
		<>
			{showReportingHeaderStack ? (
				<div className='reporting-header-stack'>{reportingReady === false ? <LifecycleStageBanner detailId={reportingStageDetailId} flat stage={reportingStageBanner} /> : <EscalationPhaseStepper detailId={reportingStageDetailId} details={effectiveReportingDetails} forkAlreadyTriggered={forkAlreadyTriggered} />}</div>
			) : undefined}

			{!designedOverview && showFullReporting && effectiveReportingDetails !== undefined ? (
				<>
					{activeReportingDetails === undefined ? undefined : (
						<ReportingViewerStatus
							details={activeReportingDetails}
							disabled={reportControlsLocked}
							onTakeLead={(selectedOutcome, amount) => {
								onReportingFormChange({ selectedOutcome, reportAmount: formatCurrencyInputBalance(amount) })
								const input = document.getElementById('reporting-contribution-amount')
								input?.scrollIntoView({ block: 'center' })
								input?.focus()
							}}
						/>
					)}
					{activeReportingDetails === undefined || activeReportingDetails.sides.some(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0) ? undefined : <EscalationReminderLine key={activeReportingDetails.questionLedgerAddress} details={activeReportingDetails} />}
					<EscalationExplainer firstReportMinimum={effectiveReportingDetails.startBondAttoRep} nonDecisionThreshold={effectiveReportingDetails.nonDecisionThresholdAttoRep} defaultOpen={effectiveReportingDetails.status === 'not-started'} />
				</>
			) : undefined}

			{designedOverview ? undefined : <ReportingResultCard details={effectiveReportingDetails} />}
			{finalized ? settlementSection : undefined}
			{!designedOverview && showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-metrics-section' title={reportingCopy.escalationMetrics} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={<GlossaryTerm id='non-decision-threshold'>{glossaryCopy.nonDecisionThresholdTerm}</GlossaryTerm>}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.nonDecisionThresholdAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={reportingCopy.minimumFirstReport}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.startBondAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						{finalized || activeReportingDetails?.hasReachedNonDecision ? undefined : <MetricField label={reportingCopy.responseWindowEnds}>{activeReportingDetails === undefined ? inactiveCountdown : formatReportingDeadline(activeReportingDetails.escalationEndTime, activeReportingDetails.currentTime)}</MetricField>}
					</div>
					<ReadOnlyDetailAccordion title={reportingCopy.reportingParameters}>
						<div className='escalation-metrics'>
							{activeReportingDetails?.forkContinuation ? (
								<>
									<MetricField label={reportingCopy.continuationResumed}>
										{activeReportingDetails.forkResumedAt === 0n ? reportingCopy.continuationNotResumed : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails.forkResumedAt} />}
									</MetricField>
									<MetricField label={reportingCopy.inheritedAttritionElapsed}>{formatInheritedAttritionElapsed(activeReportingDetails.forkElapsedAtStart)}</MetricField>
								</>
							) : (
								<>
									<MetricField label={reportingCopy.attritionStarts}>
										<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails?.activationTime} />
									</MetricField>
									<MetricField label={reportingCopy.escalationStarted}>
										<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
									</MetricField>
								</>
							)}
						</div>
					</ReadOnlyDetailAccordion>
				</SectionBlock>
			) : undefined}

			{showFullReporting && reportingReady !== false && (!designedOverview || (!finalized && reportingStageKey !== 'forkTriggered')) ? (
				<SectionBlock className='reporting-outcome-section' title={finalized ? reportingCopy.results : reportTitle} description={finalized ? undefined : oldActionData} variant={designedOverview ? 'default' : 'embedded'}>
					{oracleBlocker ??
						(reportActionGuardMessage === undefined ? undefined : (
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
						))}
					{finalized || !designedOverview ? reportSidesPanel : undefined}
					{finalized ? undefined : (
						<>
							<div className={designedOverview ? 'statoblast-report-draft' : 'reporting-draft-flow'}>
								<div className={designedOverview ? 'statoblast-report-inputs' : 'reporting-draft-flow'}>
									{designedOverview && <ReportingOutcomePicker sides={outcomeSides} details={effectiveReportingDetails} selectedOutcome={selectedOutcome} leadingOutcome={leadingOutcome} disabled={reportControlsLocked} onSelect={outcome => onReportingFormChange({ selectedOutcome: outcome })} />}
									<AmountField
										disabled={reportControlsLocked}
										id='reporting-contribution-amount'
										label={reportingCopy.reportAmountFieldLabel}
										fillMax={{ amount: maxContributionAmount.amountAttoRep, unavailableReason: reportControlsLocked ? reportControlsLockedReason : maxContributionAmount.reason, showUnavailableReason: false }}
										onChange={reportAmount => onReportingFormChange({ reportAmount })}
										placeholder={reportingCopy.reportAmountPlaceholder}
										unit={commonCopy.rep}
										value={reportingForm.reportAmount}
									/>

									{maxContributionAmount.stopsBelowFork === true && maxContributionAmount.amountAttoRep !== undefined && !reportTriggersFork ? <UserMessage className='detail' detail={reportingCopy.maxBelowForkHint(<RepAmount rounding='down' value={maxContributionAmount.amountAttoRep} />)} /> : undefined}
									{!designedOverview && depositPreview}

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
											{reportingCopy.minimumPreset(minimumPresetKind, minimumPresetAmount === undefined ? undefined : <RepAmount rounding='up' value={minimumPresetAmount} />)}
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
											{reportingCopy.rewardPreset(maxProfitContribution.amountAttoRep === undefined ? undefined : <RepAmount value={maxProfitContribution.amountAttoRep} />)}
										</button>
									</div>
									{presetBlocker === undefined ? undefined : <UserMessage id={presetBlockerId} className='detail' detail={presetBlocker} />}

									{actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (
										<UserMessage
											className='detail'
											detail={
												<>
													{reportingCopy.currentEscalationDisputeStakeLead}
													<CurrencyValue value={actualReportDepositAmount} suffix={commonCopy.rep} />
													{reportingCopy.formatAcceptedAmountTail(reportContributionPreview?.tieAdjusted === true)}
												</>
											}
										/>
									)}
									{visiblePresetReasons.length === 0 ? undefined : <UserMessage className='detail' detail={visiblePresetReasons.join(' ')} />}
									<UserMessage
										className='detail'
										detail={
											<>
												{reportingCopy.paidFromWallet} · {reportingCopy.availableBalance(formatKnownAmount(availableReportingRep))}
											</>
										}
									/>
								</div>
								{designedOverview && depositPreview}
							</div>
							<div className='reporting-shared-action-region'>
								<TokenApprovalControl
									// Both actions share one row under a reserved message slot, so neither moves as the approval changes.
									renderActions={({ button, notice, noticeId }) => (
										<>
											<div className='tx-action-feedback reporting-approval-notice' aria-live='polite' aria-atomic='true'>
												{notice === undefined || (notice === reportingApprovalGuard && effectiveReportDisabledReasonElementId !== undefined) ? undefined : <UserMessage id={noticeId} placement='field' detail={notice} />}
											</div>
											<div className='actions reporting-wallet-actions'>
												{button}
												{reportActionButton}
											</div>
										</>
									)}
									// An allowance that already covers the report keeps the approval in place, disabled as done.
									completedLabel={reportingApprovalSatisfied ? commonCopy.approvalSatisfied : undefined}
									showRequirementNotice={false}
									actionLabel={reportingCopy.reportingApprovalAction}
									allowanceError={undefined}
									allowanceLoading={accountState.address !== undefined && effectiveReportingDetails !== undefined && effectiveReportingDetails.viewerWalletRepAllowanceAttoRep === undefined}
									approvedAmount={effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep}
									disabled={reportControlsLocked}
									guardMessage={reportingApprovalGuard}
									// While a reason blocks both actions, the report's copy of it serves the whole region.
									guardMessageElementId={reportingApprovalGuard === undefined ? undefined : effectiveReportDisabledReasonElementId}
									onApprove={onApproveReportingRep}
									pending={reportingActiveAction === 'approveReportingRep'}
									pendingLabel={commonCopy.approvingRep}
									requiredAmount={walletDepositAmount}
									resetKey={`${effectiveReportingDetails?.questionLedgerAddress ?? ''}:${selectedOutcome ?? ''}`}
									tokenSymbol={commonCopy.rep}
									tokenUnits={18}
								/>
								<WalletActionFixReason actionButtonRef={reportActionButtonRef} availability={reportActionAvailability} id={settlementDisabledReasonId} visible={shouldRenderSharedReportSettlementDisabledReason}>
									<UserMessage className='detail disabled-reason' id={settlementDisabledReasonId} loading={loadingReportingDetails} detail={sharedReportSettlementDisabledReason} />
								</WalletActionFixReason>
								<WalletActionFixReason actionButtonRef={reportActionButtonRef} availability={reportActionAvailability} id={reportDisabledReasonId} visible={standaloneReportDisabledReason !== undefined}>
									<UserMessage className='detail disabled-reason' id={reportDisabledReasonId} loading={reportActionAvailability.loading === true} detail={standaloneReportDisabledReason} />
								</WalletActionFixReason>
								{reportOutcomeSelectionMessage === undefined ? undefined : <UserMessage id={reportDisabledReasonId} className='detail disabled-reason' detail={reportOutcomeSelectionMessage} />}
							</div>
						</>
					)}
				</SectionBlock>
			) : undefined}

			{finalized ? undefined : settlementSection}

			{forkTriggeredActions}

			<RetryableNotice disabled={loadingReportingDetails} message={reportingError} onRetry={onLoadReporting} retryLabel={loadingReportingDetails ? <LoadingText>{reportingCopy.loadingEscalation}</LoadingText> : reportingCopy.retryReporting} />
		</>
	)
	if (embedInCard) return sections
	return <RouteWorkflowPanel title={reportingCopy.reportingWorkflow}>{sections}</RouteWorkflowPanel>
}
