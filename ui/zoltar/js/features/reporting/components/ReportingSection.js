import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as reportingCopy from '../../../copy/reporting.js';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { EscalationSide } from './EscalationSide.js';
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js';
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js';
import { LoadingAwareText, LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { TransactionUniverseValue } from '../../universes/components/TransactionUniverseValue.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { pickFirstReason } from '@zoltar/ui-core-shared/lib/actionAvailability.js';
import { formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js';
import { parseOptionalRepAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js';
import { getWrongNetworkMessage, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { calculateEstimatedEscalationReturn, ESCALATION_GAME_ACTIVATION_DELAY, getEscalationDepositClaimAmount, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, getRemainingSelectedOutcomeContributionCapacity, getSelectedOutcomeRewardWindowFillTimestamp, getReportingTimerPreview, isPoolQuestionFinalized, previewReportingContribution, } from '../lib/reportingDomain.js';
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js';
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingLockedUntilMessage, getReportingOutcomeLabel, hasReportingOpened } from '../lib/reporting.js';
import { deriveReportingStage, isReportingOutcomeEnabled, isWithdrawEscalationEnabled } from '../lib/reporting.js';
const LOAD_REPORTING_PRESETS_REASON = reportingCopy.presetDetailsRequired;
const MAX_PROFIT_NOT_STARTED_REASON = reportingCopy.maxProfitPrestartReason;
const SELECT_OUTCOME_PRESET_REASON = reportingCopy.presetOutcomeSelectionRequired;
const SELECTED_SIDE_ALREADY_LEADS_REASON = reportingCopy.selectedSideLeadsReason;
const MAX_PROFIT_WINDOW_FILLED_REASON = reportingCopy.maxProfitWindowFilledReason;
const SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE = reportingCopy.reportingActivationHint;
const NO_SELECTED_SIDE_CAPACITY_REASON = reportingCopy.selectedSideCapacityEmpty;
const BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON = reportingCopy.selectedSideBelowMinimumReason;
const FORK_TRIGGERED_REPORT_REASON = reportingCopy.forkTriggerInstruction;
const FORK_TRIGGERED_SETTLEMENT_REASON = reportingCopy.forkRequiredSettlementReason;
const FORK_ALREADY_TRIGGERED_REPORT_REASON = reportingCopy.forkAlreadyTriggeredReportReason;
const FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON = reportingCopy.forkAlreadyTriggeredSettlementReason;
function isRedundantPresetReason(reason) {
    return reason === LOAD_REPORTING_PRESETS_REASON || reason === MAX_PROFIT_NOT_STARTED_REASON || reason === SELECT_OUTCOME_PRESET_REASON || reason === SELECTED_SIDE_ALREADY_LEADS_REASON || reason === MAX_PROFIT_WINDOW_FILLED_REASON;
}
function getOutcomeSides(reportingDetails) {
    if (reportingDetails?.status === 'active')
        return reportingDetails.sides.map(side => ({
            balance: side.balance,
            key: side.key,
            label: side.label,
            userDeposits: side.userDeposits,
            userStake: side.userDeposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n),
        }));
    if (reportingDetails?.status === 'not-started')
        return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map(option => ({
            balance: 0n,
            key: option.value,
            label: option.label,
            userDeposits: [],
            userStake: 0n,
        }));
    return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map(option => ({
        balance: undefined,
        key: option.value,
        label: option.label,
        userDeposits: undefined,
        userStake: undefined,
    }));
}
function getResolvedReportingOutcomeLabel(reportingDetails) {
    return reportingDetails.questionOutcome === 'none' ? reportingCopy.pendingFinalization : getReportingOutcomeLabel(reportingDetails.questionOutcome);
}
function getWithdrawDepositClaimLabel(details, selectedOutcome) {
    if (details === undefined || details.status !== 'active')
        return undefined;
    if (!isPoolQuestionFinalized(details))
        return undefined;
    return details.questionOutcome === selectedOutcome ? reportingCopy.winningPayout : reportingCopy.losingDepositSettlement;
}
function getReportingStagePresentation({ effectiveCurrentTimestamp, forkAlreadyTriggered, marketDetails, reportingDetails, }) {
    if (effectiveCurrentTimestamp === undefined || marketDetails === undefined)
        return undefined;
    if (!hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp))
        return {
            availableActions: [],
            blockedActions: [],
            detail: getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp),
            key: 'reporting-not-enabled',
            label: reportingCopy.reportingNotEnabled,
            tone: 'warning',
        };
    if (reportingDetails === undefined)
        return {
            availableActions: [],
            blockedActions: [],
            detail: reportingCopy.reportingDetailsRequired,
            key: 'reporting-open',
            label: reportingCopy.reportingOpen,
            tone: 'default',
        };
    if (isPoolQuestionFinalized(reportingDetails))
        return {
            availableActions: [],
            blockedActions: [],
            detail: reportingCopy.formatReportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
            key: 'escalation-resolved',
            label: reportingCopy.resolved,
            tone: 'success',
        };
    if (reportingDetails.status === 'not-started')
        return undefined;
    const escalationPhase = getEscalationPhase(reportingDetails);
    switch (escalationPhase) {
        case 'Pending Start':
            return undefined;
        case 'Active':
            return {
                availableActions: [],
                blockedActions: [],
                detail: reportingCopy.liveEscalationHelpText,
                key: 'escalation-active',
                label: commonCopy.active,
                tone: 'default',
            };
        case 'Fork Triggered':
            return {
                availableActions: [],
                blockedActions: [],
                detail: forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON,
                key: 'escalation-fork-triggered',
                label: commonCopy.forkTriggered,
                tone: 'default',
            };
        case 'Timed Out':
            return {
                availableActions: [],
                blockedActions: [],
                detail: reportingCopy.timeoutResolutionDetail,
                key: 'escalation-timed-out',
                label: reportingCopy.timedOut,
                tone: 'default',
            };
        case 'Resolved':
            return {
                availableActions: [],
                blockedActions: [],
                detail: reportingCopy.formatReportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
                key: 'escalation-resolved',
                label: reportingCopy.resolved,
                tone: 'success',
            };
        default:
            return assertNever(escalationPhase);
    }
}
function getEscalationGameStartTimestamp(activationTime) {
    if (activationTime === undefined)
        return undefined;
    return activationTime > ESCALATION_GAME_ACTIVATION_DELAY ? activationTime - ESCALATION_GAME_ACTIVATION_DELAY : 0n;
}
function getEffectiveReportingDetails(reportingDetails, currentTimestamp) {
    if (reportingDetails === undefined || currentTimestamp === undefined || reportingDetails.currentTime === currentTimestamp)
        return reportingDetails;
    return {
        ...reportingDetails,
        currentTime: currentTimestamp,
    };
}
export function ReportingSection({ accountState, currentTimestamp, embedInCard = false, forkAlreadyTriggered = false, loadingReportingDetails, lockedReason, onLoadReporting, onOpenForkWorkflow, onOpenPriceOracle, onTriggerZoltarFork, onReportOutcome, onReportingFormChange, onWithdrawEscalation, previewMarketDetails, reportingActiveAction, reportingDetails, reportingError, reportingForm, reportActionGuardMessage, showHeader = true, showSecurityPoolAddressInput = true, mode = 'full-reporting', triggerZoltarForkAvailability, triggerZoltarForkPending = false, }) {
    const presetBlockerId = useId();
    const reportingStageDetailId = useId();
    const settlementDisabledReasonId = useId();
    const lastTimedOutRefreshBoundaryKey = useRef(undefined);
    const [pendingWithdrawOutcome, setPendingWithdrawOutcome] = useState(undefined);
    const isOnActiveAppChain = isActiveAppChain(accountState.chainId);
    const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime;
    const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp);
    const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined;
    const escalationPhase = activeReportingDetails === undefined ? undefined : getEscalationPhase(activeReportingDetails);
    const escalationGameStartTimestamp = getEscalationGameStartTimestamp(activeReportingDetails?.activationTime);
    const reportingStatus = effectiveReportingDetails === undefined ? 'missing' : effectiveReportingDetails.status;
    const marketDetails = effectiveReportingDetails?.marketDetails ?? previewMarketDetails;
    const showFullReporting = mode === 'full-reporting';
    const showWithdrawOnly = mode === 'withdraw-only';
    const showSettlementSection = showFullReporting || showWithdrawOnly;
    const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp);
    const preOpenLockedReason = lockedReason ?? (reportingReady === false && marketDetails !== undefined && effectiveCurrentTimestamp !== undefined ? getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp) : undefined);
    const reportingStageKey = deriveReportingStage({
        reportingDetails: effectiveReportingDetails,
        reportingReady,
    });
    const reportOutcomeEnabled = isReportingOutcomeEnabled(reportingStageKey);
    const withdrawEscalationEnabled = isWithdrawEscalationEnabled(reportingStageKey);
    let reportLifecycleReason;
    if (reportingStageKey === 'forkTriggered') {
        reportLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_REPORT_REASON : FORK_TRIGGERED_REPORT_REASON;
    }
    else if (reportingStageKey === 'timedOut') {
        reportLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason;
    }
    else if (reportingStageKey === 'resolved') {
        reportLifecycleReason = reportingCopy.poolFinalizedReason;
    }
    const fullReportingLoadingReason = showFullReporting && loadingReportingDetails ? reportingCopy.reportingDetailsRequired : undefined;
    const reportControlsLockedReason = showFullReporting ? pickFirstReason(fullReportingLoadingReason, lockedReason, reportingStageKey === 'preOpen' ? preOpenLockedReason : undefined, reportLifecycleReason) : preOpenLockedReason;
    const reportControlsLocked = !reportOutcomeEnabled || reportControlsLockedReason !== undefined;
    let settlementLifecycleReason;
    if (reportingStageKey === 'forkTriggered') {
        settlementLifecycleReason = forkAlreadyTriggered ? FORK_ALREADY_TRIGGERED_SETTLEMENT_REASON : FORK_TRIGGERED_SETTLEMENT_REASON;
    }
    else if (reportingStageKey === 'timedOut') {
        settlementLifecycleReason = reportingCopy.refreshFinalizedOutcomeReason;
    }
    else if (activeReportingDetails?.settlementState === 'migration-required') {
        settlementLifecycleReason = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail;
    }
    else if (activeReportingDetails?.settlementState === 'migration-expired') {
        settlementLifecycleReason = reportingCopy.unresolvedMigrationExpiredDetail;
    }
    else if (reportingStageKey === 'activeLocked') {
        settlementLifecycleReason = reportingCopy.questionFinalizationRequired;
    }
    let withdrawControlsLockedReason;
    if (showSettlementSection && loadingReportingDetails) {
        withdrawControlsLockedReason = showFullReporting ? reportingCopy.reportingDetailsRequired : reportingCopy.loadingEscalationDeposits;
    }
    else {
        withdrawControlsLockedReason = pickFirstReason(lockedReason, reportingStageKey === 'preOpen' ? preOpenLockedReason : undefined, settlementLifecycleReason);
    }
    let settlementContextMessage;
    if (activeReportingDetails?.settlementState === 'migration-required')
        settlementContextMessage = forkAlreadyTriggered ? reportingCopy.continueForkMigrationDetail : reportingCopy.forkMigrationRequiredDetail;
    else if (activeReportingDetails?.settlementState === 'migration-expired')
        settlementContextMessage = reportingCopy.unresolvedMigrationExpiredDetail;
    const withdrawControlsLocked = !withdrawEscalationEnabled || withdrawControlsLockedReason !== undefined;
    const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount);
    const selectedOutcome = reportingForm.selectedOutcome;
    const selectedWithdrawDepositIndexesByOutcome = reportingForm.selectedWithdrawDepositIndexesByOutcome;
    const withdrawableSides = activeReportingDetails?.sides.filter(side => side.userDeposits.length > 0) ?? [];
    let displayBindingCapital;
    if (effectiveReportingDetails !== undefined) {
        displayBindingCapital = effectiveReportingDetails.status === 'not-started' ? 0n : effectiveReportingDetails.bindingCapital;
    }
    const outcomeSides = getOutcomeSides(effectiveReportingDetails);
    const chartScaleMax = outcomeSides.reduce((maxBalance, side) => {
        if (side.balance === undefined || side.balance <= maxBalance)
            return maxBalance;
        return side.balance;
    }, displayBindingCapital !== undefined && displayBindingCapital > 1n ? displayBindingCapital : 1n);
    const leadingOutcome = activeReportingDetails === undefined ? undefined : getLeadingEscalationOutcome(activeReportingDetails.sides);
    const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount);
    const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount;
    const selectedEstimate = activeReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : calculateEstimatedEscalationReturn(activeReportingDetails, selectedOutcome, selectedAmount);
    const timerPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : getReportingTimerPreview(effectiveReportingDetails, selectedOutcome, selectedAmount);
    const selectedOutcomeLabel = selectedOutcome === undefined ? reportingCopy.selectedSide : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome));
    let projectedFinalizationTimestamp;
    if (timerPreview !== undefined && effectiveCurrentTimestamp !== undefined) {
        if (timerPreview.kind === 'not-started') {
            projectedFinalizationTimestamp = effectiveCurrentTimestamp + timerPreview.timeUntilEnd;
        }
        else if (timerPreview.actualState === 'ends-immediately') {
            projectedFinalizationTimestamp = effectiveCurrentTimestamp;
        }
        else if (activeReportingDetails !== undefined) {
            projectedFinalizationTimestamp = effectiveCurrentTimestamp + getEscalationTimeRemaining(activeReportingDetails) + (timerPreview.timerIncrease ?? 0n);
        }
    }
    const rewardWindowFillTimestamp = activeReportingDetails === undefined || selectedOutcome === undefined || actualReportDepositAmount === undefined ? undefined : getSelectedOutcomeRewardWindowFillTimestamp(activeReportingDetails, selectedOutcome, actualReportDepositAmount);
    const reportingTimerChange = (() => {
        if (timerPreview === undefined)
            return undefined;
        if (timerPreview.kind === 'not-started')
            return reportingCopy.startsEscalation;
        if (timerPreview.actualState === 'ends-immediately')
            return reportingCopy.finalizesImmediately;
        if (timerPreview.actualState === 'extends')
            return reportingCopy.formatTimerExtension(formatDuration(timerPreview.timerIncrease ?? 0n));
        return reportingCopy.noTimerChange;
    })();
    const reportingRecheckTimestamp = rewardWindowFillTimestamp !== undefined && effectiveCurrentTimestamp !== undefined && rewardWindowFillTimestamp > effectiveCurrentTimestamp ? rewardWindowFillTimestamp : projectedFinalizationTimestamp;
    const resultingAvailableReportingRep = effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep === undefined || actualReportDepositAmount === undefined || actualReportDepositAmount > effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep
        ? undefined
        : effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep - actualReportDepositAmount;
    const reportButtonLabel = selectedOutcome === undefined ? reportingCopy.reportOnSelectedSide : reportingCopy.formatReportSelectedOutcomeButtonLabel(selectedOutcomeLabel);
    const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome);
    const maxProfitContribution = selectedOutcome === undefined ? { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome);
    const presetBlocker = reportControlsLocked ? undefined : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].find(reason => reason !== undefined && !isRedundantPresetReason(reason));
    const remainingSelectedOutcomeCapacity = effectiveReportingDetails === undefined || selectedOutcome === undefined ? undefined : getRemainingSelectedOutcomeContributionCapacity(effectiveReportingDetails, selectedOutcome);
    const maxContributionAmount = (() => {
        if (selectedOutcome === undefined)
            return { amountAttoRep: undefined, reason: SELECT_OUTCOME_PRESET_REASON };
        if (effectiveReportingDetails === undefined)
            return { amountAttoRep: undefined, reason: LOAD_REPORTING_PRESETS_REASON };
        if (effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep === undefined)
            return { amountAttoRep: undefined, reason: reportingCopy.loadingPoolHeldVaultRepBacking };
        if (effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep <= 0n)
            return { amountAttoRep: undefined, reason: reportingCopy.poolHeldVaultRepBackingEmpty };
        if (remainingSelectedOutcomeCapacity !== undefined && remainingSelectedOutcomeCapacity <= 0n)
            return { amountAttoRep: undefined, reason: NO_SELECTED_SIDE_CAPACITY_REASON };
        if (effectiveReportingDetails.status === 'not-started') {
            const cappedAmount = remainingSelectedOutcomeCapacity === undefined || effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep < remainingSelectedOutcomeCapacity ? effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep : remainingSelectedOutcomeCapacity;
            if (cappedAmount < effectiveReportingDetails.startBondAttoRep)
                return { amountAttoRep: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON };
            return {
                amountAttoRep: cappedAmount,
                reason: undefined,
            };
        }
        const selectedSide = effectiveReportingDetails.sides.find(side => side.key === selectedOutcome);
        if (selectedSide === undefined)
            return { amountAttoRep: undefined, reason: reportingCopy.selectedSideIsUnavailable };
        const maxContributionPreview = previewReportingContribution(effectiveReportingDetails, selectedOutcome, effectiveReportingDetails.nonDecisionThresholdAttoRep - selectedSide.balance);
        if (maxContributionPreview.actualDepositAmount === undefined)
            return { amountAttoRep: undefined, reason: maxContributionPreview.reason };
        let cappedAmount = maxContributionPreview.actualDepositAmount;
        if (cappedAmount > effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep)
            cappedAmount = effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep;
        if (remainingSelectedOutcomeCapacity !== undefined && cappedAmount > remainingSelectedOutcomeCapacity)
            cappedAmount = remainingSelectedOutcomeCapacity;
        if (cappedAmount < effectiveReportingDetails.startBondAttoRep)
            return { amountAttoRep: undefined, reason: BELOW_MINIMUM_SELECTED_SIDE_CAPACITY_REASON };
        return {
            amountAttoRep: cappedAmount,
            reason: undefined,
        };
    })();
    const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? reportingCopy.reportAmountPreviewRequired : undefined;
    const reportGuardMessage = fullReportingLoadingReason ??
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
        });
    const reportButtonGuardMessage = fullReportingLoadingReason ?? (reportActionGuardMessage === undefined ? reportGuardMessage : reportingCopy.currentOraclePriceRequired);
    const reportActionDisabledReason = !isOnActiveAppChain ? (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) : reportButtonGuardMessage;
    const withdrawGuardMessage = withdrawControlsLockedReason ??
        getReportingWithdrawGuardMessage({
            accountAddress: accountState.address,
            isOnActiveAppChain,
            reportingStatus,
        });
    let displayedWithdrawGuardMessage = withdrawGuardMessage;
    if (loadingReportingDetails) {
        displayedWithdrawGuardMessage = showFullReporting ? reportingCopy.reportingDetailsRequired : reportingCopy.loadingEscalationDepositsDetail;
    }
    const reportOutcomeSelectionMessage = showFullReporting && reportingStatus !== 'missing' && selectedOutcome === undefined && !reportControlsLocked ? SELECT_OUTCOME_TO_ENABLE_REPORTING_MESSAGE : undefined;
    let reportingOpenNotice;
    if (showFullReporting && reportingStatus === 'not-started' && effectiveReportingDetails?.questionOutcome === 'none') {
        reportingOpenNotice = reportingCopy.reportingOpenDetail;
    }
    const withdrawActionPending = reportingActiveAction === 'withdrawEscalation';
    const shouldShowWithdrawEmptyState = !loadingReportingDetails && reportingStatus !== 'missing' && withdrawableSides.length === 0;
    const hasImportedForkedDeposits = activeReportingDetails?.sides.some(side => side.importedUserDeposits.length > 0) ?? false;
    const showForkWorkflowAction = reportingStageKey === 'forkTriggered' && forkAlreadyTriggered && onOpenForkWorkflow !== undefined;
    const showTriggerZoltarForkAction = reportingStageKey === 'forkTriggered' && !forkAlreadyTriggered && onTriggerZoltarFork !== undefined;
    const resolvedTriggerZoltarForkAvailability = triggerZoltarForkAvailability ?? { disabled: false, reason: undefined };
    const forkTriggeredActions = reportingStageKey !== 'forkTriggered' || (!showForkWorkflowAction && !showTriggerZoltarForkAction) ? undefined : (_jsxs("div", { className: 'actions', children: [showTriggerZoltarForkAction ? _jsx(TransactionActionButton, { idleLabel: reportingCopy.triggerZoltarFork, pendingLabel: reportingCopy.triggeringZoltarFork, onClick: onTriggerZoltarFork, pending: triggerZoltarForkPending, tone: 'primary', availability: resolvedTriggerZoltarForkAvailability }) : undefined, showForkWorkflowAction ? (_jsx("button", { className: 'secondary', type: 'button', onClick: onOpenForkWorkflow, children: reportingCopy.openForkAndMigration })) : undefined] }));
    const handleWithdrawEscalation = (outcome, depositIndexes) => {
        setPendingWithdrawOutcome(outcome);
        onWithdrawEscalation(outcome, depositIndexes);
    };
    useEffect(() => {
        if (activeReportingDetails === undefined)
            return;
        if (escalationPhase !== 'Timed Out')
            return;
        if (loadingReportingDetails)
            return;
        if (isPoolQuestionFinalized(activeReportingDetails) || activeReportingDetails.hasReachedNonDecision)
            return;
        const refreshBoundaryKey = `${activeReportingDetails.securityPoolAddress}:${activeReportingDetails.escalationEndTime.toString()}`;
        if (lastTimedOutRefreshBoundaryKey.current === refreshBoundaryKey)
            return;
        lastTimedOutRefreshBoundaryKey.current = refreshBoundaryKey;
        void onLoadReporting();
    }, [activeReportingDetails, escalationPhase, loadingReportingDetails, onLoadReporting]);
    useEffect(() => {
        if (reportingActiveAction === 'withdrawEscalation')
            return;
        setPendingWithdrawOutcome(undefined);
    }, [reportingActiveAction]);
    const reportingStage = showFullReporting
        ? getReportingStagePresentation({
            effectiveCurrentTimestamp,
            forkAlreadyTriggered,
            marketDetails,
            reportingDetails: effectiveReportingDetails,
        })
        : undefined;
    const reportingStageBanner = reportingStage?.key === 'escalation-active' ? undefined : reportingStage;
    const sharedReportSettlementDisabledReason = showFullReporting && reportActionDisabledReason !== undefined && reportActionDisabledReason === displayedWithdrawGuardMessage ? reportActionDisabledReason : undefined;
    let sharedReportSettlementDisabledReasonId;
    if (sharedReportSettlementDisabledReason !== undefined) {
        sharedReportSettlementDisabledReasonId = reportingStageBanner?.detail === sharedReportSettlementDisabledReason ? reportingStageDetailId : settlementDisabledReasonId;
    }
    const shouldRenderSharedReportSettlementDisabledReason = sharedReportSettlementDisabledReason !== undefined && sharedReportSettlementDisabledReasonId === settlementDisabledReasonId;
    const reportDisabledReasonElementId = sharedReportSettlementDisabledReasonId ?? (reportingStageBanner?.detail === reportActionDisabledReason ? reportingStageDetailId : undefined);
    const settlementActionDisabledReasonId = sharedReportSettlementDisabledReasonId ?? settlementDisabledReasonId;
    const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStageBanner !== undefined || reportingOpenNotice !== undefined);
    const sections = (_jsxs(_Fragment, { children: [showReportingHeaderStack ? (_jsxs("div", { className: 'reporting-header-stack', children: [showSecurityPoolAddressInput ? (_jsx(LookupFieldRow, { label: commonCopy.securityPoolAddress, value: reportingForm.securityPoolAddress, onInput: securityPoolAddress => onReportingFormChange({ securityPoolAddress }), placeholder: commonCopy.hexValuePlaceholder, action: _jsx("button", { className: 'secondary', onClick: onLoadReporting, disabled: loadingReportingDetails || preOpenLockedReason !== undefined, title: preOpenLockedReason, children: loadingReportingDetails ? _jsx(LoadingText, { children: reportingCopy.loadingEscalation }) : reportingCopy.refreshReporting }) })) : undefined, reportingOpenNotice === undefined ? _jsx(LifecycleStageBanner, { detailId: reportingStageDetailId, flat: true, stage: reportingStageBanner }) : _jsx("p", { className: 'notice success', children: reportingOpenNotice })] })) : undefined, showFullReporting && reportingReady !== false ? (_jsx(SectionBlock, { className: 'reporting-metrics-section', title: reportingCopy.escalationMetrics, variant: 'embedded', children: _jsxs("div", { className: 'escalation-metrics', children: [_jsx(MetricField, { label: reportingCopy.nonDecisionThresholdAttoRep, children: _jsx(CurrencyValue, { precision: 'exact', value: effectiveReportingDetails?.nonDecisionThresholdAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: reportingCopy.timeLeft, children: activeReportingDetails === undefined ? commonCopy.metricUnavailablePlaceholder : formatDuration(getEscalationTimeRemaining(activeReportingDetails)) }), _jsx(MetricField, { label: reportingCopy.escalationStarted, children: _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: escalationGameStartTimestamp }) }), _jsx(MetricField, { label: reportingCopy.startBondAttoRep, children: _jsx(CurrencyValue, { precision: 'exact', value: effectiveReportingDetails?.startBondAttoRep, suffix: commonCopy.rep }) })] }) })) : undefined, showFullReporting && reportingReady !== false ? (_jsxs(SectionBlock, { className: 'reporting-outcome-section', title: reportingCopy.reportOutcome, variant: 'embedded', children: [reportActionGuardMessage === undefined ? undefined : (_jsxs(WarningSurface, { ariaLive: 'polite', role: 'status', surface: 'flat', variant: 'compact', children: [_jsx("p", { children: reportActionGuardMessage }), onOpenPriceOracle === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: onOpenPriceOracle, children: reportingCopy.managePoolPrice }) }))] })), _jsxs("div", { className: 'escalation-sides-shell', children: [_jsxs("div", { className: 'escalation-sides-legend', children: [_jsxs("div", { className: 'escalation-sides-legend-item', children: [_jsx("span", { "aria-hidden": 'true', className: 'escalation-sides-legend-swatch escalation-sides-legend-swatch-total' }), _jsx("span", { className: 'panel-label', children: reportingCopy.totalSideDisputeStakedRep })] }), _jsxs("div", { className: 'escalation-sides-legend-item', children: [_jsx("span", { "aria-hidden": 'true', className: 'escalation-sides-legend-swatch escalation-sides-legend-swatch-user' }), _jsx("span", { className: 'panel-label', children: reportingCopy.yourSideDisputeStakedRep })] }), _jsxs("div", { className: 'escalation-sides-legend-item escalation-sides-legend-item-binding', children: [_jsx("span", { "aria-hidden": 'true', className: 'escalation-sides-legend-marker' }), _jsx("span", { className: 'panel-label', children: reportingCopy.leadHoldingCapital }), _jsx(CurrencyValue, { copyable: false, value: displayBindingCapital, suffix: commonCopy.rep })] })] }), _jsx("div", { className: 'escalation-sides', role: 'radiogroup', "aria-label": reportingCopy.reportOutcomeAriaLabel, children: outcomeSides.map((side, index) => (_jsx(EscalationSide, { bindingCapital: displayBindingCapital, chartScaleMax: chartScaleMax, disabled: showWithdrawOnly ? withdrawControlsLocked : reportControlsLocked, isLeading: leadingOutcome === side.key, isSelected: selectedOutcome !== undefined && selectedOutcome === side.key, isTabStop: selectedOutcome === undefined ? index === 0 : selectedOutcome === side.key, onSelect: () => onReportingFormChange({ selectedOutcome: side.key }), side: side }, side.key))) })] }), reportOutcomeSelectionMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: reportOutcomeSelectionMessage }), effectiveReportingDetails?.viewerPoolHeldVaultRepBackingAttoRep === undefined ? undefined : (_jsxs("p", { className: 'detail', children: [reportingCopy.availablePoolHeldVaultRepBackingForReporting, " ", _jsx(CurrencyValue, { value: effectiveReportingDetails.viewerPoolHeldVaultRepBackingAttoRep, suffix: commonCopy.rep }), "."] })), _jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'reporting-contribution-amount', children: _jsx("span", { children: reportingCopy.contributionAmountRep }) }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { id: 'reporting-contribution-amount', className: 'field-inline-input', value: reportingForm.reportAmount, onInput: event => onReportingFormChange({ reportAmount: event.currentTarget.value }), disabled: reportControlsLocked }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => {
                                            if (maxContributionAmount.amountAttoRep === undefined)
                                                return;
                                            onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxContributionAmount.amountAttoRep) });
                                        }, disabled: reportControlsLocked || maxContributionAmount.amountAttoRep === undefined, title: reportControlsLocked ? reportControlsLockedReason : maxContributionAmount.reason, children: commonCopy.max })] })] }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', type: 'button', onClick: () => {
                                    if (minimumOutcomeChangeContribution.amountAttoRep === undefined)
                                        return;
                                    onReportingFormChange({ reportAmount: formatCurrencyInputBalance(minimumOutcomeChangeContribution.amountAttoRep) });
                                }, disabled: reportControlsLocked || minimumOutcomeChangeContribution.amountAttoRep === undefined, "aria-describedby": presetBlocker !== undefined && minimumOutcomeChangeContribution.reason === presetBlocker ? presetBlockerId : undefined, title: reportControlsLocked ? reportControlsLockedReason : minimumOutcomeChangeContribution.reason, children: reportingCopy.minToTakeTheLead }), _jsx("button", { className: 'secondary', type: 'button', onClick: () => {
                                    if (maxProfitContribution.amountAttoRep === undefined)
                                        return;
                                    onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxProfitContribution.amountAttoRep) });
                                }, disabled: reportControlsLocked || maxProfitContribution.amountAttoRep === undefined, "aria-describedby": presetBlocker !== undefined && maxProfitContribution.reason === presetBlocker ? presetBlockerId : undefined, title: reportControlsLocked ? reportControlsLockedReason : maxProfitContribution.reason, children: reportingCopy.maxProfit })] }), presetBlocker === undefined ? undefined : (_jsx("p", { id: presetBlockerId, className: 'detail', children: presetBlocker })), reportAmountError === undefined ? undefined : _jsx("p", { className: 'detail', children: reportAmountError }), actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (_jsxs("p", { className: 'detail', children: [reportingCopy.currentEscalationDisputeStakeLead, _jsx(CurrencyValue, { value: actualReportDepositAmount, suffix: commonCopy.rep }), reportingCopy.acceptedAmountTail] })), _jsx(TransactionReview, { context: [
                            { label: commonCopy.question, value: marketDetails?.title ?? commonCopy.unavailable },
                            { label: commonCopy.universe, value: _jsx(TransactionUniverseValue, { universeId: effectiveReportingDetails?.universeId }) },
                        ], primary: [
                            { label: reportingCopy.disputeStakedRepAfterReport, value: _jsx(CurrencyValue, { value: actualReportDepositAmount, suffix: commonCopy.rep }) },
                            { label: reportingCopy.backedOutcome, value: selectedOutcome === undefined ? reportingCopy.selectedSide : selectedOutcomeLabel },
                        ], details: [
                            { label: reportingCopy.formatEstimatedProfitLabel(selectedOutcomeLabel), value: selectedEstimate === undefined ? commonCopy.metricUnavailablePlaceholder : _jsx(CurrencyValue, { value: selectedEstimate.profit, suffix: commonCopy.rep }) },
                            { label: reportingCopy.timerChange, value: reportingTimerChange ?? commonCopy.metricUnavailablePlaceholder },
                            {
                                label: reportingCopy.recheckBy,
                                value: reportingRecheckTimestamp === undefined ? commonCopy.metricUnavailablePlaceholder : _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: reportingRecheckTimestamp }),
                            },
                            { label: reportingCopy.poolHeldVaultRepBackingAfterReport, value: _jsx(CurrencyValue, { value: resultingAvailableReportingRep, suffix: commonCopy.rep }) },
                            { label: reportingCopy.assumption, value: reportingCopy.projectionAssumption },
                        ], risks: [reportingCopy.reportingDisputeStakeRisk, reportingCopy.reportTimerRisk, reportingCopy.escalationClaimNonTradeableDetail] }), _jsxs("div", { className: 'reporting-shared-action-region', children: [shouldRenderSharedReportSettlementDisabledReason ? (_jsx("p", { className: 'detail', id: settlementDisabledReasonId, children: _jsx(LoadingAwareText, { children: sharedReportSettlementDisabledReason }) })) : undefined, _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: reportButtonLabel, pendingLabel: reportingCopy.submittingReport, onClick: onReportOutcome, pending: reportingActiveAction === 'reportOutcome', availability: { disabled: !isOnActiveAppChain || !reportOutcomeEnabled || reportButtonGuardMessage !== undefined, reason: reportActionDisabledReason }, disabledReasonElementId: reportDisabledReasonElementId, showDisabledReason: reportDisabledReasonElementId === undefined }) })] })] })) : undefined, showSettlementSection && reportingReady !== false ? (_jsxs(SectionBlock, { className: 'reporting-settlement-section', title: reportingCopy.settleEscalationDeposits, variant: 'embedded', children: [displayedWithdrawGuardMessage === undefined || displayedWithdrawGuardMessage === sharedReportSettlementDisabledReason ? undefined : (_jsx("p", { className: 'detail', id: settlementDisabledReasonId, children: _jsx(LoadingAwareText, { children: displayedWithdrawGuardMessage }) })), settlementContextMessage === undefined || settlementContextMessage === withdrawGuardMessage ? undefined : _jsx("p", { className: 'detail', children: settlementContextMessage }), hasImportedForkedDeposits ? _jsx("p", { className: 'detail', children: reportingCopy.forkCarriedSettlementRedirectDetail }) : undefined, shouldShowWithdrawEmptyState && activeReportingDetails?.settlementState !== 'migration-required' && activeReportingDetails?.settlementState !== 'migration-expired' ? _jsx("p", { className: 'detail', children: reportingCopy.walletUnsettledDepositsEmpty }) : undefined, activeReportingDetails?.settlementState === 'migration-required' || activeReportingDetails?.settlementState === 'migration-expired'
                        ? undefined
                        : withdrawableSides.map(side => {
                            const selectedWithdrawDepositIndexes = selectedWithdrawDepositIndexesByOutcome[side.key];
                            const allWithdrawDepositIndexes = side.userDeposits.map(deposit => deposit.depositIndex);
                            const claimLabel = getWithdrawDepositClaimLabel(effectiveReportingDetails, side.key);
                            const withdrawSelectedGuardMessage = withdrawGuardMessage ?? (!withdrawEscalationEnabled || selectedWithdrawDepositIndexes.length > 0 ? undefined : reportingCopy.settlementSelectionRequired);
                            const withdrawSelectedUsesSharedReason = withdrawGuardMessage !== undefined && withdrawSelectedGuardMessage === withdrawGuardMessage;
                            const withdrawAllUsesSharedReason = withdrawGuardMessage !== undefined;
                            const isPendingSide = withdrawActionPending && pendingWithdrawOutcome === side.key;
                            return (_jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: side.label, variant: 'embedded', children: [_jsxs("div", { className: 'field', children: [_jsx("span", { children: reportingCopy.chooseDepositsToSettle }), _jsx(EscalationDepositSelectionList, { disabled: withdrawControlsLocked || withdrawActionPending, items: side.userDeposits.map(deposit => {
                                                    const claimAmount = getEscalationDepositClaimAmount(effectiveReportingDetails, side.key, deposit);
                                                    return {
                                                        deposit,
                                                        details: [
                                                            _jsxs(_Fragment, { children: [reportingCopy.initiallyDeposited, " ", _jsx(CurrencyValue, { value: deposit.amountAttoRep, suffix: commonCopy.rep })] }),
                                                            claimAmount === undefined ? (reportingCopy.worthAfterFinalizationPendingFinalization) : (_jsxs(_Fragment, { children: [reportingCopy.worthNow, " ", _jsx(CurrencyValue, { value: claimAmount, suffix: commonCopy.rep })] })),
                                                        ],
                                                        secondaryDetails: [
                                                            `${reportingCopy.currentClaimType} ${claimLabel ?? reportingCopy.pendingFinalization}`,
                                                            _jsxs(_Fragment, { children: [reportingCopy.entryDepth, " ", _jsx(CurrencyValue, { value: deposit.cumulativeAmountAttoRep, suffix: commonCopy.rep })] }),
                                                        ],
                                                    };
                                                }), onSelectionChange: nextSelectedWithdrawDepositIndexes => onReportingFormChange({
                                                    selectedWithdrawDepositIndexesByOutcome: {
                                                        ...selectedWithdrawDepositIndexesByOutcome,
                                                        [side.key]: nextSelectedWithdrawDepositIndexes,
                                                    },
                                                }), selectedDepositIndexes: selectedWithdrawDepositIndexes })] }), _jsxs("div", { className: 'actions', children: [_jsx(TransactionActionButton, { idleLabel: reportingCopy.formatSettleSelectedDepositsLabel(side.label), pendingLabel: reportingCopy.formatSettlingDepositsPendingLabel(side.label), onClick: () => handleWithdrawEscalation(side.key, selectedWithdrawDepositIndexes), pending: isPendingSide, disabled: withdrawActionPending && pendingWithdrawOutcome !== side.key, disabledReasonElementId: withdrawSelectedUsesSharedReason ? settlementActionDisabledReasonId : undefined, tone: 'secondary', availability: { disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawSelectedGuardMessage !== undefined, reason: withdrawSelectedGuardMessage }, showDisabledReason: !withdrawSelectedUsesSharedReason }), _jsx(TransactionActionButton, { idleLabel: reportingCopy.formatSettleAllDepositsLabel(side.label), pendingLabel: reportingCopy.formatSettlingDepositsPendingLabel(side.label), onClick: () => handleWithdrawEscalation(side.key, allWithdrawDepositIndexes), pending: isPendingSide, disabled: withdrawActionPending && pendingWithdrawOutcome !== side.key, disabledReasonElementId: withdrawAllUsesSharedReason ? settlementActionDisabledReasonId : undefined, tone: 'secondary', availability: { disabled: !isOnActiveAppChain || !withdrawEscalationEnabled || withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }, showDisabledReason: !withdrawAllUsesSharedReason })] })] }, side.key));
                        })] })) : undefined, forkTriggeredActions, _jsx(ErrorNotice, { message: reportingError }), reportingError === undefined || showSecurityPoolAddressInput ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', disabled: loadingReportingDetails, onClick: onLoadReporting, type: 'button', children: loadingReportingDetails ? _jsx(LoadingText, { children: reportingCopy.loadingEscalation }) : reportingCopy.retryReporting }) }))] }));
    if (embedInCard)
        return sections;
    return (_jsx(RouteWorkflowPanel, { showHeader: showHeader, title: reportingCopy.reportingWorkflow, children: sections }));
}
//# sourceMappingURL=ReportingSection.js.map