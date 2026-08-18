import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as forkAuctionCopy from '@zoltar/ui-zoltar/copy/forkAuction.js';
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js';
import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { zeroAddress } from '@zoltar/shared/ethereum';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { EscalationDepositSelectionList } from '@zoltar/ui-zoltar/features/reporting/components/EscalationDepositSelectionList.js';
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { ImportedForkSettlementSection } from '@zoltar/ui-zoltar/features/reporting/components/ImportedForkSettlementSection.js';
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js';
import { LoadingAwareText, LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js';
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { TransactionUniverseValue } from '@zoltar/ui-zoltar/features/universes/components/TransactionUniverseValue.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js';
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js';
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js';
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js';
import { createActionAvailability } from '@zoltar/ui-core-shared/lib/actionAvailability.js';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, AUCTION_TIME_SECONDS, getForkAuctionStageLabel, getForkAuctionStageView, getTimeRemaining } from '../lib/forkAuction.js';
import { buildTruthAuctionDepthPoints, estimateRepPurchased, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js';
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js';
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js';
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js';
import { formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { tryParseTruthAuctionAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js';
import { getWrongNetworkMessage, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js';
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '@zoltar/ui-zoltar/features/reporting/lib/reportingDomain.js';
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js';
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection } from '../../security-pools/lib/securityPoolWorkflow.js';
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js';
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js';
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js';
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js';
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js';
function sameBigIntArray(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function sameBigIntRecord(left, right) {
    return sameBigIntArray(left.invalid, right.invalid) && sameBigIntArray(left.yes, right.yes) && sameBigIntArray(left.no, right.no);
}
const FORK_MIGRATION_DURATION = 4838400n;
const FORK_WORKFLOW_NAV_STAGES = ['fork-triggered', 'migration', 'auction', 'settlement'];
function getForkWorkflowStageLabel(stage) {
    switch (stage) {
        case 'fork-triggered':
            return forkAuctionCopy.forkReadiness;
        case 'migration':
            return forkAuctionCopy.migration;
        case 'auction':
            return commonCopy.truthAuction;
        case 'settlement':
            return commonCopy.settlement;
        default:
            return assertNever(stage);
    }
}
function getForkWorkflowStageOrder(stage) {
    return FORK_WORKFLOW_NAV_STAGES.indexOf(stage);
}
function getForkWorkflowStageIcon(stage) {
    switch (stage) {
        case 'fork-triggered':
            return _jsx("span", { "aria-hidden": 'true', className: 'fork-workflow-stage-icon fork-workflow-stage-icon-triggered' });
        case 'migration':
            return _jsx("span", { "aria-hidden": 'true', className: 'fork-workflow-stage-icon fork-workflow-stage-icon-migration' });
        case 'auction':
            return _jsx("span", { "aria-hidden": 'true', className: 'fork-workflow-stage-icon fork-workflow-stage-icon-auction' });
        case 'settlement':
            return _jsx("span", { "aria-hidden": 'true', className: 'fork-workflow-stage-icon fork-workflow-stage-icon-settlement' });
        default:
            return assertNever(stage);
    }
}
function getTruthAuctionWindow(startedAt) {
    if (startedAt === undefined || startedAt === 0n)
        return undefined;
    return {
        startedAt,
        endsAt: startedAt + AUCTION_TIME_SECONDS,
    };
}
function renderMetricValue(value, suffix, fallbackText) {
    if (value === undefined)
        return fallbackText;
    return _jsx(CurrencyValue, { value: value, suffix: suffix });
}
function renderTruthAuctionPriceValue(value, fallbackText = commonCopy.metricUnavailablePlaceholder) {
    if (value === undefined)
        return fallbackText;
    const formattedPrice = formatRoundedCurrencyBalance(value, 18, 4);
    const exactPrice = formatCurrencyInputBalance(value);
    return (_jsxs("span", { className: 'truth-auction-price-value', title: forkAuctionCopy.formatEthPerRepValue(exactPrice), children: [formattedPrice, " ", forkAuctionCopy.ethRep] }));
}
function renderAddress(address) {
    if (address === undefined)
        return commonCopy.metricUnavailablePlaceholder;
    return _jsx(AddressValue, { address: address });
}
function renderTimestamp({ displayTimestamp, fallbackText }) {
    if (displayTimestamp === undefined)
        return fallbackText;
    return _jsx(TimestampValue, { timestamp: displayTimestamp });
}
function renderTruthAuctionCapacityOwnershipNotice(showRefundOnlySettlementCopy = false) {
    if (showRefundOnlySettlementCopy) {
        return (_jsx(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: _jsxs("p", { className: 'detail', children: [_jsx("strong", { children: forkAuctionCopy.refundSettlementDetail }), " ", forkAuctionCopy.formatFinalizedRefundOnlySettlementNotice(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)] }) }));
    }
    return (_jsx(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: _jsxs("p", { className: 'detail', children: [_jsx("strong", { children: forkAuctionCopy.formatWinningClaimCapacityOwnershipHeadline(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL) }), " ", forkAuctionCopy.formatWinningClaimSettlementNotice(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)] }) }));
}
function renderTruthAuctionSettlementSelectionSummary({ estimatedAssignedCapacityOwnershipAttoRep, estimatedRefundedAttoEth, estimatedVaultRepBackingAttoRep, selectedClaimCount, selectedRefundCount, selectedRowCount, }) {
    if (selectedRowCount === 0)
        return undefined;
    const summaryDescription = (() => {
        if (selectedClaimCount > 0 && selectedRefundCount > 0) {
            return forkAuctionCopy.formatMixedSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
        }
        if (selectedClaimCount > 0) {
            return forkAuctionCopy.formatWinningSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
        }
        return forkAuctionCopy.formatRefundSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
    })();
    const refundDescription = estimatedRefundedAttoEth > 0n ? forkAuctionCopy.truthAuctionRefundEstimateDetail : undefined;
    let roundingDescription;
    if (selectedClaimCount > 0) {
        if (estimatedVaultRepBackingAttoRep === undefined) {
            roundingDescription = forkAuctionCopy.underfundedWinningClaimUnavailable;
        }
        else {
            roundingDescription = forkAuctionCopy.settlementRoundingNotice;
        }
    }
    return (_jsxs(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: [_jsxs("p", { className: 'detail', children: [_jsx("strong", { children: forkAuctionCopy.selectedBidSettlementPreview }), " ", summaryDescription] }), renderWorkflowMetricGrid([
                { label: forkAuctionCopy.selectedBids, value: selectedRowCount.toString() },
                { label: forkAuctionCopy.selectedWinningBids, value: selectedClaimCount.toString() },
                { label: forkAuctionCopy.selectedRefundRows, value: selectedRefundCount.toString() },
                { label: forkAuctionCopy.estimatedVaultRepBackingAttoRep, value: estimatedVaultRepBackingAttoRep === undefined ? commonCopy.metricUnavailablePlaceholder : _jsx(CurrencyValue, { value: estimatedVaultRepBackingAttoRep, suffix: commonCopy.rep }) },
                { label: forkAuctionCopy.formatEstimatedValue(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL), value: estimatedAssignedCapacityOwnershipAttoRep === undefined ? commonCopy.metricUnavailablePlaceholder : _jsx(CurrencyValue, { value: estimatedAssignedCapacityOwnershipAttoRep, suffix: commonCopy.rep }) },
                { label: forkAuctionCopy.estimatedRefundedAttoEth, value: _jsx(CurrencyValue, { value: estimatedRefundedAttoEth, suffix: commonCopy.eth }) },
            ]), roundingDescription === undefined ? undefined : _jsx("p", { className: 'detail', children: roundingDescription }), refundDescription === undefined ? undefined : _jsx("p", { className: 'detail', children: refundDescription })] }));
}
function getForkOnlyFallbackText(hasPreviewForkActivity) {
    return hasPreviewForkActivity ? commonCopy.metricUnavailablePlaceholder : forkAuctionCopy.forkUnavailablePlaceholder;
}
function getForkTypeLabel(forkOwnSecurityPool) {
    return forkOwnSecurityPool ? forkAuctionCopy.ownEscalationFork : forkAuctionCopy.parentZoltarFork;
}
function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }) {
    if (previewPool === undefined)
        return commonCopy.metricUnavailablePlaceholder;
    if (!hasPreviewForkActivity)
        return forkAuctionCopy.forkUnavailablePlaceholder;
    if (isSyntheticForkTriggerPreview)
        return forkAuctionCopy.notChosen;
    return getForkTypeLabel(previewPool.forkOwnSecurityPool);
}
function getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) {
    if (previewPool === undefined)
        return commonCopy.metricUnavailablePlaceholder;
    if (!hasPreviewForkActivity)
        return forkAuctionCopy.forkUnavailablePlaceholder;
    if (previewPool.truthAuctionStartedAt > 0n)
        return commonCopy.metricUnavailablePlaceholder;
    return commonCopy.metricUnavailablePlaceholder;
}
function getForkWorkflowStageAheadMessage(stage, currentStage) {
    if (getForkWorkflowStageOrder(stage) <= getForkWorkflowStageOrder(currentStage))
        return undefined;
    return undefined;
}
function getForkWorkflowStageClassName({ currentStage, selectedStage, stage }) {
    const classNames = ['fork-workflow-stage'];
    if (currentStage === stage)
        classNames.push('is-current');
    if (selectedStage === stage)
        classNames.push('is-selected');
    if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage))
        classNames.push('is-complete');
    if (getForkWorkflowStageOrder(stage) > getForkWorkflowStageOrder(currentStage))
        classNames.push('is-upcoming');
    return classNames.join(' ');
}
function getForkWorkflowSeparatorClassName({ currentStage, stage }) {
    const classNames = ['fork-workflow-stage-separator'];
    if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage))
        classNames.push('is-complete');
    if (getForkWorkflowStageOrder(stage) >= getForkWorkflowStageOrder(currentStage))
        classNames.push('is-upcoming');
    return classNames.join(' ');
}
function renderWorkflowMetricGrid(metrics) {
    return (_jsx(MetricGrid, { children: metrics.map(metric => (_jsx(MetricField, { label: metric.label, children: metric.value }, metric.label))) }));
}
function renderChildSecurityPoolsSection({ auctionOutcomeSelector, childSecurityPools, renderSelectedOutcomeChildPoolNotice }) {
    return (_jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: forkAuctionCopy.childSecurityPools, variant: 'embedded', children: [auctionOutcomeSelector, renderSelectedOutcomeChildPoolNotice(), childSecurityPools.length === 0 ? null : (_jsx("div", { className: 'fork-workflow-child-pool-list', children: childSecurityPools.map(pool => (_jsxs("article", { className: 'fork-workflow-child-pool-card', children: [_jsxs("div", { className: 'fork-workflow-child-pool-card-copy', children: [_jsx("strong", { children: pool.questionOutcome === 'none' ? forkAuctionCopy.pendingOutcome : getReportingOutcomeLabel(pool.questionOutcome) }), _jsx("span", { children: pool.systemState === 'operational' ? commonCopy.operational : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedAttoRep: pool.migratedAttoRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt })) })] }), _jsxs("div", { className: 'fork-workflow-child-pool-card-meta', children: [_jsx("span", { children: _jsx(AddressValue, { address: pool.securityPoolAddress }) }), _jsx(SecurityPoolLink, { securityPoolAddress: pool.securityPoolAddress, universeId: pool.universeId, children: forkAuctionCopy.openSecurityPool })] })] }, pool.securityPoolAddress))) }))] }));
}
function estimateBidRep(bidAmount, bidPrice) {
    if (bidPrice === undefined)
        return undefined;
    const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseTruthAuctionAmountInput(bidAmount);
    if (parsedBidAmount === undefined)
        return undefined;
    return estimateRepPurchased(parsedBidAmount, bidPrice);
}
function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }) {
    if (migrationEndsAt === undefined)
        return forkAuctionCopy.migrationTimingIsUnavailable;
    if (currentTimestamp === undefined)
        return forkAuctionCopy.loadingCurrentChainTime;
    if (currentTimestamp <= migrationEndsAt)
        return forkAuctionCopy.truthAuctionMigrationPendingDetail;
    return undefined;
}
function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }) {
    if (migrationEndsAt === undefined)
        return forkAuctionCopy.migrationTimingIsUnavailable;
    if (currentTimestamp === undefined)
        return forkAuctionCopy.loadingCurrentChainTime;
    if (currentTimestamp > migrationEndsAt)
        return forkAuctionCopy.parentMigrationExpiredDetail;
    return undefined;
}
function getTruthAuctionBypassReason({ migratedAttoRep, parentSettlementCollateralAttoEthAmount, auctionableAttoRepAtFork }) {
    if (parentSettlementCollateralAttoEthAmount === 0n)
        return forkAuctionCopy.truthAuctionNoCollateralDetail;
    if (auctionableAttoRepAtFork === undefined)
        return undefined;
    if (auctionableAttoRepAtFork === 0n)
        return forkAuctionCopy.truthAuctionNoRepDetail;
    if (migratedAttoRep >= auctionableAttoRepAtFork)
        return forkAuctionCopy.childUniverseFullyMigratedDetail;
    return undefined;
}
function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }) {
    if (truthAuction === undefined)
        return forkAuctionCopy.loadingTruthAuction;
    if (truthAuction.finalized)
        return forkAuctionCopy.truthAuctionFinalizedReason;
    if (truthAuctionEndsAt === undefined)
        return forkAuctionCopy.auctionEndTimeUnavailable;
    if (currentTimestamp === undefined)
        return forkAuctionCopy.loadingCurrentChainTime;
    if (currentTimestamp <= truthAuctionEndsAt)
        return forkAuctionCopy.auctionOngoingReason;
    return undefined;
}
function clampPercentage(value, maxValue) {
    return (getVisualRatio({ value, maxValue }) ?? 0) * 100;
}
function getTruthAuctionStateBadge({ hasSelectedAuctionChildPool, isStartTruthAuctionInProgress, startTruthAuctionCountdown, truthAuction, truthAuctionStartedAt, }) {
    if (truthAuction === undefined) {
        if (isStartTruthAuctionInProgress || (hasSelectedAuctionChildPool && truthAuctionStartedAt === 0n && startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n)) {
            return { label: commonCopy.pending, tone: 'pending' };
        }
        if (truthAuctionStartedAt > 0n)
            return { label: forkAuctionCopy.started, tone: 'pending' };
        return { label: forkAuctionCopy.inactive, tone: 'muted' };
    }
    if (!truthAuction.finalized) {
        if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) {
            return { label: forkAuctionCopy.clearing, tone: 'pending' };
        }
        return { label: forkAuctionCopy.open, tone: 'pending' };
    }
    if (truthAuction.underfunded)
        return { label: forkAuctionCopy.shortfall, tone: 'blocked' };
    if (truthAuction.hitCap)
        return { label: commonCopy.settled, tone: 'ok' };
    return { label: forkAuctionCopy.unfilled, tone: 'muted' };
}
function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }) {
    if (migrationEndsAt === undefined)
        return { label: forkAuctionCopy.notStartedBadgeLabel, tone: 'muted' };
    if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n)
        return { label: forkAuctionCopy.closed, tone: 'ok' };
    if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt)
        return { label: forkAuctionCopy.closed, tone: 'ok' };
    return { label: forkAuctionCopy.open, tone: 'pending' };
}
function isFullReadClient(client) {
    return client !== undefined && 'getBlock' in client && 'multicall' in client;
}
export function ForkAuctionSection({ accountState, auctionDetailsOverride, currentStageView, currentTimestamp, disabled = false, embedInCard = false, forkAuctionDetails, forkAuctionActiveAction, forkAuctionError, forkAuctionForm, forkAuctionResult, forkMigrationReadClient, lifecycleStateOverride, loadingReportingDetails = false, loadingForkAuctionDetails, onClaimAuctionProceeds, onFinalizeTruthAuction, onForkAuctionFormChange, onLoadForkAuction, onMigrateRepToZoltar, onClaimParentEscalationDeposits, onMigrateUnresolvedEscalation, onMigrateVault, onRefundLosingBids, onLoadReporting, onReportingFormChange, onStartTruthAuction, onSubmitBid, onWithdrawForkedEscalation, previewPool, reportingDetails, reportingError, reportingForm, selectedStageView, selectedPoolRefreshNonce = 0, securityPools = [], universeForkTime, stageView, onSelectedStageViewChange, showHeader = true, showSecurityPoolAddressInput = true, truthAuctionReadClient, }) {
    const isOnActiveAppChain = isActiveAppChain(accountState.chainId);
    const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime;
    const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress;
    const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId;
    const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState;
    const hasEnteredForkLifecycle = lifecycleStateOverride === 'poolForked' || lifecycleStateOverride === 'forkMigration' || lifecycleStateOverride === 'forkTruthAuction';
    const hasTriggeredFork = hasEnteredForkLifecycle || (universeForkTime !== undefined && universeForkTime > 0n);
    const forkOutcome = forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome;
    const questionOutcome = forkAuctionDetails?.questionOutcome ?? previewPool?.questionOutcome;
    const previewPoolHasActualForkActivity = previewPool?.hasForkActivity === true;
    const isSyntheticForkTriggerPreview = lifecycleStateOverride === 'poolForked' && !previewPoolHasActualForkActivity;
    const hasPreviewForkActivity = previewPoolHasActualForkActivity || lifecycleStateOverride === 'poolForked';
    const previewForkTypeLabel = getPreviewForkTypeLabel({
        hasPreviewForkActivity,
        isSyntheticForkTriggerPreview,
        previewPool,
    });
    const resolvedForkTypeLabel = forkAuctionDetails === undefined ? previewForkTypeLabel : getForkTypeLabel(forkAuctionDetails.forkOwnSecurityPool);
    const forkOnlyFallbackText = getForkOnlyFallbackText(hasPreviewForkActivity);
    const migrationSummaryText = forkAuctionDetails === undefined ? getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) : undefined;
    const hasLoadedPoolContext = securityPoolAddress !== undefined && systemState !== undefined;
    const selectedOutcomeLabel = getReportingOutcomeLabel(forkAuctionForm.selectedOutcome);
    const selectedAuctionLabel = selectedOutcomeLabel;
    const { currentStage, currentWorkflowStage, selectedStage } = getForkWorkflowStageSelection({
        currentStageView,
        forkAuctionDetails,
        forkOutcome,
        previewPool,
        selectedStageView,
        stageView,
        systemState,
    });
    const selectedStageAheadMessage = getForkWorkflowStageAheadMessage(selectedStage, currentWorkflowStage);
    const currentSelectedOutcomePool = previewPool !== undefined && previewPool.questionOutcome === forkAuctionForm.selectedOutcome ? previewPool : undefined;
    const connectedWalletVaultSummary = accountState.address === undefined || previewPool === undefined ? undefined : previewPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address));
    const selectedOutcomeMigrationChildPool = securityPoolAddress === undefined ? undefined : securityPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === forkAuctionForm.selectedOutcome);
    const selectedOutcomeMigrationChildVault = selectedOutcomeMigrationChildPool === undefined || accountState.address === undefined ? undefined : selectedOutcomeMigrationChildPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address));
    const fullTruthAuctionReadClient = isFullReadClient(truthAuctionReadClient) ? truthAuctionReadClient : undefined;
    const { loadingSelectedAuctionChildPoolRecovery, loadingSelectedOutcomeMigrationSeedStatus, retryingSelectedAuctionDetails, retrySelectedAuctionChildPoolRecovery, retrySelectedAuctionDetails, retrySelectedOutcomeMigrationSeedStatus, selectedAuctionChildPool, selectedAuctionChildPoolRecoveryError, selectedAuctionDetails, selectedAuctionError, selectedOutcomeMigrationSeedStatus, selectedOutcomeMigrationSeedStatusError, } = useSelectedAuctionReadState({
        accountAddress: accountState.address,
        currentSelectedOutcomePool,
        forkAuctionResultHash: forkAuctionResult?.hash,
        forkMigrationReadClient,
        fullTruthAuctionReadClient,
        securityPoolAddress,
        selectedAuctionLabel,
        selectedOutcome: forkAuctionForm.selectedOutcome,
        selectedOutcomeMigrationChildPool,
        selectedPoolRefreshNonce,
        selectedStage,
        universeId,
    });
    const selectedAuctionPoolAddress = selectedAuctionChildPool?.securityPoolAddress;
    const selectedAuctionUniverseId = selectedAuctionChildPool?.universeId;
    const currentRootAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
        forkAuctionDetails: forkAuctionDetails?.securityPoolAddress !== undefined && selectedAuctionPoolAddress !== undefined && sameAddress(forkAuctionDetails.securityPoolAddress, selectedAuctionPoolAddress) ? forkAuctionDetails : undefined,
        selectedPool: selectedAuctionChildPool,
    });
    const currentSelectedAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
        forkAuctionDetails: selectedAuctionDetails,
        selectedPool: selectedAuctionChildPool,
    });
    const selectedAuctionContext = (() => {
        if (auctionDetailsOverride !== undefined)
            return auctionDetailsOverride;
        if (currentRootAuctionDetails !== undefined)
            return currentRootAuctionDetails;
        if (currentSelectedAuctionDetails !== undefined)
            return currentSelectedAuctionDetails;
        return undefined;
    })();
    const auctionSecurityPoolAddress = selectedAuctionContext?.securityPoolAddress ?? selectedAuctionChildPool?.securityPoolAddress;
    const auctionTruthAuctionAddress = selectedAuctionContext?.truthAuctionAddress ?? selectedAuctionChildPool?.truthAuctionAddress;
    const auctionTruthAuctionStatus = selectedAuctionContext?.truthAuction;
    const auctionHasStartedAtValue = selectedAuctionContext?.truthAuctionStartedAt ?? selectedAuctionChildPool?.truthAuctionStartedAt ?? 0n;
    const hasSelectedAuctionChildPool = selectedAuctionChildPool !== undefined;
    const selectedAuctionContextError = selectedAuctionError;
    const optimisticTruthAuctionStartedAt = forkAuctionResult?.action === 'startTruthAuction' && auctionSecurityPoolAddress !== undefined && sameAddress(forkAuctionResult.securityPoolAddress, auctionSecurityPoolAddress) ? (effectiveCurrentTimestamp ?? forkAuctionDetails?.migrationEndsAt ?? selectedAuctionContext?.currentTime ?? 1n) : undefined;
    let effectiveTruthAuctionStartedAt = optimisticTruthAuctionStartedAt;
    if (auctionHasStartedAtValue > 0n)
        effectiveTruthAuctionStartedAt = auctionHasStartedAtValue;
    const hasStartedTruthAuction = effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n;
    const { beginStartTruthAuctionProgress, beginVaultMigrationProgress, hasCompletedVaultMigration, isStartTruthAuctionInProgressState, isVaultMigrationPending, optimisticClaimedParentDisputeStakedRep, setPendingParentEscalationClaimSelection } = useForkAuctionInteractionState({
        accountAddress: accountState.address,
        connectedWalletDisputeStakedAttoRep: connectedWalletVaultSummary?.disputeStakedAttoRep,
        forkAuctionActiveAction,
        forkAuctionError,
        forkAuctionResult,
        hasStartedTruthAuction,
        reportingDetails,
        securityPoolAddress,
        startTruthAuctionSecurityPoolAddress: selectedAuctionPoolAddress,
    });
    const effectiveDisputeStakedAttoRep = (() => {
        if (connectedWalletVaultSummary === undefined)
            return undefined;
        if (connectedWalletVaultSummary.disputeStakedAttoRep > optimisticClaimedParentDisputeStakedRep) {
            return connectedWalletVaultSummary.disputeStakedAttoRep - optimisticClaimedParentDisputeStakedRep;
        }
        return 0n;
    })();
    const activeReportingDetails = reportingDetails?.status === 'active' ? reportingDetails : undefined;
    const isMigrationRequired = activeReportingDetails?.settlementState === 'migration-required';
    const isMigrationExpired = activeReportingDetails?.settlementState === 'migration-expired';
    const escalationMigrationEntitlement = reportingDetails?.viewerEscalationMigrationEntitlement;
    const hasStoredEscalationMigrationEntitlement = escalationMigrationEntitlement?.initialized === true;
    const selectedOutcomeEscalationEntitlementMaterialized = escalationMigrationEntitlement?.materializedByOutcome[forkAuctionForm.selectedOutcome] === true;
    const hasUnresolvedMigrationState = isMigrationRequired || isMigrationExpired || hasStoredEscalationMigrationEntitlement;
    const selectedParentEscalationClaimSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome);
    const selectedParentEscalationClaimDeposits = selectedParentEscalationClaimSide?.userDeposits ?? [];
    const selectedParentEscalationClaimDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? [];
    const showSelectedParentEscalationClaimDeposits = !loadingReportingDetails && reportingDetails?.status === 'active';
    const hasSelectedParentEscalationClaimDeposits = selectedParentEscalationClaimDeposits.length > 0;
    const unresolvedMigrationSides = activeReportingDetails?.sides ?? [];
    const [selectedImportedForkDepositIndexesByOutcome, setSelectedImportedForkDepositIndexesByOutcome] = useState({
        invalid: [],
        yes: [],
        no: [],
    });
    function renderSelectedOutcomeChildPoolLink() {
        if (selectedAuctionChildPool === undefined)
            return undefined;
        return (_jsx(SecurityPoolLink, { className: 'fork-workflow-outcome-link', securityPoolAddress: selectedAuctionChildPool.securityPoolAddress, universeId: selectedAuctionChildPool.universeId, children: forkAuctionCopy.childPool }));
    }
    const migrationBalancesContent = (() => {
        if (accountState.address === undefined)
            return _jsx("p", { className: 'detail', children: forkAuctionCopy.parentBalancesWalletRequired });
        if (connectedWalletVaultSummary === undefined)
            return _jsx("p", { className: 'detail', children: forkAuctionCopy.parentVaultBalancesUnavailableDetail });
        const selectedOutcomeMigrationVaultBalanceContent = (() => {
            if (selectedOutcomeMigrationChildPool === undefined)
                return undefined;
            return (_jsxs(_Fragment, { children: [_jsx("p", { className: 'detail', children: forkAuctionCopy.migratedBalancesForThisOutcome }), renderWorkflowMetricGrid([
                        { label: forkAuctionCopy.selectedOutcomeRepCollateral, value: _jsx(CurrencyValue, { value: selectedOutcomeMigrationChildVault?.vaultAttoRepBacking ?? 0n, suffix: commonCopy.rep }) },
                        { label: forkAuctionCopy.selectedOutcomeCapacityOwnershipAttoRep, value: _jsx(CurrencyValue, { value: selectedOutcomeMigrationChildVault?.capacityOwnershipAttoRep ?? 0n, suffix: commonCopy.rep }) },
                    ])] }));
        })();
        return (_jsxs(_Fragment, { children: [renderWorkflowMetricGrid([
                    { label: commonCopy.repCollateral, value: _jsx(CurrencyValue, { value: connectedWalletVaultSummary.vaultAttoRepBacking, suffix: commonCopy.rep }) },
                    { label: commonCopy.capacityOwnershipAttoRep, value: _jsx(CurrencyValue, { value: connectedWalletVaultSummary.capacityOwnershipAttoRep, suffix: commonCopy.rep }) },
                    { label: commonCopy.disputeStakedAttoRep, value: _jsx(CurrencyValue, { value: effectiveDisputeStakedAttoRep ?? 0n, suffix: commonCopy.rep }) },
                ]), _jsx("div", { className: 'form-grid fork-workflow-outcome-selector', children: _jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.outcome }), _jsxs("div", { className: 'fork-workflow-outcome-selector-row', children: [_jsx(EnumDropdown, { options: REPORTING_OUTCOME_DROPDOWN_OPTIONS, value: forkAuctionForm.selectedOutcome, onChange: selectedOutcome => onForkAuctionFormChange({ selectedOutcome }) }), renderSelectedOutcomeChildPoolLink()] })] }) }), renderSelectedOutcomeChildPoolNotice(), selectedOutcomeMigrationVaultBalanceContent] }));
    })();
    const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.vaultAttoRepBacking > 0n || connectedWalletVaultSummary.capacityOwnershipAttoRep > 0n);
    const hasWalletParentEscalationClaimBalance = effectiveDisputeStakedAttoRep !== undefined && effectiveDisputeStakedAttoRep > 0n;
    const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? forkAuctionCopy.poolMigrationCapacityEmpty : undefined;
    const claimParentEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? forkAuctionCopy.walletDisputeStakedRepEmpty : undefined;
    const totalUnresolvedMigrationDepositCount = unresolvedMigrationSides.reduce((count, side) => count + side.userDeposits.length, 0);
    const hasUnresolvedMigrationDeposits = totalUnresolvedMigrationDepositCount > 0;
    const importedForkSettlementSides = activeReportingDetails?.sides.filter(side => side.importedUserDeposits.length > 0) ?? [];
    const hasImportedForkSettlementDeposits = importedForkSettlementSides.length > 0;
    const importedForkSettlementResolved = isPoolQuestionFinalized(activeReportingDetails);
    const childSecurityPools = securityPoolAddress === undefined ? [] : securityPools.filter(pool => sameAddress(pool.parent, securityPoolAddress));
    const enteredBidPreview = getTruthAuctionBidPreview(forkAuctionForm.submitBidPrice);
    const enteredBidPrice = enteredBidPreview?.enteredPrice;
    const submittedBidPrice = enteredBidPreview?.submittedPrice;
    const enteredBidTick = enteredBidPreview?.tick;
    const enteredBidAmount = tryParseTruthAuctionAmountInput(forkAuctionForm.submitBidAmount);
    const estimatedAttoRep = estimateBidRep(forkAuctionForm.submitBidAmount, submittedBidPrice);
    const resultingBidEthBalance = enteredBidAmount === undefined || accountState.ethBalanceAttoEth === undefined || enteredBidAmount > accountState.ethBalanceAttoEth ? undefined : accountState.ethBalanceAttoEth - enteredBidAmount;
    const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt);
    const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt;
    const truthAuctionFallback = (() => {
        if (auctionTruthAuctionStatus !== undefined)
            return commonCopy.metricUnavailablePlaceholder;
        if (hasSelectedAuctionChildPool)
            return commonCopy.metricUnavailablePlaceholder;
        return forkOnlyFallbackText;
    })();
    const truthAuctionStatus = auctionTruthAuctionStatus;
    const isTruthAuctionDetailsLoading = hasSelectedAuctionChildPool && hasStartedTruthAuction && truthAuctionStatus === undefined && selectedAuctionContextError === undefined;
    const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && auctionTruthAuctionAddress !== undefined && auctionTruthAuctionAddress !== zeroAddress;
    const { aggregatedAuctionBidCountForLoadedTicks, aggregatedAuctionBids, hasMoreAggregatedAuctionBids, hasMoreTickSummaries, hasMoreViewerBids, hasLoadedAggregatedAuctionBids, hasLoadedTruthAuctionBook, hasLoadedViewerTruthAuctionBids, loadNextAuctionBidPage, loadNextTickPage, loadNextViewerBidPage, loadingAggregatedAuctionBids, loadingTruthAuctionBook, loadingViewerTruthAuctionBids, retryingPublicTruthAuctionBook, retryingViewerTruthAuctionBids, retryPublicTruthAuctionBook, retryViewerTruthAuctionBids, selectTruthAuctionTick, selectedBookTick, truthAuctionBookData, truthAuctionBookError, viewerTruthAuctionBidsError, } = useTruthAuctionBookData({
        accountAddress: accountState.address,
        enteredBidTick,
        forkAuctionResultHash: forkAuctionResult?.hash,
        selectedStage,
        shouldShowTruthAuctionVisualization,
        truthAuctionAddress: auctionTruthAuctionAddress,
        truthAuctionClearingTick: truthAuctionStatus?.clearingTick,
        truthAuctionReadClient,
    });
    const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuctionStatus);
    const startTruthAuctionCountdown = forkAuctionDetails?.migrationEndsAt === undefined || effectiveCurrentTimestamp === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, effectiveCurrentTimestamp);
    const isStartTruthAuctionInProgress = (() => {
        if (hasStartedTruthAuction)
            return false;
        if (isStartTruthAuctionInProgressState)
            return true;
        if (forkAuctionActiveAction === 'startTruthAuction')
            return true;
        return false;
    })();
    const truthAuctionStateBadge = getTruthAuctionStateBadge({
        hasSelectedAuctionChildPool,
        isStartTruthAuctionInProgress,
        startTruthAuctionCountdown,
        truthAuction: truthAuctionStatus,
        truthAuctionStartedAt: effectiveTruthAuctionStartedAt ?? 0n,
    });
    const startedDisplay = (() => {
        if (hasStartedTruthAuction) {
            return renderTimestamp({
                displayTimestamp: effectiveTruthAuctionStartedAt,
                fallbackText: forkAuctionCopy.notStarted,
            });
        }
        if (isStartTruthAuctionInProgress)
            return forkAuctionCopy.startingTruncated;
        if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
            if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n)
                return forkAuctionCopy.formatStartsInValue(formatDuration(startTruthAuctionCountdown));
            return forkAuctionCopy.notStarted;
        }
        return forkAuctionCopy.notStarted;
    })();
    const endsDisplay = (() => {
        if (auctionWindow === undefined)
            return isStartTruthAuctionInProgress ? forkAuctionCopy.pendingConfirmation : forkAuctionCopy.notStarted;
        return _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: auctionWindow.endsAt });
    })();
    const hasStartedSelectedTruthAuctionTimeline = hasStartedTruthAuction || truthAuctionStatus !== undefined || selectedStage === 'auction' || selectedStage === 'settlement' || currentWorkflowStage === 'auction' || currentWorkflowStage === 'settlement';
    const activeTickSummaries = truthAuctionBookData.tickSummaries;
    const truthAuctionOverviewProgress = getTruthAuctionOverviewProgress(truthAuctionStatus, activeTickSummaries);
    const displayedEthRaisedAttoEth = truthAuctionOverviewProgress?.attoEthRaised ?? truthAuctionStatus?.attoEthRaised ?? 0n;
    const displayedRepSoldAttoRep = truthAuctionOverviewProgress?.attoRepSold ?? truthAuctionStatus?.totalAttoRepPurchased ?? 0n;
    const ethRaisedProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedEthRaisedAttoEth, truthAuctionStatus.attoEthRaiseCap);
    const repSoldProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedRepSoldAttoRep, truthAuctionStatus.maxAttoRepBeingSold);
    const truthAuctionDepthPoints = buildTruthAuctionDepthPoints({
        enteredBidTick,
        selectedBookTick,
        tickSummaries: activeTickSummaries,
        truthAuction: truthAuctionStatus,
    });
    const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick);
    const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick);
    const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined);
    const maxTickAttoEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalBidAttoEth > maximumEth ? point.currentTotalBidAttoEth : maximumEth), 0n);
    const ethRaisedCapDisplay = truthAuctionStatus === undefined ? (truthAuctionFallback) : (_jsxs(Fragment, { children: [_jsx(CurrencyValue, { value: displayedEthRaisedAttoEth, suffix: commonCopy.eth }), " / ", _jsx(CurrencyValue, { value: truthAuctionStatus.attoEthRaiseCap, suffix: commonCopy.eth })] }));
    const clearingPriceDisplay = truthAuctionStatus === undefined ? truthAuctionFallback : renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice);
    const settlementAvailableDisplay = (() => {
        if (!hasSelectedAuctionChildPool)
            return forkAuctionCopy.forkUnavailablePlaceholder;
        if (selectedAuctionContext?.claimingAvailable)
            return commonCopy.yes;
        return commonCopy.no;
    })();
    const settlementBidRows = getTruthAuctionSettlementBidRows({
        accountAddress: accountState.address,
        truthAuction: truthAuctionStatus,
        viewerBids: truthAuctionBookData.viewerBids,
    });
    const { isSettleSelectedBidsInProgress, selectedSettlementBidKeys, setSelectedSettlementBidKeys, settlementBidResultByKey, settlementSelectionState, submitClaimBidsByKeys, submitRefundBidsByKeys, submitSelectedSettlementBids } = useTruthAuctionSettlementActionState({
        accountAddress: accountState.address,
        forkAuctionError,
        forkAuctionResult,
        onClaimAuctionProceeds,
        onRefundLosingBids,
        selectedAuctionPoolAddress,
        selectedAuctionUniverseId,
        selectedStage,
        settlementBidRows,
        truthAuctionFinalized: truthAuctionStatus?.finalized === true,
    });
    const selectedSettlementBidRows = settlementSelectionState.selectedRows;
    const selectedRefundSettlementBidRows = settlementSelectionState.selectedRefundRows;
    const selectedClaimSettlementBidRows = settlementSelectionState.selectedClaimRows;
    const selectedClaimSettlementBidKeys = settlementSelectionState.selectedClaimKeys;
    const selectedRefundSettlementBidKeys = settlementSelectionState.selectedRefundKeys;
    const settlementSelectionMode = settlementSelectionState.selectionMode;
    const settlementSelectionHasClaims = settlementSelectionState.selectionHasClaims;
    const settlementSelectionHasRefunds = settlementSelectionState.selectionHasRefunds;
    const settlementSelectionEstimate = getTruthAuctionSettlementSelectionEstimate({
        auctionedCapacityOwnershipAttoRep: selectedAuctionContext?.auctionedCapacityOwnershipAttoRep,
        selectedRows: selectedSettlementBidRows,
        truthAuction: truthAuctionStatus,
    });
    const settlementAction = getTruthAuctionSettlementAction({
        selectionHasClaims: settlementSelectionHasClaims,
        selectionHasRefunds: settlementSelectionHasRefunds,
        truthAuctionFinalized: truthAuctionStatus?.finalized === true,
    }) ?? 'refundLosingBids';
    const showRefundOnlySettlementCapacityOwnershipNotice = truthAuctionStatus?.finalized === true && selectedRefundSettlementBidRows.length > 0 && selectedClaimSettlementBidRows.length === 0;
    const settlementActionLabel = forkAuctionCopy.settleSelectedBids;
    const settlementActionDescription = (() => {
        if (settlementSelectionMode === 'claim')
            return forkAuctionCopy.formatWinningBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
        if (settlementSelectionMode === 'refund') {
            if (truthAuctionStatus?.finalized === true)
                return forkAuctionCopy.formatFinalizedRefundBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
            return forkAuctionCopy.formatRefundableBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
        }
        return forkAuctionCopy.formatMixedBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
    })();
    const settlementActionPendingLabel = forkAuctionCopy.submittingSettlementTransactionTruncated;
    const auctionBidRows = buildTruthAuctionBidRows({
        bids: aggregatedAuctionBids,
        truthAuction: truthAuctionStatus,
    });
    const viewerBidRowsViewModel = buildViewerTruthAuctionBidRows({
        accountAddress: accountState.address,
        isSettlementInProgress: isSettleSelectedBidsInProgress,
        selectedBidKeys: selectedSettlementBidKeys,
        selectedStage,
        settlementResultByKey: settlementBidResultByKey,
        truthAuction: truthAuctionStatus,
        viewerBids: truthAuctionBookData.viewerBids,
    });
    const viewerBidRows = viewerBidRowsViewModel.rows;
    const showViewerSettlementActionColumn = viewerBidRowsViewModel.showSettlementActionColumn;
    const onSettlementBidSelectionChange = (bidKey, checked) => {
        setSelectedSettlementBidKeys(currentKeys => updateTruthAuctionSettlementBidSelection(currentKeys, bidKey, checked));
    };
    const interactionDisabledReason = (() => {
        if (accountState.address === undefined)
            return forkAuctionCopy.forkActionWalletRequired;
        if (!isOnActiveAppChain)
            return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
        return undefined;
    })();
    const forkPoolState = evaluateSecurityPoolState({
        forkStage: deriveSecurityPoolForkStage({
            currentStage,
            workflowDisabled: disabled,
        }),
        lifecycleState: lifecycleStateOverride ??
            deriveSecurityPoolLifecycleState({
                hasForkActivity: forkAuctionDetails?.hasForkActivity ?? previewPool?.hasForkActivity,
                isChildPool: (forkAuctionDetails?.parentSecurityPoolAddress ?? previewPool?.parent) !== zeroAddress,
                questionOutcome,
                systemState,
                universeHasForked: previewPool?.universeHasForked,
            }),
        universeHasForked: previewPool?.universeHasForked === true,
    });
    const truthAuctionBidGuardMessage = (() => {
        if (isTruthAuctionDetailsLoading)
            return undefined;
        if (!hasStartedTruthAuction)
            return forkAuctionCopy.truthAuctionNotStartedReason;
        if (selectedAuctionContextError !== undefined)
            return selectedAuctionContextError;
        return getTruthAuctionBidGuardMessage({
            accountAddress: accountState.address,
            currentTimestamp: effectiveCurrentTimestamp,
            isOnActiveAppChain,
            submitBidAmountInput: forkAuctionForm.submitBidAmount,
            truthAuction: truthAuctionStatus,
            walletBalanceAttoEth: accountState.ethBalanceAttoEth,
        });
    })();
    const startTruthAuctionGuardMessage = getStartTruthAuctionGuardMessage({
        currentTimestamp: effectiveCurrentTimestamp,
        migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
    });
    const finalizeTruthAuctionGuardMessage = getFinalizeTruthAuctionGuardMessage({
        currentTimestamp: effectiveCurrentTimestamp,
        truthAuction: truthAuctionStatus,
        truthAuctionEndsAt,
    });
    const truthAuctionEndedNotice = (() => {
        if (truthAuctionStatus === undefined)
            return undefined;
        const hasEndedByTime = truthAuctionEndsAt !== undefined && effectiveCurrentTimestamp !== undefined && effectiveCurrentTimestamp >= truthAuctionEndsAt;
        if (!truthAuctionStatus.finalized && !hasEndedByTime)
            return undefined;
        return (_jsxs("div", { className: 'notice success', children: [_jsxs("p", { children: [_jsx("strong", { children: forkAuctionCopy.auctionEndedStatus }), " ", truthAuctionStatus.finalized ? forkAuctionCopy.formatFinalizedSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL) : forkAuctionCopy.truthAuctionFinalizationRequiredDetail, ' ', truthAuctionEndsAt === undefined ? undefined : (_jsxs(Fragment, { children: [forkAuctionCopy.endedAtLead, _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: truthAuctionEndsAt })] }))] }), truthAuctionStatus.finalized ? undefined : (_jsx("div", { className: 'actions', children: renderStageActionButton({
                        action: 'finalizeTruthAuction',
                        availability: createActionAvailability(finalizeTruthAuctionGuardMessage),
                        forceEnabled: hasSelectedAuctionChildPool,
                        idleLabel: forkAuctionCopy.finalizeTruthAuction,
                        onClick: onFinalizeTruthAuctionForSelectedAuction,
                        pendingLabel: forkAuctionCopy.finalizingTruthAuctionTruncated,
                    }) }))] }));
    })();
    const startTruthAuctionReadyInText = (() => {
        if (startTruthAuctionCountdown === undefined)
            return undefined;
        if (startTruthAuctionCountdown === 0n)
            return undefined;
        return forkAuctionCopy.formatTruthAuctionStartDelay(formatDuration(startTruthAuctionCountdown));
    })();
    const isVaultMigrationComplete = hasCompletedVaultMigration || (connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance);
    const truthAuctionBypassReason = getTruthAuctionBypassReason({
        migratedAttoRep: selectedAuctionContext?.migratedAttoRep ?? selectedAuctionChildPool?.migratedAttoRep ?? 0n,
        parentSettlementCollateralAttoEthAmount: forkAuctionDetails?.settlementCollateralAttoEth ?? previewPool?.settlementCollateralAttoEth,
        auctionableAttoRepAtFork: forkAuctionDetails?.auctionableAttoRepAtFork,
    });
    const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice);
    const startTruthAuctionAvailabilityMessage = (() => {
        if (isStartTruthAuctionInProgress)
            return forkAuctionCopy.startingTruthAuction;
        return startTruthAuctionGuardMessage;
    })();
    const setSelectedParentEscalationClaimDepositIndexes = (nextSelectedDepositIndexes) => {
        if (onReportingFormChange === undefined || reportingForm === undefined)
            return;
        onReportingFormChange({
            selectedWithdrawDepositIndexesByOutcome: {
                ...reportingForm.selectedWithdrawDepositIndexesByOutcome,
                [forkAuctionForm.selectedOutcome]: nextSelectedDepositIndexes,
            },
        });
    };
    const claimSelectedParentEscalationDepositsGuardMessage = (() => {
        if (claimParentEscalationBalanceGuardMessage !== undefined)
            return claimParentEscalationBalanceGuardMessage;
        if (loadingReportingDetails)
            return forkAuctionCopy.eligibleDepositsLoading;
        if (reportingDetails?.status !== 'active')
            return forkAuctionCopy.escalationDepositDetailsUnavailable;
        if (isMigrationRequired)
            return forkAuctionCopy.useUnresolvedMigrationReason;
        if (isMigrationExpired)
            return forkAuctionCopy.unresolvedMigrationExpiredReason;
        if (selectedParentEscalationClaimDeposits.length === 0)
            return forkAuctionCopy.formatNoClaimableParentEscalationDeposits(selectedOutcomeLabel);
        if (selectedParentEscalationClaimDepositIndexes.length > 0)
            return undefined;
        return forkAuctionCopy.parentEscalationClaimSelectionRequired;
    })();
    const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
        currentTimestamp: effectiveCurrentTimestamp,
        migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
    });
    const migrateUnresolvedEscalationGuardMessage = (() => {
        if (migrationWindowClosedGuardMessage !== undefined)
            return migrationWindowClosedGuardMessage;
        if (loadingReportingDetails)
            return forkAuctionCopy.unresolvedDepositsLoading;
        if (selectedOutcomeEscalationEntitlementMaterialized)
            return forkAuctionCopy.formatEntitlementAlreadyMaterialized(selectedOutcomeLabel);
        if (hasStoredEscalationMigrationEntitlement)
            return undefined;
        if (!isMigrationRequired)
            return forkAuctionCopy.unresolvedMigrationUnavailableReason;
        if (activeReportingDetails === undefined)
            return forkAuctionCopy.unresolvedDepositDetailsUnavailable;
        if (!hasUnresolvedMigrationDeposits)
            return forkAuctionCopy.walletUnresolvedDepositsEmpty;
        return undefined;
    })();
    const migratePoolToUniverseGuardMessage = (() => {
        if (loadingSelectedOutcomeMigrationSeedStatus)
            return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(selectedOutcomeLabel);
        if (selectedOutcomeMigrationSeedStatusError !== undefined)
            return selectedOutcomeMigrationSeedStatusError;
        if (selectedOutcomeMigrationSeedStatus?.seeded)
            return forkAuctionCopy.formatPoolRepAlreadyMigrated(selectedOutcomeLabel);
        return undefined;
    })();
    const selectedOutcomeMigrationSeedGuardMessage = (() => {
        if (migrateVaultBalanceGuardMessage !== undefined)
            return undefined;
        if (loadingSelectedOutcomeMigrationSeedStatus)
            return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(selectedOutcomeLabel);
        if (selectedOutcomeMigrationSeedStatusError !== undefined)
            return selectedOutcomeMigrationSeedStatusError;
        if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded)
            return undefined;
        return forkAuctionCopy.formatPoolMigrationRequiredForVault(selectedOutcomeLabel);
    })();
    const migrateVaultCompletedMessage = isVaultMigrationComplete ? forkAuctionCopy.vaultMigrationCompleteReason : undefined;
    const vaultMigrationInProgressMessage = isVaultMigrationPending ? forkAuctionCopy.migratingVault : undefined;
    const migrateVaultGuardMessage = isMigrationRequired ? forkAuctionCopy.combinedUnresolvedMigrationDetail : (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage);
    const submitBidGuardMessage = truthAuctionBidGuardMessage ?? bidPriceValidationMessage;
    const migrationStateBadge = getMigrationStateBadge({
        currentTimestamp: effectiveCurrentTimestamp,
        effectiveTruthAuctionStartedAt,
        migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
    });
    const migrationStatusBadge = _jsx(Badge, { tone: migrationStateBadge.tone, children: migrationStateBadge.label });
    const onStartTruthAuctionSubmit = () => {
        beginStartTruthAuctionProgress();
        onStartTruthAuction(selectedAuctionPoolAddress, selectedAuctionUniverseId);
    };
    const onSubmitBidForSelectedAuction = () => {
        onSubmitBid(selectedAuctionPoolAddress, selectedAuctionUniverseId);
    };
    function onFinalizeTruthAuctionForSelectedAuction() {
        onFinalizeTruthAuction(selectedAuctionPoolAddress, selectedAuctionUniverseId);
    }
    const settlementActionAvailabilityMessage = getTruthAuctionSettlementActionAvailabilityMessage({
        claimingAvailable: selectedAuctionContext?.claimingAvailable,
        selectedClaimRows: selectedClaimSettlementBidRows,
        selectedRows: selectedSettlementBidRows,
        selectionHasClaims: settlementSelectionHasClaims,
        selectionHasRefunds: settlementSelectionHasRefunds,
        truthAuction: truthAuctionStatus,
    });
    const onRefundLosingBidsForSelectedAuction = () => {
        if (selectedRefundSettlementBidRows.length === 0)
            return;
        submitRefundBidsByKeys(selectedRefundSettlementBidKeys);
    };
    const onSettleSelectedBidsForSelectedAuction = () => {
        submitSelectedSettlementBids();
    };
    const onClaimAuctionProceedsForSelectedAuction = () => {
        if (selectedClaimSettlementBidRows.length === 0)
            return;
        submitClaimBidsByKeys(selectedClaimSettlementBidKeys);
    };
    const onMigrateVaultSubmit = () => {
        beginVaultMigrationProgress();
        onMigrateVault();
    };
    const onMigrateSelectedOutcomeRepToZoltar = () => {
        onMigrateRepToZoltar([forkAuctionForm.selectedOutcome]);
    };
    const onClaimSelectedParentEscalationDeposits = () => {
        setPendingParentEscalationClaimSelection({
            depositIndexes: selectedParentEscalationClaimDepositIndexes,
            outcome: forkAuctionForm.selectedOutcome,
        });
        onClaimParentEscalationDeposits(forkAuctionForm.selectedOutcome, selectedParentEscalationClaimDepositIndexes);
    };
    const onMigrateUnresolvedEscalationSubmit = () => {
        setPendingParentEscalationClaimSelection(undefined);
        beginVaultMigrationProgress();
        onMigrateUnresolvedEscalation(forkAuctionForm.selectedOutcome);
    };
    const onWithdrawForkedEscalationSubmit = (outcome) => {
        const selectedDepositIndexes = selectedImportedForkDepositIndexesByOutcome[outcome];
        if (selectedDepositIndexes.length === 0)
            return;
        onWithdrawForkedEscalation(outcome, selectedDepositIndexes);
    };
    function renderStageActionButton({ action, availability, forceEnabled, idleLabel, onClick, pendingLabel, pending, tone = 'secondary', }) {
        const resolvedAvailability = availability ?? { disabled: false, reason: undefined };
        const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled;
        const disabledReason = !isOnActiveAppChain ? (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) : (interactionDisabledReason ?? resolvedAvailability.reason);
        const isPending = pending ?? forkAuctionActiveAction === action;
        return (_jsx(TransactionActionButton, { idleLabel: idleLabel, pendingLabel: pendingLabel, onClick: onClick, pending: isPending, tone: tone, availability: {
                disabled: !isOnActiveAppChain || !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
                reason: disabledReason,
            } }));
    }
    function renderSelectedOutcomeChildPoolNotice() {
        if (selectedAuctionChildPool !== undefined)
            return undefined;
        const noticeContent = (() => {
            if (loadingSelectedAuctionChildPoolRecovery)
                return (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: forkAuctionCopy.formatLoadingOutcomePoolDetail(selectedOutcomeLabel) }) }));
            if (selectedAuctionChildPoolRecoveryError !== undefined)
                return _jsx(ErrorNotice, { message: selectedAuctionChildPoolRecoveryError });
            return _jsx("p", { className: 'detail', children: forkAuctionCopy.formatMissingOutcomePoolDetail(selectedOutcomeLabel) });
        })();
        return (_jsxs("div", { className: 'fork-workflow-outcome-notice', children: [noticeContent, selectedAuctionChildPoolRecoveryError === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', onClick: retrySelectedAuctionChildPoolRecovery, type: 'button', children: forkAuctionCopy.retryChildUniverse }) }))] }));
    }
    const renderSubmitBidSection = () => (_jsx(SectionBlock, { title: forkAuctionCopy.submitBidTitle, variant: 'embedded', children: _jsxs("div", { className: 'form-grid', children: [submitBidPreviewTickSummary === undefined ? undefined : (_jsxs("p", { className: 'detail', children: [forkAuctionCopy.selectedLadderPriceLead, renderTruthAuctionPriceValue(submitBidPreviewTickSummary.price)] })), _jsxs("div", { className: 'field-row', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: forkAuctionCopy.bidPriceEthRep }), _jsx(FormInput, { value: forkAuctionForm.submitBidPrice, onInput: event => onForkAuctionFormChange({ submitBidPrice: event.currentTarget.value }) })] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: forkAuctionCopy.bidAmountEth }), _jsx(FormInput, { value: forkAuctionForm.submitBidAmount, onInput: event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value }) })] })] }), _jsx(TransactionReview, { context: [
                        { label: commonCopy.question, value: selectedAuctionChildPool?.marketDetails.title ?? previewPool?.marketDetails.title ?? commonCopy.unavailable },
                        { label: commonCopy.securityPoolAddress, value: auctionSecurityPoolAddress === undefined ? commonCopy.unavailable : _jsx(AddressValue, { address: auctionSecurityPoolAddress }) },
                        { label: commonCopy.universe, value: _jsx(TransactionUniverseValue, { universeId: selectedAuctionChildPool?.universeId ?? universeId }) },
                        { label: commonCopy.outcome, value: selectedAuctionLabel },
                    ], primary: [
                        { label: transactionReviewCopy.youPay, value: _jsx(CurrencyValue, { value: enteredBidAmount, suffix: commonCopy.eth }) },
                        { label: forkAuctionCopy.potentialRepIfFilled, value: _jsx(CurrencyValue, { value: estimatedAttoRep, suffix: commonCopy.rep }) },
                    ], details: [
                        { label: forkAuctionCopy.enteredBidPrice, value: enteredBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(enteredBidPrice) },
                        { label: forkAuctionCopy.submittedTickPrice, value: submittedBidPrice === undefined ? commonCopy.metricUnavailablePlaceholder : renderTruthAuctionPriceValue(submittedBidPrice) },
                        { label: transactionReviewCopy.resultingEthBalance, value: _jsx(CurrencyValue, { value: resultingBidEthBalance, suffix: commonCopy.eth }) },
                    ], risks: [forkAuctionCopy.bidEscrowRisk, forkAuctionCopy.bidFillRisk, forkAuctionCopy.winningBidCapacityOwnershipRisk] }), _jsx("div", { className: 'actions', children: renderStageActionButton({
                        action: 'submitBid',
                        availability: createActionAvailability(submitBidGuardMessage),
                        forceEnabled: hasSelectedAuctionChildPool,
                        idleLabel: forkAuctionCopy.submitBid,
                        onClick: onSubmitBidForSelectedAuction,
                        pending: isTruthAuctionDetailsLoading || forkAuctionActiveAction === 'submitBid',
                        pendingLabel: isTruthAuctionDetailsLoading ? forkAuctionCopy.loadingTruthAuction : forkAuctionCopy.submittingBidTruncated,
                    }) })] }) }));
    const renderSettlementActionSection = ({ action, description, idleLabel, pendingLabel, pending = false, selectionSummary, title, availabilityMessage, onClick, tone = 'primary', }) => (_jsxs(SectionBlock, { density: 'compact', title: title, headingLevel: 4, variant: 'embedded', children: [description === undefined || selectionSummary !== undefined ? undefined : _jsx("p", { className: 'detail', children: description }), selectionSummary, selectionSummary === undefined ? renderTruthAuctionCapacityOwnershipNotice(showRefundOnlySettlementCapacityOwnershipNotice) : undefined, _jsx("div", { className: 'actions', children: renderStageActionButton({
                    action,
                    availability: createActionAvailability(availabilityMessage),
                    forceEnabled: hasSelectedAuctionChildPool,
                    idleLabel,
                    onClick: onClick ?? (action === 'refundLosingBids' ? onRefundLosingBidsForSelectedAuction : onClaimAuctionProceedsForSelectedAuction),
                    pendingLabel,
                    pending,
                    tone,
                }) })] }));
    useEffect(() => {
        if (!isMigrationRequired || onReportingFormChange === undefined || reportingForm === undefined || activeReportingDetails === undefined)
            return;
        const nextSelectedDepositIndexesByOutcome = {
            invalid: activeReportingDetails.sides.find(side => side.key === 'invalid')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
            yes: activeReportingDetails.sides.find(side => side.key === 'yes')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
            no: activeReportingDetails.sides.find(side => side.key === 'no')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
        };
        if (sameBigIntRecord(nextSelectedDepositIndexesByOutcome, reportingForm.selectedWithdrawDepositIndexesByOutcome))
            return;
        onReportingFormChange({
            selectedWithdrawDepositIndexesByOutcome: nextSelectedDepositIndexesByOutcome,
        });
    }, [activeReportingDetails, isMigrationRequired, onReportingFormChange, reportingForm]);
    useEffect(() => {
        const nextSelectedImportedDepositIndexesByOutcome = {
            invalid: importedForkSettlementSides.find(side => side.key === 'invalid')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
            yes: importedForkSettlementSides.find(side => side.key === 'yes')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
            no: importedForkSettlementSides.find(side => side.key === 'no')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
        };
        setSelectedImportedForkDepositIndexesByOutcome(currentSelections => {
            const prunedSelections = {
                invalid: currentSelections.invalid.filter(index => nextSelectedImportedDepositIndexesByOutcome.invalid.includes(index)),
                yes: currentSelections.yes.filter(index => nextSelectedImportedDepositIndexesByOutcome.yes.includes(index)),
                no: currentSelections.no.filter(index => nextSelectedImportedDepositIndexesByOutcome.no.includes(index)),
            };
            if (sameBigIntRecord(prunedSelections, currentSelections))
                return currentSelections;
            return prunedSelections;
        });
    }, [importedForkSettlementSides]);
    const migrationStartedAt = (() => {
        if (universeForkTime !== undefined && universeForkTime > 0n)
            return universeForkTime;
        if (forkAuctionDetails?.migrationEndsAt !== undefined)
            return forkAuctionDetails.migrationEndsAt - FORK_MIGRATION_DURATION;
        return undefined;
    })();
    const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : _jsx(CurrencyValue, { value: forkAuctionDetails.auctionableAttoRepAtFork, suffix: commonCopy.rep });
    const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedAttoRep ?? previewPool?.migratedAttoRep, commonCopy.rep, commonCopy.metricUnavailablePlaceholder);
    const migrationSettlementCollateralDisplay = renderMetricValue(forkAuctionDetails?.settlementCollateralAttoEth ?? previewPool?.settlementCollateralAttoEth, commonCopy.eth, commonCopy.metricUnavailablePlaceholder);
    const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? forkAuctionCopy.notStarted : _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: migrationStartedAt });
    const migrationEndsDisplay = (() => {
        if (forkAuctionDetails === undefined)
            return migrationSummaryText;
        if (hasStartedSelectedTruthAuctionTimeline && effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) {
            return _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: effectiveTruthAuctionStartedAt });
        }
        if (forkAuctionDetails.migrationEndsAt === undefined)
            return forkAuctionCopy.notStarted;
        return _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: forkAuctionDetails.migrationEndsAt });
    })();
    const truthAuctionStateBadgeElement = _jsx(Badge, { tone: truthAuctionStateBadge.tone, children: truthAuctionStateBadge.label });
    const auctionStatusMetrics = [
        { label: forkAuctionCopy.truthAuctionAddress, value: renderAddress(auctionTruthAuctionAddress) },
        { label: forkAuctionCopy.started, value: startedDisplay },
        { label: commonCopy.ends, value: endsDisplay },
        { label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
        { label: forkAuctionCopy.repPurchasedAttoRep, value: truthAuctionStatus === undefined ? truthAuctionFallback : _jsx(CurrencyValue, { value: displayedRepSoldAttoRep, suffix: commonCopy.rep }) },
        { label: forkAuctionCopy.clearingPrice, value: clearingPriceDisplay },
        { label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : _jsx(CurrencyValue, { value: selectedAuctionContext.auctionedCapacityOwnershipAttoRep, suffix: commonCopy.rep }) },
        { label: forkAuctionCopy.minBidSizeAttoEth, value: truthAuctionStatus === undefined ? truthAuctionFallback : _jsx(CurrencyValue, { value: truthAuctionStatus.minBidSizeAttoEth, suffix: commonCopy.eth }) },
        { label: forkAuctionCopy.maxAttoRepBeingSold, value: truthAuctionStatus === undefined ? truthAuctionFallback : _jsx(CurrencyValue, { value: truthAuctionStatus.maxAttoRepBeingSold, suffix: commonCopy.rep }) },
    ];
    const settlementStatusMetrics = [
        { label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : _jsx(CurrencyValue, { value: selectedAuctionContext.auctionedCapacityOwnershipAttoRep, suffix: commonCopy.rep }) },
        { label: forkAuctionCopy.settlementAvailable, value: settlementAvailableDisplay },
        { label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
        { label: forkAuctionCopy.repPurchasedAttoRep, value: truthAuctionStatus === undefined ? truthAuctionFallback : _jsx(CurrencyValue, { value: displayedRepSoldAttoRep, suffix: commonCopy.rep }) },
    ];
    const auctionOutcomeSelector = (_jsx("div", { className: 'form-grid fork-workflow-outcome-selector', children: _jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.outcome }), _jsxs("div", { className: 'fork-workflow-outcome-selector-row', children: [_jsx(EnumDropdown, { options: REPORTING_OUTCOME_DROPDOWN_OPTIONS, value: forkAuctionForm.selectedOutcome, onChange: selectedOutcome => onForkAuctionFormChange({ selectedOutcome }) }), renderSelectedOutcomeChildPoolLink()] })] }) }));
    const truthAuctionHero = (() => {
        if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined)
            return undefined;
        return (_jsx(TruthAuctionSummaryCard, { auctionedCapacityOwnershipAttoRepDisplay: selectedAuctionContext === undefined ? commonCopy.metricUnavailablePlaceholder : _jsx(CurrencyValue, { value: selectedAuctionContext.auctionedCapacityOwnershipAttoRep, suffix: commonCopy.rep }), badge: truthAuctionStateBadgeElement, clearingPriceDisplay: renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice), displayedEthRaisedAttoEth: displayedEthRaisedAttoEth, displayedRepSoldAttoRep: displayedRepSoldAttoRep, endsDisplay: endsDisplay, attoEthRaiseCap: truthAuctionStatus.attoEthRaiseCap, ethRaisedProgress: ethRaisedProgress, maxAttoRepBeingSold: truthAuctionStatus.maxAttoRepBeingSold, minBidSizeAttoEth: truthAuctionStatus.minBidSizeAttoEth, repSoldProgress: repSoldProgress, startedDisplay: startedDisplay, winningThresholdPriceDisplay: winningThresholdPrice === undefined ? undefined : renderTruthAuctionPriceValue(winningThresholdPrice) }));
    })();
    const migrationSummaryCard = (_jsxs(SectionBlock, { badge: migrationStatusBadge, className: 'fork-workflow-summary-card migration-summary-card', title: forkAuctionCopy.migrationStatus, variant: 'embedded', children: [_jsxs("div", { className: 'fork-workflow-summary', children: [_jsxs("div", { className: 'fork-workflow-summary-primary migration-summary-primary', children: [_jsx("div", { className: 'fork-workflow-summary-stat-group', children: _jsxs("div", { className: 'fork-workflow-summary-stat-copy', children: [_jsx("span", { children: forkAuctionCopy.repAtFork }), _jsx("strong", { children: migrationRepAtForkDisplay })] }) }), _jsx("div", { className: 'fork-workflow-summary-stat-group', children: _jsxs("div", { className: 'fork-workflow-summary-stat-copy', children: [_jsx("span", { children: forkAuctionCopy.migratedAttoRep }), _jsx("strong", { children: migrationRepDisplay })] }) }), _jsx("div", { className: 'fork-workflow-summary-stat-group', children: _jsxs("div", { className: 'fork-workflow-summary-stat-copy', children: [_jsx("span", { children: forkAuctionCopy.settlementCollateral }), _jsx("strong", { children: migrationSettlementCollateralDisplay })] }) })] }), _jsxs("div", { className: 'fork-workflow-summary-metrics', children: [_jsx(MetricField, { label: forkAuctionCopy.migrationStarted, children: migrationStartedDisplay }), _jsx(MetricField, { label: forkAuctionCopy.migrationEnds, children: migrationEndsDisplay }), _jsx(MetricField, { label: forkAuctionCopy.forkType, children: resolvedForkTypeLabel })] })] }), forkAuctionDetails?.ownForkRepBuckets === undefined ? undefined : (_jsx(ReadOnlyDetailAccordion, { title: forkAuctionCopy.advancedDiagnostics, children: _jsxs("div", { className: 'fork-workflow-summary-metrics', children: [_jsx(MetricField, { label: forkAuctionCopy.totalPoolHeldRepAtForkAttoRep, children: _jsx(CurrencyValue, { value: forkAuctionDetails.ownForkRepBuckets.vaultRepAtForkAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: forkAuctionCopy.escalationChildRepPerSelectedOutcomeAttoRep, children: _jsx(CurrencyValue, { value: forkAuctionDetails.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: forkAuctionCopy.escrowSourceRepAtForkAttoRep, children: _jsx(CurrencyValue, { value: forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtForkAttoRep, suffix: commonCopy.rep }) })] }) }))] }));
    const truthAuctionMarketViewSection = (() => {
        if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined)
            return undefined;
        return (_jsx(TruthAuctionMarketViewSection, { clearingTick: truthAuctionStatus.clearingTick, hasMoreTickSummaries: hasMoreTickSummaries, loadingTruthAuctionBook: loadingTruthAuctionBook, maxTickAttoEth: maxTickAttoEth, onLoadNextTickPage: loadNextTickPage, onSelectTick: selectTruthAuctionTick, renderPriceValue: renderTruthAuctionPriceValue, showDepthClearingTick: truthAuctionStatus.hitCap && truthAuctionStatus.clearingTick !== undefined, truthAuctionBookError: truthAuctionBookError, truthAuctionDepthPoints: truthAuctionDepthPoints }));
    })();
    const auctionWideBidsSection = (() => {
        if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined)
            return undefined;
        return (_jsx(TruthAuctionBidsSection, { aggregatedAuctionBidCountForLoadedTicks: aggregatedAuctionBidCountForLoadedTicks, error: truthAuctionBookError, hasLoadedData: hasLoadedTruthAuctionBook && hasLoadedAggregatedAuctionBids, hasMoreAggregatedAuctionBids: hasMoreAggregatedAuctionBids, loadedTickCount: truthAuctionBookData.tickSummaries.length, loadingAggregatedAuctionBids: loadingTruthAuctionBook || loadingAggregatedAuctionBids, onLoadNextAuctionBidPage: loadNextAuctionBidPage, onRetry: retryPublicTruthAuctionBook, renderPriceValue: renderTruthAuctionPriceValue, retrying: retryingPublicTruthAuctionBook, rows: auctionBidRows }));
    })();
    const auctionWideBidsStatusSection = !isTruthAuctionDetailsLoading && selectedAuctionContextError === undefined && !retryingSelectedAuctionDetails ? undefined : (_jsxs(SectionBlock, { title: forkAuctionCopy.currentBids, variant: 'embedded', children: [isTruthAuctionDetailsLoading && !retryingSelectedAuctionDetails ? (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: forkAuctionCopy.loadingAuctionBids }) })) : undefined, _jsx(ErrorNotice, { message: selectedAuctionContextError }), selectedAuctionContextError === undefined && !retryingSelectedAuctionDetails ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', disabled: retryingSelectedAuctionDetails, onClick: retrySelectedAuctionDetails, type: 'button', children: retryingSelectedAuctionDetails ? _jsx(LoadingText, { children: forkAuctionCopy.retryingAuctionDetails }) : forkAuctionCopy.retryAuctionDetails }) }))] }));
    const viewerTruthAuctionBidsSection = (() => {
        if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined)
            return undefined;
        return (_jsx(ViewerTruthAuctionBidsSection, { accountAddress: accountState.address, error: viewerTruthAuctionBidsError, hasLoadedData: hasLoadedViewerTruthAuctionBids, hasMoreViewerBids: hasMoreViewerBids, loadingTruthAuctionBook: loadingViewerTruthAuctionBids, onLoadNextViewerBidPage: loadNextViewerBidPage, onRetry: retryViewerTruthAuctionBids, onSettlementBidSelectionChange: onSettlementBidSelectionChange, renderPriceValue: renderTruthAuctionPriceValue, retrying: retryingViewerTruthAuctionBids, rows: viewerBidRows, showSettlementActionColumn: showViewerSettlementActionColumn }));
    })();
    const truthAuctionSettlementSection = (() => {
        if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined)
            return undefined;
        return renderSettlementActionSection({
            action: settlementAction,
            pending: isSettleSelectedBidsInProgress,
            availabilityMessage: settlementActionAvailabilityMessage,
            description: settlementActionDescription,
            idleLabel: settlementActionLabel,
            pendingLabel: settlementActionPendingLabel,
            selectionSummary: renderTruthAuctionSettlementSelectionSummary({
                estimatedAssignedCapacityOwnershipAttoRep: settlementSelectionEstimate.estimatedAssignedCapacityOwnershipAttoRep,
                estimatedRefundedAttoEth: settlementSelectionEstimate.estimatedRefundedAttoEth,
                estimatedVaultRepBackingAttoRep: settlementSelectionEstimate.estimatedVaultRepBackingAttoRep,
                selectedClaimCount: selectedClaimSettlementBidRows.length,
                selectedRefundCount: selectedRefundSettlementBidRows.length,
                selectedRowCount: selectedSettlementBidRows.length,
            }),
            title: settlementActionLabel,
            onClick: onSettleSelectedBidsForSelectedAuction,
            tone: 'primary',
        });
    })();
    const importedForkSettlementSection = (() => {
        if (!hasImportedForkSettlementDeposits)
            return undefined;
        return (_jsx(ImportedForkSettlementSection, { activeReportingDetails: activeReportingDetails, disabled: forkAuctionActiveAction === 'settleForkedEscalation', onDepositSelectionChange: (outcome, depositIndex, checked) => {
                setSelectedImportedForkDepositIndexesByOutcome(currentSelections => ({
                    ...currentSelections,
                    [outcome]: checked ? [...currentSelections[outcome], depositIndex] : currentSelections[outcome].filter(index => index !== depositIndex),
                }));
            }, renderSettlementAction: ({ guardMessage, outcome, sideLabel }) => renderStageActionButton({
                action: 'settleForkedEscalation',
                availability: createActionAvailability(guardMessage),
                idleLabel: forkAuctionCopy.formatSettleSelectedValueForkCarriedDeposits(sideLabel),
                onClick: () => onWithdrawForkedEscalationSubmit(outcome),
                pendingLabel: forkAuctionCopy.settlingForkCarriedDepositsTruncated,
                tone: 'secondary',
            }), resolved: importedForkSettlementResolved, selectedDepositIndexesByOutcome: selectedImportedForkDepositIndexesByOutcome, sides: importedForkSettlementSides, winningOutcome: activeReportingDetails?.questionOutcome === 'none' ? undefined : activeReportingDetails?.questionOutcome }));
    })();
    const handleForkWorkflowStageKeyDown = (stage, event) => {
        const currentStageIndex = FORK_WORKFLOW_NAV_STAGES.indexOf(stage);
        if (currentStageIndex === -1)
            return;
        const nextStage = (() => {
            if (event.key === 'ArrowRight')
                return FORK_WORKFLOW_NAV_STAGES[Math.min(currentStageIndex + 1, FORK_WORKFLOW_NAV_STAGES.length - 1)];
            if (event.key === 'ArrowLeft')
                return FORK_WORKFLOW_NAV_STAGES[Math.max(currentStageIndex - 1, 0)];
            if (event.key === 'Home')
                return FORK_WORKFLOW_NAV_STAGES[0];
            if (event.key === 'End')
                return FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1];
            return undefined;
        })();
        if (nextStage === undefined)
            return;
        event.preventDefault();
        onSelectedStageViewChange?.(nextStage);
        const nextTab = document.getElementById(`fork-workflow-stage-${nextStage}`);
        if (nextTab instanceof HTMLElement)
            nextTab.focus();
    };
    const forkWorkflowStageNavigator = !hasLoadedPoolContext ? undefined : (_jsx("div", { className: 'fork-workflow-stage-nav-shell', children: _jsx("div", { "aria-label": forkAuctionCopy.forkLifecycleStages, className: 'fork-workflow-stage-nav', role: 'tablist', children: FORK_WORKFLOW_NAV_STAGES.map(stage => {
                const stageLabel = getForkWorkflowStageLabel(stage);
                return (_jsxs(Fragment, { children: [_jsxs("button", { "aria-controls": `fork-workflow-stage-panel-${stage}`, "aria-current": currentWorkflowStage === stage ? 'step' : undefined, "aria-label": stageLabel, "aria-selected": selectedStage === stage, className: getForkWorkflowStageClassName({
                                currentStage: currentWorkflowStage,
                                selectedStage,
                                stage,
                            }), id: `fork-workflow-stage-${stage}`, onClick: () => onSelectedStageViewChange?.(stage), onKeyDown: event => handleForkWorkflowStageKeyDown(stage, event), role: 'tab', tabIndex: selectedStage === stage ? 0 : -1, type: 'button', children: [getForkWorkflowStageIcon(stage), _jsxs("span", { className: 'fork-workflow-stage-copy', children: [_jsx("strong", { children: stageLabel }), selectedStage === stage ? _jsx("span", { className: 'fork-workflow-stage-indicator', children: forkAuctionCopy.viewing }) : undefined] })] }), stage === FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1] ? undefined : (_jsx("span", { "aria-hidden": 'true', className: getForkWorkflowSeparatorClassName({
                                currentStage: currentWorkflowStage,
                                stage,
                            }), children: "\u2192" }))] }, stage));
            }) }) }));
    const stagePanel = (() => {
        if (selectedStage === 'fork-triggered')
            return (_jsx("fieldset", { "aria-labelledby": 'fork-workflow-stage-fork-triggered', className: 'fork-stage-panel', disabled: disabled, id: 'fork-workflow-stage-panel-fork-triggered', role: 'tabpanel', children: _jsx(SectionBlock, { title: hasTriggeredFork ? commonCopy.forkTriggered : forkAuctionCopy.forkNotTriggered, variant: 'embedded', children: hasTriggeredFork
                        ? renderWorkflowMetricGrid([
                            {
                                label: commonCopy.status,
                                value: forkAuctionCopy.systemIsForking,
                            },
                            {
                                label: forkAuctionCopy.triggeredAt,
                                value: _jsx(TimestampValue, { ...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp }), timestamp: universeForkTime }),
                            },
                        ])
                        : undefined }) }));
        if (selectedStage === 'migration')
            return (_jsxs("fieldset", { "aria-labelledby": 'fork-workflow-stage-migration', className: 'fork-stage-panel', disabled: disabled, id: 'fork-workflow-stage-panel-migration', role: 'tabpanel', children: [selectedStageAheadMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: selectedStageAheadMessage }), migrationSummaryCard, _jsxs(SectionBlock, { title: forkAuctionCopy.yourMigrationBalances, variant: 'embedded', description: forkAuctionCopy.parentWalletBalancesDescription, children: [migrationBalancesContent, accountState.address === undefined ? undefined : (_jsxs(_Fragment, { children: [hasUnresolvedMigrationState ? (_jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: forkAuctionCopy.clearUnresolvedParentEscalationDepositAccounting, variant: 'embedded', children: [_jsx("p", { className: 'detail', children: _jsx(LoadingAwareText, { children: (() => {
                                                        if (isMigrationExpired)
                                                            return forkAuctionCopy.unresolvedMigrationExpiredDetail;
                                                        if (loadingReportingDetails)
                                                            return forkAuctionCopy.walletUnresolvedDepositsLoading;
                                                        if (activeReportingDetails === undefined)
                                                            return forkAuctionCopy.unresolvedDepositDetailsUnavailable;
                                                        if (hasStoredEscalationMigrationEntitlement)
                                                            return forkAuctionCopy.capturedEntitlementDetail;
                                                        if (!hasUnresolvedMigrationDeposits)
                                                            return forkAuctionCopy.walletUnresolvedDepositsEmpty;
                                                        return forkAuctionCopy.unresolvedEscalationMigrationWithVaultDetail;
                                                    })() }) }), activeReportingDetails === undefined || hasStoredEscalationMigrationEntitlement
                                                ? undefined
                                                : unresolvedMigrationSides.map(side => (_jsxs("div", { className: 'field', children: [_jsx("span", { children: side.label }), side.userDeposits.length === 0 ? (_jsx("p", { className: 'detail', children: forkAuctionCopy.formatNoUnresolvedDeposits(side.label.toLowerCase()) })) : (_jsx(EscalationDepositSelectionList, { disabled: true, items: side.userDeposits.map(deposit => ({
                                                                deposit,
                                                                details: [
                                                                    _jsxs(_Fragment, { children: [forkAuctionCopy.initiallyDepositedLead, _jsx(CurrencyValue, { value: deposit.amountAttoRep, suffix: commonCopy.rep })] }),
                                                                ],
                                                                secondaryDetails: [
                                                                    _jsxs(_Fragment, { children: [forkAuctionCopy.entryDepthLead, _jsx(CurrencyValue, { value: deposit.cumulativeAmountAttoRep, suffix: commonCopy.rep })] }),
                                                                ],
                                                            })), onSelectionChange: () => undefined, selectedDepositIndexes: side.userDeposits.map(deposit => deposit.depositIndex) }))] }, side.key))), isMigrationExpired ? undefined : (_jsx("div", { className: 'actions', children: renderStageActionButton({
                                                    action: 'migrateUnresolvedEscalation',
                                                    availability: createActionAvailability(migrateUnresolvedEscalationGuardMessage),
                                                    idleLabel: forkAuctionCopy.formatMigrateUnresolvedEscalationToValue(selectedOutcomeLabel),
                                                    onClick: onMigrateUnresolvedEscalationSubmit,
                                                    pendingLabel: forkAuctionCopy.migratingUnresolvedEscalationTruncated,
                                                    tone: 'primary',
                                                }) }))] })) : (_jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: forkAuctionCopy.claimResolvedParentEscalationDeposits, variant: 'embedded', children: [_jsx("p", { className: 'detail', children: forkAuctionCopy.resolvedParentDepositClaimDetail }), connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? _jsx("p", { className: 'detail', children: forkAuctionCopy.parentEscalationClaimEmptyDisputeStakedRepDetail }) : undefined, loadingReportingDetails ? (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: forkAuctionCopy.walletEscalationDepositsLoading }) })) : undefined, loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : _jsx("p", { className: 'detail', children: forkAuctionCopy.escalationDepositDetailsUnavailable }), showSelectedParentEscalationClaimDeposits && !hasSelectedParentEscalationClaimDeposits ? _jsx("p", { className: 'detail', children: forkAuctionCopy.formatNoClaimableParentEscalationDeposits(selectedOutcomeLabel) }) : undefined, showSelectedParentEscalationClaimDeposits && hasSelectedParentEscalationClaimDeposits ? (_jsxs("div", { className: 'field', children: [_jsx("span", { children: forkAuctionCopy.chooseParentDepositsToClaim }), _jsx(EscalationDepositSelectionList, { disabled: forkAuctionActiveAction === 'claimParentEscalationDeposits', items: selectedParentEscalationClaimDeposits.map(deposit => {
                                                            const claimAmount = getEscalationDepositClaimAmount(reportingDetails, forkAuctionForm.selectedOutcome, deposit);
                                                            return {
                                                                deposit,
                                                                details: [
                                                                    _jsxs(_Fragment, { children: [forkAuctionCopy.initiallyDepositedLead, _jsx(CurrencyValue, { value: deposit.amountAttoRep, suffix: commonCopy.rep })] }),
                                                                    claimAmount === undefined ? (forkAuctionCopy.worthNowPendingClaimFinalization) : (_jsxs(_Fragment, { children: [forkAuctionCopy.worthNowLead, _jsx(CurrencyValue, { value: claimAmount, suffix: commonCopy.rep })] })),
                                                                ],
                                                                secondaryDetails: [
                                                                    _jsxs(_Fragment, { children: [forkAuctionCopy.entryDepthLead, _jsx(CurrencyValue, { value: deposit.cumulativeAmountAttoRep, suffix: commonCopy.rep })] }),
                                                                ],
                                                            };
                                                        }), onSelectionChange: setSelectedParentEscalationClaimDepositIndexes, selectedDepositIndexes: selectedParentEscalationClaimDepositIndexes })] })) : undefined, _jsx("div", { className: 'actions', children: renderStageActionButton({
                                                    action: 'claimParentEscalationDeposits',
                                                    availability: createActionAvailability(claimSelectedParentEscalationDepositsGuardMessage),
                                                    idleLabel: forkAuctionCopy.formatClaimSelectedValueParentDeposits(selectedOutcomeLabel),
                                                    onClick: onClaimSelectedParentEscalationDeposits,
                                                    pendingLabel: forkAuctionCopy.claimingParentEscalationDepositsTruncated,
                                                }) })] })), _jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: forkAuctionCopy.migratePoolToUniverse, variant: 'embedded', children: [_jsx("p", { className: 'detail', children: forkAuctionCopy.poolRepMigrationDetail }), loadingSelectedOutcomeMigrationSeedStatus ? (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: forkAuctionCopy.selectedChildPoolRepReadinessLoading }) })) : undefined, selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : (_jsxs(_Fragment, { children: [_jsx(ErrorNotice, { message: selectedOutcomeMigrationSeedStatusError }), _jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', onClick: retrySelectedOutcomeMigrationSeedStatus, type: 'button', children: forkAuctionCopy.retryPoolRepReadiness }) })] })), loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (_jsx("p", { className: 'detail', children: selectedOutcomeMigrationSeedStatus.childPoolRepBalanceAttoRep > 0n ? forkAuctionCopy.poolRepAlreadyMigratedDetail : forkAuctionCopy.poolRepStagedForVaultMigrationDetail })), _jsx("div", { className: 'actions', children: renderStageActionButton({
                                                    action: 'migrateRepToZoltar',
                                                    availability: createActionAvailability(migratePoolToUniverseGuardMessage),
                                                    idleLabel: forkAuctionCopy.formatMigratePoolToValueUniverse(selectedOutcomeLabel),
                                                    onClick: onMigrateSelectedOutcomeRepToZoltar,
                                                    pendingLabel: forkAuctionCopy.migratingPoolToUniverseTruncated,
                                                }) })] }), _jsxs(SectionBlock, { density: 'compact', headingLevel: 4, title: forkAuctionCopy.migrateVaultTitle, variant: 'embedded', children: [_jsx("p", { className: 'detail', children: forkAuctionCopy.vaultMigrationDetail }), connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? _jsx("p", { className: 'detail', children: forkAuctionCopy.poolMigrationCapacityEmpty }) : undefined, loadingSelectedOutcomeMigrationSeedStatus ? (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: forkAuctionCopy.selectedChildPoolRepReadinessLoading }) })) : undefined, _jsx("div", { className: 'actions', children: renderStageActionButton({
                                                    action: 'migrateVault',
                                                    availability: createActionAvailability(migrateVaultGuardMessage),
                                                    idleLabel: forkAuctionCopy.formatMigrateVaultToValue(selectedOutcomeLabel),
                                                    onClick: onMigrateVaultSubmit,
                                                    pendingLabel: forkAuctionCopy.migratingVault,
                                                    tone: 'primary',
                                                }) }), isVaultMigrationComplete ? _jsx("p", { className: 'detail', children: forkAuctionCopy.alreadyMigratedStatus }) : undefined] })] }))] })] }));
        return (() => {
            if (selectedStage === 'auction') {
                if (shouldShowTruthAuctionVisualization)
                    return (_jsxs("fieldset", { "aria-labelledby": 'fork-workflow-stage-auction', className: 'fork-stage-panel', disabled: disabled, id: 'fork-workflow-stage-panel-auction', role: 'tabpanel', children: [selectedStageAheadMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: selectedStageAheadMessage }), auctionOutcomeSelector, renderSelectedOutcomeChildPoolNotice(), truthAuctionEndedNotice, truthAuctionHero, _jsx(ReadOnlyDetailAccordion, { title: forkAuctionCopy.marketDepth, children: truthAuctionMarketViewSection }), renderSubmitBidSection(), viewerTruthAuctionBidsSection, auctionWideBidsSection] }));
                return (_jsxs("fieldset", { "aria-labelledby": 'fork-workflow-stage-auction', className: 'fork-stage-panel', disabled: disabled, id: 'fork-workflow-stage-panel-auction', role: 'tabpanel', children: [selectedStageAheadMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: selectedStageAheadMessage }), auctionOutcomeSelector, renderSelectedOutcomeChildPoolNotice(), truthAuctionEndedNotice, _jsx(SectionBlock, { badge: truthAuctionStateBadgeElement, title: forkAuctionCopy.truthAuctionStatus, variant: 'embedded', children: renderWorkflowMetricGrid(auctionStatusMetrics) }), hasStartedTruthAuction ? undefined : (_jsxs(SectionBlock, { title: forkAuctionCopy.startTruthAuctionTitle, variant: 'embedded', children: [_jsx("p", { className: 'detail', children: forkAuctionCopy.formatStartTruthAuctionDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL) }), startTruthAuctionReadyInText === undefined ? undefined : _jsx("p", { className: 'detail', children: startTruthAuctionReadyInText }), truthAuctionBypassReason === undefined ? undefined : _jsx("p", { className: 'detail', children: truthAuctionBypassReason }), _jsx("div", { className: 'actions', children: renderStageActionButton({
                                        action: 'startTruthAuction',
                                        availability: createActionAvailability(!hasSelectedAuctionChildPool ? forkAuctionCopy.formatMissingChildUniverseDetail(selectedAuctionLabel) : startTruthAuctionAvailabilityMessage),
                                        forceEnabled: hasSelectedAuctionChildPool,
                                        idleLabel: truthAuctionBypassReason === undefined ? forkAuctionCopy.startTruthAuction : forkAuctionCopy.bypassTruthAuction,
                                        onClick: onStartTruthAuctionSubmit,
                                        pendingLabel: truthAuctionBypassReason === undefined ? forkAuctionCopy.startingTruthAuction : forkAuctionCopy.bypassingAuctionTruncated,
                                        tone: 'primary',
                                    }) })] })), renderSubmitBidSection(), auctionWideBidsStatusSection] }));
            }
            if (selectedStage === 'settlement') {
                if (shouldShowTruthAuctionVisualization)
                    return (_jsxs("fieldset", { "aria-labelledby": 'fork-workflow-stage-settlement', className: 'fork-stage-panel', disabled: disabled, id: 'fork-workflow-stage-panel-settlement', role: 'tabpanel', children: [selectedStageAheadMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: selectedStageAheadMessage }), truthAuctionEndedNotice, truthAuctionHero, viewerTruthAuctionBidsSection, truthAuctionSettlementSection, importedForkSettlementSection, renderChildSecurityPoolsSection({
                                auctionOutcomeSelector,
                                childSecurityPools,
                                renderSelectedOutcomeChildPoolNotice,
                            })] }));
                return (_jsxs("fieldset", { "aria-labelledby": 'fork-workflow-stage-settlement', className: 'fork-stage-panel', disabled: disabled, id: 'fork-workflow-stage-panel-settlement', role: 'tabpanel', children: [selectedStageAheadMessage === undefined ? undefined : _jsx("p", { className: 'detail', children: selectedStageAheadMessage }), truthAuctionEndedNotice, _jsx(SectionBlock, { badge: truthAuctionStateBadgeElement, title: forkAuctionCopy.settlementStatus, variant: 'embedded', children: renderWorkflowMetricGrid(settlementStatusMetrics) }), auctionWideBidsStatusSection, truthAuctionSettlementSection, importedForkSettlementSection, renderChildSecurityPoolsSection({
                            auctionOutcomeSelector,
                            childSecurityPools,
                            renderSelectedOutcomeChildPoolNotice,
                        })] }));
            }
            return undefined;
        })();
    })();
    const content = (_jsxs(_Fragment, { children: [!showSecurityPoolAddressInput && hasLoadedPoolContext ? undefined : (_jsxs("div", { className: 'form-grid', children: [!showSecurityPoolAddressInput ? undefined : _jsx(LookupFieldRow, { label: commonCopy.securityPoolAddress, value: forkAuctionForm.securityPoolAddress, onInput: securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress }), placeholder: commonCopy.hexValuePlaceholder }), hasLoadedPoolContext ? undefined : _jsx("p", { className: 'detail', children: forkAuctionCopy.forkWorkflowDescription })] })), forkWorkflowStageNavigator, hasLoadedPoolContext ? stagePanel : undefined, _jsx(ErrorNotice, { message: forkAuctionError }), forkAuctionError === undefined || forkAuctionDetails !== undefined || securityPoolAddress === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', disabled: loadingForkAuctionDetails, onClick: () => onLoadForkAuction(securityPoolAddress), type: 'button', children: forkAuctionCopy.retryForkWorkflow }) })), _jsx(ErrorNotice, { message: reportingError }), reportingError === undefined || onLoadReporting === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', disabled: loadingReportingDetails, onClick: onLoadReporting, type: 'button', children: loadingReportingDetails ? _jsx(LoadingText, { children: forkAuctionCopy.loadingReportingDetails }) : forkAuctionCopy.retryReporting }) }))] }));
    if (embedInCard)
        return content;
    return (_jsx(RouteWorkflowPanel, { showHeader: showHeader, title: forkAuctionCopy.forkTruthAuction, children: content }));
}
//# sourceMappingURL=ForkAuctionSection.js.map