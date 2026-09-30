import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ReportingDepositPreview, getReportingApprovalLabel } from './ReportingDepositPreview.js'
import { getReportingContributionFunding, getReportingWalletDepositAmount, getReportingWalletFundingQuote } from '../../../lib/reportingFunding.js'
import { ReportingFundingSelector, ReportingWalletVaultHelp } from './ReportingFundingSelector.js'
import { getDisplayedLeadingEscalationOutcome, REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingLockedUntilMessage, getReportingOutcomeLabel, hasReportingOpened, deriveReportingStage, isReportingOutcomeEnabled, isWithdrawEscalationEnabled } from '../lib/reporting.js'
import { ReportingViewerStatus } from './ReportingViewerStatus.js'
import { EscalationReminderLine } from './EscalationReminderLine.js'
import { EscalationExplainer } from './EscalationExplainer.js'
import { formatReportingDeadline } from '../lib/reportingViewerStatus.js'
import { EscalationPhaseStepper } from './EscalationPhaseStepper.js'
import { ReportingResultCard } from './ReportingResultCard.js'
import { ReportingSides } from './ReportingSides.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WalletActionFixReason } from '@zoltar/ui-core-shared/components/WalletActionFix.js'
import { getActiveAppChainWalletBlocker, withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { pickFirstReason } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { parseOptionalRepAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getWrongNetworkReason, isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getEscalationPhase, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, getRemainingSelectedOutcomeContributionCapacity, isPoolQuestionFinalized, previewReportingContribution } from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { getEffectiveReportingDetails, getEscalationGameStartTimestamp, getReportingStagePresentation } from '../lib/reportingStagePresentation.js'
import { ReportingSettlementSection } from './ReportingSettlementSection.js'
import { GlossaryTerm } from '../../glossary/components/GlossaryTerm.js'
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
	const walletBlocker = getActiveAppChainWalletBlocker({ accountAddress: accountState.address, isOnActiveAppChain })
	const reportActionButtonRef = useRef<HTMLButtonElement>(null)
	const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime
	const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp)
	const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined
	const contributionFunding = getReportingContributionFunding(effectiveReportingDetails, reportingForm.contributionFunding)
	const usesWalletFunding = contributionFunding === 'wallet'
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
		reportLifecycleReason = forkAlreadyTriggered ? reportingCopy.forkAlreadyTriggeredReportReason : reportingCopy.forkTriggerInstruction
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
		settlementLifecycleReason = forkAlreadyTriggered ? reportingCopy.forkAlreadyTriggeredSettlementReason : reportingCopy.forkRequiredSettlementReason
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
	const leadingOutcome = activeReportingDetails === undefined ? undefined : getDisplayedLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const walletDepositAmount = getReportingWalletDepositAmount(effectiveReportingDetails, actualReportDepositAmount)
	const walletFundingQuote = getReportingWalletFundingQuote(effectiveReportingDetails, actualReportDepositAmount)
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
	const vaultFundingLoadingReason = usesWalletFunding && activeReportingDetails?.forkContinuation && actualReportDepositAmount !== undefined && walletDepositAmount === undefined ? reportingCopy.loadingVaultFunding : undefined
	const reportGuardParameters = {
		actualDepositAmount: actualReportDepositAmount,
		accountAddress: accountState.address,
		contributionFunding,
		walletFundingAvailable: true,
		walletDepositAmount,
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
	}
	const reportGuardMessage = vaultFundingLoadingReason ?? fullReportingLoadingReason ?? reportActionGuardMessage ?? reportControlsLockedReason ?? getReportingReportGuardMessage(reportGuardParameters)
	const visiblePresetReasons = presetReasons.filter(reason => reason !== reportingCopy.poolHeldVaultRepBackingEmpty || reportGuardMessage !== reportingCopy.noVaultRepSelectWallet)
	const reportingApprovalGuardMessage = vaultFundingLoadingReason ?? getReportingReportGuardMessage({ ...reportGuardParameters, requireAllowance: false })
	const reportingRepApprovalRequired = usesWalletFunding && walletDepositAmount !== undefined && walletDepositAmount > (effectiveReportingDetails?.viewerWalletRepAllowanceAttoRep ?? 0n)

	const reportButtonGuardMessage = fullReportingLoadingReason ?? (reportActionGuardMessage === undefined ? reportGuardMessage : reportingCopy.currentOraclePriceRequired)
	const reportActionDisabledReason = !isOnActiveAppChain ? getWrongNetworkReason() : reportButtonGuardMessage
	// The wallet blocks reporting when it is on another network, or when no earlier reason precedes the wallet-first report guard.
	const reportWalletBlocker = !isOnActiveAppChain || pickFirstReason(vaultFundingLoadingReason, fullReportingLoadingReason, reportActionGuardMessage, reportControlsLockedReason) === undefined ? walletBlocker : undefined
	const reportActionAvailability = withWalletBlocker(
		{ disabled: !isOnActiveAppChain || !reportOutcomeEnabled || reportButtonGuardMessage !== undefined, loading: fullReportingLoadingReason !== undefined && reportActionDisabledReason === fullReportingLoadingReason, reason: reportActionDisabledReason },
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

			{showFullReporting && effectiveReportingDetails !== undefined ? (
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
					{activeReportingDetails === undefined || activeReportingDetails.sides.some(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0) ? undefined : <EscalationReminderLine key={activeReportingDetails.securityPoolAddress} details={activeReportingDetails} />}
					<EscalationExplainer details={effectiveReportingDetails} />
				</>
			) : undefined}

			<ReportingResultCard details={effectiveReportingDetails} />
			{finalized ? settlementSection : undefined}
			{showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-metrics-section' title={reportingCopy.escalationMetrics} variant='embedded'>
					<div className='escalation-metrics'>
						<MetricField label={<GlossaryTerm id='non-decision-threshold'>{reportingCopy.nonDecisionThresholdAttoRep}</GlossaryTerm>}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.nonDecisionThresholdAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={reportingCopy.startBondAttoRep}>
							<CurrencyValue precision='exact' value={effectiveReportingDetails?.startBondAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						{finalized || activeReportingDetails?.hasReachedNonDecision ? undefined : <MetricField label={reportingCopy.responseWindowEnds}>{activeReportingDetails === undefined ? inactiveCountdown : formatReportingDeadline(activeReportingDetails.escalationEndTime, activeReportingDetails.currentTime)}</MetricField>}
					</div>
					<ReadOnlyDetailAccordion title={reportingCopy.reportingParameters}>
						<div className='escalation-metrics'>
							<MetricField label={reportingCopy.attritionStarts}>
								<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails?.activationTime} />
							</MetricField>
							<MetricField label={reportingCopy.escalationStarted}>
								<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={escalationGameStartTimestamp} />
							</MetricField>
						</div>
					</ReadOnlyDetailAccordion>
				</SectionBlock>
			) : undefined}

			{showFullReporting && reportingReady !== false ? (
				<SectionBlock className='reporting-outcome-section' title={finalized ? reportingCopy.results : reportingCopy.reportOutcome} variant='embedded'>
					{finalized ? undefined : <ReportingFundingSelector value={contributionFunding} onChange={contributionFunding => onReportingFormChange({ contributionFunding })} disabled={loadingReportingDetails || reportingActiveAction !== undefined} />}
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
							{reportOutcomeSelectionMessage === undefined ? undefined : <UserMessage id={reportDisabledReasonId} className='detail' detail={reportOutcomeSelectionMessage} />}
							<AmountField
								disabled={reportControlsLocked}
								id='reporting-contribution-amount'
								label={reportingCopy.contributionAmount}
								fillMax={{ amount: maxContributionAmount.amountAttoRep, unavailableReason: reportControlsLocked ? reportControlsLockedReason : maxContributionAmount.reason }}
								onChange={reportAmount => onReportingFormChange({ reportAmount })}
								placeholder={reportingCopy.reportAmountPlaceholder}
								unit={commonCopy.rep}
								value={reportingForm.reportAmount}
							/>

							<ReportingDepositPreview details={effectiveReportingDetails} outcome={selectedOutcome} amount={selectedAmount} />

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
									{reportingCopy.minimumPreset(reportingStatus === 'active', minimumPresetAmount === undefined ? undefined : formatCurrencyInputBalance(minimumPresetAmount))}
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
									{reportingCopy.rewardPreset(maxProfitContribution.amountAttoRep === undefined ? undefined : formatCurrencyInputBalance(maxProfitContribution.amountAttoRep))}
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
											{usesWalletFunding ? reportingCopy.acceptedWalletAmountTail : reportingCopy.acceptedAmountTail}
										</>
									}
								/>
							)}
							{visiblePresetReasons.length === 0 ? undefined : <UserMessage className='detail' detail={visiblePresetReasons.join(' ')} />}
							<UserMessage
								className='detail'
								detail={
									<>
										{usesWalletFunding ? reportingCopy.paidFromWallet : reportingCopy.paidFromVault} · {reportingCopy.availableBalance(formatKnownAmount(availableReportingRep))}
									</>
								}
							/>
							{activeReportingDetails?.forkContinuation && usesWalletFunding ? <ReportingWalletVaultHelp remainingAmount={walletFundingQuote?.remainingVaultRepAttoRep} depositAmount={walletDepositAmount} reportAmount={actualReportDepositAmount} /> : undefined}
							<div className='reporting-shared-action-region'>
								<WalletActionFixReason actionButtonRef={reportActionButtonRef} availability={reportActionAvailability} id={settlementDisabledReasonId} visible={shouldRenderSharedReportSettlementDisabledReason}>
									<UserMessage className='detail' id={settlementDisabledReasonId} loading={loadingReportingDetails} detail={sharedReportSettlementDisabledReason} />
								</WalletActionFixReason>
								<div className={`actions${usesWalletFunding ? ' reporting-wallet-action-row' : ''}`}>
									{usesWalletFunding ? (
										<TransactionActionButton
											idleLabel={getReportingApprovalLabel(walletDepositAmount, reportingRepApprovalRequired)}
											pendingLabel={reportingCopy.approvingAmount(formatCurrencyInputBalance(walletDepositAmount ?? 0n))}
											onClick={onApproveReportingRep}
											showDisabledReason={reportingRepApprovalRequired}
											pending={reportingActiveAction === 'approveReportingRep'}
											availability={{
												disabled: !reportingRepApprovalRequired || !isOnActiveAppChain || !reportOutcomeEnabled || reportingApprovalGuardMessage !== undefined,
												reason: !isOnActiveAppChain ? getWrongNetworkReason() : (reportingApprovalGuardMessage ?? (!reportingRepApprovalRequired ? commonCopy.approvalSatisfied : undefined)),
											}}
											// While the wallet blocks both actions, the report action's reason holds the row's one wallet fix.
											{...(reportWalletBlocker === undefined ? {} : { disabledReasonElementId: effectiveReportDisabledReasonElementId, showDisabledReason: false })}
										/>
									) : undefined}
									<TransactionActionButton
										idleLabel={reportButtonLabel}
										pendingLabel={reportingCopy.reportingAmount(selectedOutcomeLabel, formatCurrencyInputBalance(actualReportDepositAmount ?? selectedAmount ?? 0n))}
										onClick={onReportOutcome}
										pending={reportingActiveAction === 'reportOutcome'}
										actionButtonRef={reportActionButtonRef}
										availability={reportActionAvailability}
										disabledReasonElementId={effectiveReportDisabledReasonElementId}
										showDisabledReason={false}
									/>
								</div>
								<WalletActionFixReason actionButtonRef={reportActionButtonRef} availability={reportActionAvailability} id={reportDisabledReasonId} visible={standaloneReportDisabledReason !== undefined}>
									<UserMessage className='detail disabled-reason' id={reportDisabledReasonId} loading={reportActionAvailability.loading === true} detail={standaloneReportDisabledReason} />
								</WalletActionFixReason>
							</div>
						</>
					)}
				</SectionBlock>
			) : undefined}

			{finalized ? undefined : settlementSection}

			{forkTriggeredActions}

			<RetryableNotice disabled={loadingReportingDetails} message={reportingError} onRetry={showSecurityPoolAddressInput ? undefined : onLoadReporting} retryLabel={loadingReportingDetails ? <LoadingText>{reportingCopy.loadingEscalation}</LoadingText> : reportingCopy.retryReporting} />
		</>
	)
	if (embedInCard) return sections
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={reportingCopy.reportingWorkflow}>
			{sections}
		</RouteWorkflowPanel>
	)
}
