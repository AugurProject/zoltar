import { EscalationPhaseStepper } from './EscalationPhaseStepper.js'
import { ReportingResultCard } from './ReportingResultCard.js'
import { ReportingSides } from './ReportingSides.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import type { ComponentChild } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingAwareText, LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { pickFirstReason } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { parseOptionalRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getWrongNetworkReason, isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, getRemainingSelectedOutcomeContributionCapacity, isPoolQuestionFinalized, previewReportingContribution } from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingLockedUntilMessage, getReportingOutcomeLabel, hasReportingOpened } from '../lib/reporting.js'
import { deriveReportingStage, isReportingOutcomeEnabled, isWithdrawEscalationEnabled } from '../lib/reporting.js'
import { getEffectiveReportingDetails, getEscalationGameStartTimestamp, getReportingStagePresentation } from '../lib/reportingStagePresentation.js'
import { ReportingSettlementSection } from './ReportingSettlementSection.js'
import type { ReportingSectionProps } from '../../oracleTypes.js'
import type { EscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
function formatKnownAmount(amount: bigint | undefined) {
	return amount === undefined ? commonCopy.metricUnavailablePlaceholder : formatCurrencyBalance(amount)
}
type ReportingStatus = 'active' | 'missing' | 'not-started'
type EscalationSideDisplay = {
	balance: bigint | undefined
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.presetDetailsRequired
const SELECT_OUTCOME_PRESET_REASON = reportingCopy.presetOutcomeSelectionRequired
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = reportingCopy.reportingActivationHint
const NO_SELECTED_SIDE_CAPACITY_REASON = reportingCopy.selectedSideCapacityEmpty
const BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON = reportingCopy.selectedSideBelowMinimumReason
const FORK_TRIGGERED_REPORT_REASON = reportingCopy.forkTriggerInstruction
const FORK_TRIGGERED_SETTLEMENT_REASON = reportingCopy.forkRequiredSettlementReason
const FORK_ALREADY_TRIGGERED_REPORT_REASON = reportingCopy.forkAlreadyTriggeredReportReason
const FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON = reportingCopy.forkAlreadyTriggeredSettlementReason
function isRedundantPresetReason(reason: string | undefined) {
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === SELECT_OUTCOME_PRESET_REASON
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

export function ReportingSection({
	accountState,
	oracleBlocker,
	currentTimestamp,
	embedInCard = false,
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
	showHeader = true,
	showSecurityPoolAddressInput = true,
	mode = 'full-reporting',
	triggerZoltarForkAvailability,
	triggerZoltarForkPending = false,
}: ReportingSectionProps) {
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
	const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime
	const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp)
	const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined
	const usesWalletFunding = effectiveReportingDetails?.contributionFunding === 'wallet'
	const escalationPhase = activeReportingDetails === undefined ? undefined : getEscalationPhase(activeReportingDetails)
	const escalationGameStartTimestamp = getEscalationGameStartTimestamp(activeReportingDetails?.activationTime)
	const inactiveCountdown = effectiveReportingDetails === undefined ? commonCopy.metricUnavailablePlaceholder : reportingCopy.startsWithFirstReport
	const reportingStatus: ReportingStatus = effectiveReportingDetails === undefined ? 'missing' : effectiveReportingDetails.status
	const marketDetails = effectiveReportingDetails?.marketDetails ?? previewMarketDetails
	const showFullReporting = mode === 'full-reporting'
	const showWithdrawOnly = mode === 'withdraw-only'
	const showSettlementSection = showFullReporting || showWithdrawOnly
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
		reportLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON
	} else if (reportingStageKey === 'timedOut') {
		reportLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason
	} else if (reportingStageKey === 'resolved') {
		reportLifecycleReason = reportingCopy.poolFinalizedReason
	}
	const fullReportingLoadingReason = showFullReporting && loadingReportingDetails ? reportingCopy.reportingDetailsRequired : undefined
	const reportControlsLockedReason = showFullReporting ? pickFirstReason(fullReportingLoadingReason, reportActionGuardMessage, lockedReason, reportingStageKey === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason
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
		withdrawControlsLockedReason = pickFirstReason(lockedReason, reportingStageKey === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason)
	}
	let settlementContextMessage: string | undefined
	if (activeReportingDetails?.settlementState === 'migration-required') settlementContextMessage = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail
	else if (activeReportingDetails?.settlementState === 'migration-expired') settlementContextMessage = reportingCopy.unresolvedMigrationExpiredDetail
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
	const largestBalance = outcomeSides.reduce((max, side) => ((side.balance ?? 0n) > max ? (side.balance ?? 0n) : max), 0n)
	const finalized = isPoolQuestionFinalized(effectiveReportingDetails)
	const leadingOutcome = activeReportingDetails === undefined ? undefined : getLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const selectedOutcomeLabel = selectedOutcome === undefined ? reportingCopy.selectedSide : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
	const availableReportingRep = usesWalletFunding ? effectiveReportingDetails?.viewerWalletRepBalanceAttoRep : effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep
	const reportButtonLabel = selectedOutcome === undefined ? reportingCopy.reportOnSelectedSide : commonCopy.launchAction(reportingCopy.reportAmountLabel(selectedOutcomeLabel, formatCurrencyInputBalance(actualReportDepositAmount ?? selectedAmount ?? 0n)))
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const minimumPresetAmount = minimumOutcomeChangeContribution.amountAttoRep ?? (effectiveReportingDetails?.status === 'not-started' ? effectiveReportingDetails.startBondAttoRep : undefined)
	const maxProfitContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const presetBlocker = reportControlsLocked ? undefined : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].find(reason => reason !== undefined && !isRedundantPresetReason(reason))
	const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome)
	const maxContributionAmount = (() => {
		if (selectedOutcome === undefined) return { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON }
		if (effectiveReportingDetails === undefined) return { amountAttoRep: undefined, reason: LOAD_REPORTING_PRESETS_REASON }
		if (availableReportingRep === undefined) return { amountAttoRep: undefined, reason: usesWalletFunding ? reportingCopy.loadingWalletRepBalance : reportingCopy.loadingPoolHeldVaultRepBacking }
		if (availableReportingRep <= 0n) return { amountAttoRep: undefined, reason: usesWalletFunding ? reportingCopy.walletRepBalanceEmpty : reportingCopy.poolHeldVaultRepBackingEmpty }
		if (remainingSelectedOutcomeCapacity !== undefined && remainingSelectedOutcomeCapacity <= 0n) return { amountAttoRep: undefined, reason: NO_SELECTED_SIDE_CAPACITY_REASON }
		if (effectiveReportingDetails.status === 'not-started') {
			const cappedAmount = remainingSelectedOutcomeCapacity === undefined || availableReportingRep < remainingSelectedOutcomeCapacity ? availableReportingRep : remainingSelectedOutcomeCapacity
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
		if (cappedAmount > availableReportingRep) cappedAmount = availableReportingRep
		if (remainingSelectedOutcomeCapacity !== undefined && cappedAmount > remainingSelectedOutcomeCapacity) cappedAmount = remainingSelectedOutcomeCapacity
		if (cappedAmount < effectiveReportingDetails.startBondAttoRep) return { amountAttoRep: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON }
		return {
			amountAttoRep: cappedAmount,
			reason: undefined,
		}
	})()
	const presetReasons = [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason, maxContributionAmount.reason].filter((reason, index, reasons) => reason !== undefined && !isRedundantPresetReason(reason) && reason !== presetBlocker && reasons.indexOf(reason) === index)
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? reportingCopy.reportAmountPreviewRequired : undefined
	const reportGuardMessage =
		fullReportingLoadingReason ??
		reportActionGuardMessage ??
		reportControlsLockedReason ??
		getReportingReportGuardMessage({
			actualDepositAmount: actualReportDepositAmount,
			accountAddress: accountState.address,
			contributionFunding: effectiveReportingDetails?.contributionFunding,
			contributionPreviewReason: reportContributionPreview?.reason,
			isOnActiveAppChain,
			remainingSelectedOutcomeCapacity,
			reportAmount: reportingForm.reportAmount,
			reportingStatus,
			selectedOutcome,
			selectedAmount,
			viewerPoolHeldVaultRepBackingAttoRep: effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep,
			viewerVaultExists: effectiveReportingDetails?.viewerVaultExists ?? false,
			viewerWalletRepAllowanceAttoRep: effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep,
			viewerWalletRepBalanceAttoRep: effectiveReportingDetails?.viewerWalletRepBalanceAttoRep,
		})
	const reportingApprovalGuardMessage = getReportingReportGuardMessage({
		actualDepositAmount: actualReportDepositAmount,
		accountAddress: accountState.address,
		contributionFunding: effectiveReportingDetails?.contributionFunding,
		contributionPreviewReason: reportContributionPreview?.reason,
		isOnActiveAppChain,
		remainingSelectedOutcomeCapacity,
		reportAmount: reportingForm.reportAmount,
		reportingStatus,
		selectedOutcome,
		selectedAmount,
		requireAllowance: false,
		viewerPoolHeldVaultRepBackingAttoRep: effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep,
		viewerVaultExists: effectiveReportingDetails?.viewerVaultExists ?? false,
		viewerWalletRepAllowanceAttoRep: effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep,
		viewerWalletRepBalanceAttoRep: effectiveReportingDetails?.viewerWalletRepBalanceAttoRep,
	})
	const reportingRepApprovalRequired = usesWalletFunding && actualReportDepositAmount !== undefined && actualReportDepositAmount > (effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep ?? 0n)
	const reportButtonGuardMessage = fullReportingLoadingReason ?? (reportActionGuardMessage === undefined ? reportGuardMessage : reportingCopy.currentOraclePriceRequired)
	const reportActionDisabledReason = !isOnActiveAppChain ? getWrongNetworkReason() : reportButtonGuardMessage
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
	const reportOutcomeSelectionMessage = showFullReporting && reportingStatus !== 'missing' && selectedOutcome === undefined && !reportControlsLocked && reportActionDisabledReason === reportingCopy.reportOutcomeSelectionRequired ? SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE : undefined
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
	let reportingRepApprovalAction: ComponentChild
	if (reportingRepApprovalRequired) {
		reportingRepApprovalAction = (
			<TransactionActionButton
				idleLabel={commonCopy.launchAction(reportingCopy.approveAmountLabel(formatCurrencyInputBalance(actualReportDepositAmount ?? 0n)))}
				pendingLabel={reportingCopy.approvingAmount(formatCurrencyInputBalance(actualReportDepositAmount ?? 0n))}
				onClick={onApproveReportingRep}
				pending={reportingActiveAction === 'approveReportingRep'}
				availability={{ disabled: !isOnActiveAppChain || !reportOutcomeEnabled || reportingApprovalGuardMessage !== undefined, reason: !isOnActiveAppChain ? getWrongNetworkReason() : reportingApprovalGuardMessage }}
			/>
		)
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
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStageBanner !== undefined)
	const settlementSection =
		showSettlementSection && reportingReady !== false ? (
			<ReportingSettlementSection
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
				sharedReportSettlementDisabledReason={sharedReportSettlementDisabledReason}
				withdrawControlsLocked={withdrawControlsLocked}
				withdrawEscalationEnabled={withdrawEscalationEnabled}
				withdrawGuardMessage={withdrawGuardMessage}
			/>
		) : undefined
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
					{reportingReady === false ? <LifecycleStageBanner detailId={reportingStageDetailId} flat stage={reportingStageBanner} /> : <EscalationPhaseStepper detailId={reportingStageDetailId} details={effectiveReportingDetails} forkAlreadyTriggered={forkAlreadyTriggered} />}
				</div>
			) : undefined}

			<ReportingResultCard details={effectiveReportingDetails} />
			{finalized ? settlementSection : undefined}
			{showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-metrics-section' title={reportingCopy.escalationMetrics} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={reportingCopy.nonDecisionThresholdAttoRep}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.nonDecisionThresholdAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={reportingCopy.startBondAttoRep}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.startBondAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						{finalized ? undefined : (
							<MetricField label={escalationPhase === 'Pending Start' ? reportingCopy.gameStartsIn : reportingCopy.endsIn}>
								{activeReportingDetails === undefined ? (
									inactiveCountdown
								) : (
									<>
										{formatDuration(escalationPhase === 'Pending Start' ? activeReportingDetails.activationTime - activeReportingDetails.currentTime : getEscalationTimeRemaining(activeReportingDetails))}
										<span className='detail'>
											<TimestampValue relative={false} timestamp={escalationPhase === 'Pending Start' ? activeReportingDetails.activationTime : activeReportingDetails.escalationEndTime} />
										</span>
									</>
								)}
							</MetricField>
						)}
					</div>
					<ReadOnlyDetailAccordion title={reportingCopy.reportingParameters}>
						<div className='escalation-metrics'>
							<MetricField label={reportingCopy.escalationStarted}>
								<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
							</MetricField>
						</div>
					</ReadOnlyDetailAccordion>
				</SectionBlock>
			) : undefined}

			{showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-outcome-section' title={finalized ? reportingCopy.results : reportingCopy.reportOutcome} variant='embedded'>
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
					<ReportingSides
						largestBalance={largestBalance}
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
					{finalized ? undefined : (
						<>
							{reportOutcomeSelectionMessage === undefined ? undefined : (
								<p id={reportDisabledReasonId} className='detail'>
									{reportOutcomeSelectionMessage}
								</p>
							)}
							<div className='field'>
								<label htmlFor='reporting-contribution-amount'>
									<span>{reportingCopy.contributionAmountRep}</span>
								</label>
								<div className='field-inline'>
									<FormInput placeholder={reportingCopy.reportAmountPlaceholder} id='reporting-contribution-amount' className='field-inline-input' value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} disabled={reportControlsLocked} />
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
									{reportingCopy.minimumPreset(reportingStatus === 'active', minimumPresetAmount === undefined ? undefined : formatKnownAmount(minimumPresetAmount))}
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
									{reportingCopy.rewardPreset(maxProfitContribution.amountAttoRep === undefined ? undefined : formatKnownAmount(maxProfitContribution.amountAttoRep))}
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
									{usesWalletFunding ? reportingCopy.acceptedWalletAmountTail : reportingCopy.acceptedAmountTail}
								</p>
							)}
							{presetReasons.length === 0 ? undefined : <p className='detail'>{presetReasons.join(' ')}</p>}
							<p className='detail'>
								{usesWalletFunding ? reportingCopy.paidFromWallet : reportingCopy.paidFromVault} · {reportingCopy.availableBalance(formatKnownAmount(availableReportingRep))}
							</p>
							<p className='detail'>{!usesWalletFunding && reportingStatus === 'active' ? reportingCopy.continuationFundingHelp : reportingCopy.fundingSourceHelp}</p>
							<div className='reporting-shared-action-region'>
								{shouldRenderSharedReportSettlementDisabledReason ? (
									<p className='detail' id={settlementDisabledReasonId}>
										<LoadingAwareText loading={loadingReportingDetails}>{sharedReportSettlementDisabledReason}</LoadingAwareText>
									</p>
								) : undefined}
								<div className={`actions${usesWalletFunding ? ' reporting-wallet-action-row' : ''}`}>
									{reportingRepApprovalAction}
									<TransactionActionButton
										idleLabel={reportButtonLabel}
										pendingLabel={reportingCopy.reportingAmount(selectedOutcomeLabel, formatCurrencyInputBalance(actualReportDepositAmount ?? selectedAmount ?? 0n))}
										onClick={onReportOutcome}
										pending={reportingActiveAction === 'reportOutcome'}
										availability={{ disabled: !isOnActiveAppChain || !reportOutcomeEnabled || reportButtonGuardMessage !== undefined, loading: fullReportingLoadingReason !== undefined && reportActionDisabledReason === fullReportingLoadingReason, reason: reportActionDisabledReason }}
										disabledReasonElementId={effectiveReportDisabledReasonElementId}
										showDisabledReason={false}
									/>
								</div>
								{standaloneReportDisabledReason === undefined ? undefined : (
									<p className='detail disabled-reason' id={reportDisabledReasonId}>
										<LoadingAwareText loading={fullReportingLoadingReason !== undefined && reportActionDisabledReason === fullReportingLoadingReason}>{standaloneReportDisabledReason}</LoadingAwareText>
									</p>
								)}
							</div>
						</>
					)}
				</SectionBlock>
			) : undefined}

			{finalized ? undefined : settlementSection}

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
