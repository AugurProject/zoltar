import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { ForkAuctionSection } from '../../truth-auctions/components/ForkAuctionSection.js';
import { LiquidationModal } from './LiquidationModal.js';
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { OpenOraclePriceValue } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOraclePriceValue.js';
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js';
import { ReportingSection } from '@zoltar/ui-zoltar/features/reporting/components/ReportingSection.js';
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js';
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js';
import { SecurityPoolLink } from './SecurityPoolLink.js';
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { getQueuedVaultOperation, SecurityVaultSection, SelectedVaultSummarySection } from './SecurityVaultSection.js';
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TradingSection } from '../../markets/components/TradingSection.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js';
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js';
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js';
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js';
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js';
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js';
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { applySelectedPoolWorkflowState, getCurrentSelectedPoolReportingDetails, getCurrentSelectedPoolForkAuctionDetails, getCurrentForkWorkflowSelectionStage, getCurrentPoolOracleManagerDetails, getCurrentSelectedPoolForkStage, hasCurrentSelectedPoolForkActivity, getSelectedPoolCardTitle, getSelectedPoolOracleMetricValues, getSelectedPoolViewForForkWorkflowSelectionStage, getSelectedPoolViewLabel, getSelectedPoolWorkflowGuardMessage, getSelectedPoolWorkflowLockedPresentation, isSelectedPoolForkWorkflowView, isForkWorkflowDisabled, resolveForkWorkflowSelectionStage, resolveSelectedPoolView, SELECTED_POOL_PRIMARY_VIEWS, SELECTED_POOL_SECONDARY_VIEWS, SELECTED_POOL_VIEWS, shouldReloadSelectedPoolDetails, shouldShowSelectedPoolWorkflowDetails, } from '../lib/securityPoolWorkflow.js';
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js';
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js';
import { resolveRequestedLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js';
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { getReportingLockedUntilMessage, hasReportingOpened } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js';
import { addOpenOracleBountyBuffer } from '@zoltar/ui-zoltar/features/open-oracle/lib/openOracle.js';
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js';
import { deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, evaluateSecurityPoolState } from '../lib/securityPoolState.js';
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from '../lib/securityVaultGuards.js';
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSelectedVaultOwner, isOracleManagerPriceUsable, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js';
import { getPoolRegistryPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
import { formatUniverseIdHex } from '@zoltar/ui-zoltar/features/universes/lib/universe.js';
import { useForkWorkflowSelectionState } from '../../truth-auctions/hooks/useForkWorkflowSelectionState.js';
import { useSelectedVaultWorkflowState } from '../hooks/useSelectedVaultWorkflowState.js';
function buildSelectedPoolSummaryPool({ forkAuctionDetails, selectedPool }) {
    if (selectedPool === undefined)
        return undefined;
    if (forkAuctionDetails === undefined)
        return selectedPool;
    return {
        ...selectedPool,
        settlementCollateralAttoEth: forkAuctionDetails.settlementCollateralAttoEth,
        hasForkActivity: forkAuctionDetails.hasForkActivity,
        forkOutcome: forkAuctionDetails.forkOutcome,
        forkOwnSecurityPool: forkAuctionDetails.forkOwnSecurityPool,
        marketDetails: forkAuctionDetails.marketDetails,
        migratedAttoRep: forkAuctionDetails.migratedAttoRep,
        questionOutcome: forkAuctionDetails.questionOutcome,
        securityPoolAddress: forkAuctionDetails.securityPoolAddress,
        systemState: forkAuctionDetails.systemState,
        truthAuctionAddress: forkAuctionDetails.truthAuctionAddress,
        truthAuctionStartedAt: forkAuctionDetails.truthAuctionStartedAt,
        universeId: forkAuctionDetails.universeId,
    };
}
function getPendingOperationLabel(operation) {
    switch (operation) {
        case 'liquidation':
            return securityPoolCopy.liquidation;
        case 'withdrawRep':
            return securityPoolCopy.withdrawRep;
        default:
            return assertNever(operation);
    }
}
function getPendingOperationAmountPresentation(operation) {
    switch (operation) {
        case 'liquidation':
            return { label: securityPoolCopy.requestedLiquidationDebt, suffix: commonCopy.eth };
        case 'withdrawRep':
            return { label: securityPoolCopy.repWithdrawal, suffix: commonCopy.rep };
        default:
            return assertNever(operation);
    }
}
function getStagedOperationExecutionModeLabel(operationId, pendingSettlementOperationIds) {
    return pendingSettlementOperationIds.includes(operationId) ? securityPoolCopy.autoExecPending : securityPoolCopy.manualExecution;
}
function getSecurityPoolStatusBadgeTone(systemState) {
    if (systemState === 'operational')
        return 'ok';
    if (systemState === undefined)
        return 'muted';
    return 'warning';
}
export function SecurityPoolWorkflowSection({ accountState, activeUniverseId, checkedSecurityPoolAddress, closeLiquidationModal, forkAuction, liquidationDebtEthAmount, maximumLiquidationDebtAttoEth, liquidationManagerAddress, liquidationFundingPreview, liquidationFundingPreviewError, liquidationModalOpen, liquidationSecurityPoolAddress, liquidationTargetVault, liquidationReceiverVault, liquidationApprovalId, liquidationApprovalDetails, liquidationApprovalError, liquidationReceiverVaultSummary, liquidationReceiverVaultSummaryError, liquidationReceiverVaultSummaryResolved, liquidationTimeoutMinutes, loadingPoolOracleManager, loadingLiquidationFundingPreview, loadingLiquidationApproval, loadingLiquidationReceiverVaultSummary, loadingSecurityPools, onLiquidationAmountChange, onLiquidationReceiverVaultChange, onLiquidationApprovalIdChange, onLoadLiquidationApproval, onLoadLiquidationReceiverVaultSummary, onLiquidationTimeoutMinutesChange, onLoadPoolOracleManager, onBrowsePools, onCreatePool, onLoadLiquidationFundingPreview, onOpenLiquidationModal, onReturnToCurrentUniverse, onSwitchToPoolUniverse, onQueueLiquidation, onExecutePendingPoolOperation, onRefreshSelectedPoolData, onRequestPoolPrice, onViewPendingReport, poolOracleActiveAction, poolOracleManagerDetails, poolOracleManagerError, poolOracleManagerErrorAddress, poolPriceOracleResult, universeForkTime, selectedPoolRefreshNonce, onSecurityPoolAddressChange, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, reporting, selectedPoolView, securityPoolOverviewActiveAction, securityPoolOverviewError, securityPoolLiquidationError, securityPoolOverviewResult, securityPoolAddress, securityPools, securityVault, initialVaultView, onSelectedPoolViewChange, showHeader = true, trading, }) {
    const view = resolveSelectedPoolView(selectedPoolView);
    const legacyForkWorkflowSelectionStage = resolveForkWorkflowSelectionStage(selectedPoolView);
    const chainCurrentTimestamp = useChainTimestamp();
    const [manualPendingOperationId, setManualPendingOperationId] = useState('');
    const [requestPriceReview, setRequestPriceReview] = useState(undefined);
    const lastHandledReportingRefreshNonceRef = useRef(selectedPoolRefreshNonce);
    const lastHandledForkAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce);
    const lastForkAuctionAutoLoadKey = useRef(undefined);
    const isOnActiveAppChain = isActiveAppChain(accountState.chainId);
    const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress));
    const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress);
    const normalizedReportingFormPoolAddress = normalizeAddress(reporting.reportingForm.securityPoolAddress);
    const loadedReportingDetails = sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? reporting.reportingDetails : undefined;
    const currentReportingDetails = getCurrentSelectedPoolReportingDetails({
        reportingDetails: loadedReportingDetails,
        selectedPool,
    });
    const loadedForkAuctionDetails = sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? forkAuction.forkAuctionDetails : undefined;
    const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
        forkAuctionDetails: loadedForkAuctionDetails,
        selectedPool,
    });
    const selectedPoolLookupState = resolveRequestedLoadableValueState({
        currentKey: normalizeAddress(securityPoolAddress),
        isLoading: loadingSecurityPools,
        resolvedKey: checkedSecurityPoolAddress,
        value: selectedPool,
    });
    const marketDetails = selectedPool?.marketDetails ?? currentReportingDetails?.marketDetails ?? currentForkAuctionDetails?.marketDetails;
    const selectedPoolState = currentForkAuctionDetails?.systemState ?? selectedPool?.systemState;
    const selectedPoolQuestionOutcome = currentForkAuctionDetails?.questionOutcome ?? currentReportingDetails?.questionOutcome ?? selectedPool?.questionOutcome;
    const effectiveSelectedPool = applySelectedPoolWorkflowState(selectedPool, {
        questionOutcome: selectedPoolQuestionOutcome,
        systemState: selectedPoolState,
    });
    const currentTimestamp = chainCurrentTimestamp ?? currentReportingDetails?.currentTime ?? currentForkAuctionDetails?.currentTime;
    const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, currentTimestamp);
    const selectedPoolReportingStage = deriveSecurityPoolReportingStage({
        reportingDetails: currentReportingDetails,
        reportingReady,
    });
    const selectedPoolHasActualForkActivity = currentForkAuctionDetails?.hasForkActivity ?? selectedPool?.hasForkActivity ?? false;
    const selectedPoolLifecycleState = selectedPoolReportingStage === 'forkTriggered' && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'
        ? 'poolForked'
        : deriveSecurityPoolLifecycleState({
            hasForkActivity: selectedPoolHasActualForkActivity,
            isChildPool: effectiveSelectedPool !== undefined && effectiveSelectedPool.parent !== zeroAddress,
            questionOutcome: selectedPoolQuestionOutcome,
            systemState: selectedPoolState,
            universeHasForked: effectiveSelectedPool?.universeHasForked,
        });
    const selectedPoolStateModel = evaluateSecurityPoolState({
        lifecycleState: selectedPoolLifecycleState,
        reportingStage: selectedPoolReportingStage,
        universeHasForked: effectiveSelectedPool?.universeHasForked === true,
    });
    const triggerZoltarForkReason = (() => {
        if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolHasActualForkActivity) {
            return securityPoolCopy.forkAlreadyTriggeredSettlementReason;
        }
        if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolState !== 'operational') {
            return securityPoolCopy.poolForkMigrationStatus;
        }
        return securityPoolCopy.forkTriggerUnavailableReason;
    })();
    const triggerZoltarForkAvailability = {
        disabled: !(selectedPoolReportingStage === 'forkTriggered' && !selectedPoolHasActualForkActivity && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'),
        reason: triggerZoltarForkReason,
    };
    const selectedPoolHasForkActivity = (() => {
        if (selectedPoolReportingStage === 'forkTriggered')
            return true;
        return selectedPoolHasActualForkActivity;
    })();
    const selectedPoolForkWorkflowSystemState = selectedPoolLifecycleState === undefined || selectedPoolLifecycleState === 'ended' ? selectedPoolState : selectedPoolLifecycleState;
    const reportingLockedReason = (() => {
        if (selectedPoolState === 'poolForked')
            return securityPoolCopy.parentForkMigrationRedirectDetail;
        if (selectedPoolState === 'forkMigration')
            return securityPoolCopy.reportingLockedDuringMigrationReason;
        if (selectedPoolState === 'forkTruthAuction')
            return securityPoolCopy.reportingLockedDuringAuctionReason;
        if (reportingReady)
            return undefined;
        if (marketDetails === undefined)
            return securityPoolCopy.reportingStartDetail;
        return getReportingLockedUntilMessage(marketDetails.endTime, currentTimestamp);
    })();
    const forkWorkflowDisabled = isForkWorkflowDisabled(selectedPoolState, selectedPoolHasForkActivity);
    const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId;
    const hasSelectedPoolAddress = securityPoolAddress.trim() !== '';
    const showSelectedPoolWorkflowDetails = shouldShowSelectedPoolWorkflowDetails({
        hasSelectedPoolAddress,
        selectedPoolExists: selectedPool !== undefined,
        selectedPoolUniverseMismatch,
    });
    const currentForkStage = getCurrentSelectedPoolForkStage({
        forkAuctionDetails: currentForkAuctionDetails,
        selectedPool: selectedPool === undefined || selectedPoolForkWorkflowSystemState === undefined
            ? selectedPool
            : {
                ...selectedPool,
                systemState: selectedPoolForkWorkflowSystemState,
            },
    });
    const currentForkWorkflowSelectionStage = getCurrentForkWorkflowSelectionStage({
        claimingAvailable: currentForkAuctionDetails?.claimingAvailable ?? false,
        currentForkStage,
        hasForkActivity: hasCurrentSelectedPoolForkActivity({
            forkAuctionDetails: currentForkAuctionDetails,
            selectedPool,
        }),
        systemState: currentForkAuctionDetails?.systemState ?? selectedPoolForkWorkflowSystemState,
        truthAuctionFinalized: currentForkAuctionDetails?.truthAuction?.finalized ?? false,
    });
    const { forkWorkflowSelectionStage, onForkWorkflowSelectionStageChange } = useForkWorkflowSelectionState({
        currentForkWorkflowSelectionStage,
        legacyForkWorkflowSelectionStage,
        onSelectedStageViewChange: stage => onSelectedPoolViewChange(getSelectedPoolViewForForkWorkflowSelectionStage(stage)),
        selectedPoolAddress: selectedPool?.securityPoolAddress,
        view,
    });
    const openSelectedPoolForkWorkflow = selectedPoolHasActualForkActivity ? () => onSelectedPoolViewChange('fork-workflow') : undefined;
    const shouldRefreshSelectedPoolReporting = showSelectedPoolWorkflowDetails && (sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) || (view === 'reporting' && normalizedSelectedPoolAddress !== undefined && normalizedReportingFormPoolAddress === normalizedSelectedPoolAddress));
    const selectedPoolWorkflowGuardMessage = getSelectedPoolWorkflowGuardMessage({
        hasSelectedPoolAddress,
        selectedPoolLookupState,
        selectedPoolUniverseMismatch,
    });
    const selectedPoolWorkflowLockedPresentation = showSelectedPoolWorkflowDetails
        ? undefined
        : getSelectedPoolWorkflowLockedPresentation({
            hasSelectedPoolAddress,
            selectedPoolLookupState,
            selectedPoolUniverseMismatch,
        });
    const selectedVaultViewOptions = [
        { label: securityPoolCopy.directory, value: 'browse-vaults' },
        { label: commonCopy.selected, value: 'selected-vault' },
    ];
    const selectedPoolManagerAddress = selectedPool?.managerAddress;
    const currentPoolOracleManagerError = selectedPoolManagerAddress !== undefined && sameAddress(poolOracleManagerErrorAddress, selectedPoolManagerAddress) ? poolOracleManagerError : undefined;
    const liquidationPoolOracleManagerError = liquidationManagerAddress !== undefined && sameAddress(poolOracleManagerErrorAddress, liquidationManagerAddress) ? poolOracleManagerError : undefined;
    const currentPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({
        poolOracleManagerDetails,
        selectedPoolManagerAddress,
    });
    const selectedVaultOwnerInput = securityVault.securityVaultForm.selectedVaultOwner ?? '';
    const selectedVaultOwner = getSelectedVaultOwner(selectedVaultOwnerInput, accountState.address) ?? '';
    const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultOwnerInput, accountState.address);
    const selectedVaultSecurityPoolAddress = securityVault.securityVaultForm.securityPoolAddress.trim();
    const selectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
        accountAddress: accountState.address,
        securityPoolAddress: selectedPool?.securityPoolAddress,
        securityVaultDetails: securityVault.securityVaultDetails,
        selectedVaultOwner: selectedVaultOwnerInput,
    })
        ? securityVault.securityVaultDetails
        : undefined;
    const selectedVaultExistsOnchain = doesSecurityVaultExistOnchain(selectedVaultDetails);
    const currentSecurityVaultResult = selectedVaultDetails === undefined ? undefined : securityVault.securityVaultResult;
    const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultOwner) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress);
    const { setVaultView, vaultView } = useSelectedVaultWorkflowState({
        accountAddress: accountState.address,
        hasLoadedCurrentVault,
        initialVaultView,
        loadingSecurityVault: securityVault.loadingSecurityVault,
        onLoadSecurityVault: securityVault.onLoadSecurityVault,
        onSecurityVaultFormChange: securityVault.onSecurityVaultFormChange,
        selectedPoolAddress: selectedPool?.securityPoolAddress,
        selectedVaultOwner,
        selectedVaultOwnerInput: securityVault.securityVaultForm.selectedVaultOwner,
        selectedVaultSecurityPoolAddress,
        showSelectedPoolWorkflowDetails,
        view,
    });
    const lastReportingAutoLoadKey = useRef(undefined);
    const lastReportingOutcomeRefreshHash = useRef(undefined);
    const lastVaultStatusRefreshHash = useRef(undefined);
    const lastQueuedOperationRefreshHash = useRef(undefined);
    const lastImmediateQueuedOperationRefreshHash = useRef(undefined);
    const lastLiquidationOutcomeRefreshKey = useRef(undefined);
    const lastExecutedOperationRefreshHash = useRef(undefined);
    const lastForkAuctionOutcomeRefreshHash = useRef(undefined);
    const queuedVaultOperation = getQueuedVaultOperation({
        pendingOperation: currentPoolOracleManagerDetails?.pendingOperation,
        selectedVaultOwner,
        securityVaultResult: currentSecurityVaultResult,
    });
    const liquidationNoticeState = getLiquidationNoticeState({
        currentTimestamp,
        currentPoolOracleManagerDetails,
        liquidationTargetVault,
        loadingPoolOracleManager,
        securityPoolOverviewResult,
    });
    const loadedSelectedPool = effectiveSelectedPool;
    const selectedPoolSummaryPool = buildSelectedPoolSummaryPool({
        forkAuctionDetails: currentForkAuctionDetails,
        selectedPool: loadedSelectedPool,
    });
    const selectedPoolParentPool = selectedPoolSummaryPool === undefined || selectedPoolSummaryPool.parent === zeroAddress ? undefined : securityPools.find(pool => sameAddress(pool.securityPoolAddress, selectedPoolSummaryPool.parent));
    const selectedPoolOracleMetricValues = loadedSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(loadedSelectedPool);
    const currentPoolOraclePrice = (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice;
    const currentPoolOracleSettlementTimestamp = (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp;
    const currentPoolOraclePriceUsable = currentPoolOracleManagerDetails === undefined ? undefined : isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp);
    const requestPriceTransactionEthValue = currentPoolOracleManagerDetails === undefined ? undefined : addOpenOracleBountyBuffer(currentPoolOracleManagerDetails.requestPriceCostAttoEth);
    const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
        accountAddress: accountState.address,
        hasLoadedSelectedPool: loadedSelectedPool !== undefined,
        isOnActiveAppChain,
        isPriceValid: currentPoolOraclePriceUsable,
        pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
        requiredCostAttoEth: currentPoolOracleManagerDetails?.requestPriceCostAttoEth,
        walletBalanceAttoEth: accountState.ethBalanceAttoEth,
    });
    const requestPriceOpenGuardMessage = requestPriceTransactionEthValue === undefined ? securityPoolCopy.loadOracleBeforePriceReview : requestPriceGuardMessage;
    const requestPriceConfirmationGuardMessage = getVaultRequestPriceGuardMessage({
        accountAddress: accountState.address,
        bufferRequiredEthCost: false,
        hasLoadedSelectedPool: requestPriceReview !== undefined,
        isOnActiveAppChain,
        isPriceValid: currentPoolOraclePriceUsable,
        pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
        requiredCostAttoEth: requestPriceReview?.requestValueAttoEth,
        walletBalanceAttoEth: accountState.ethBalanceAttoEth,
    });
    const selectedPendingOperationId = currentPoolOracleManagerDetails?.pendingOperationSlotId ?? 0n;
    const reportingOracleGuardMessage = (() => {
        if (reportingLockedReason !== undefined)
            return undefined;
        if (!selectedPoolStateModel.actions.reportOutcome.enabled)
            return undefined;
        if ((loadedSelectedPool?.totalCapacityOwnershipAttoRep ?? 0n) === 0n)
            return undefined;
        if (currentPoolOracleManagerDetails === undefined || currentPoolOraclePriceUsable === true)
            return undefined;
        return currentPoolOracleManagerDetails.lastSettlementTimestamp > 0n ? securityPoolCopy.reportingOraclePriceExpiredReason : securityPoolCopy.reportingOraclePriceRequiredReason;
    })();
    const liquidationEnabled = selectedPoolStateModel.actions.queueLiquidation.enabled;
    const pendingOperationInput = (() => {
        if (manualPendingOperationId.trim() !== '')
            return manualPendingOperationId.trim();
        if (selectedPendingOperationId > 0n)
            return selectedPendingOperationId.toString();
        return '';
    })();
    const resolvedPendingOperationId = pendingOperationInput === '' ? undefined : tryParseBigIntInput(pendingOperationInput);
    const executePendingOperationGuardMessage = getVaultExecutePendingOperationGuardMessage({
        accountAddress: accountState.address,
        hasLoadedOracleManager: currentPoolOracleManagerDetails !== undefined,
        isOnActiveAppChain,
        isPriceValid: currentPoolOraclePriceUsable,
        resolvedPendingOperationId,
    });
    const pendingOperation = currentPoolOracleManagerDetails?.pendingOperation;
    const canUseOracleActions = accountState.address !== undefined && isOnActiveAppChain;
    const stagedOperations = currentPoolOracleManagerDetails?.stagedOperations ?? (pendingOperation === undefined ? [] : [pendingOperation]);
    const pendingSettlementOperationIds = currentPoolOracleManagerDetails?.pendingSettlementOperationIds ?? [];
    const activeStagedOperationCount = currentPoolOracleManagerDetails?.activeStagedOperationCount ?? BigInt(stagedOperations.length);
    const selectedPoolBrowsePresentation = selectedPool === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined;
    const selectedVaultLoadNotice = (() => {
        if (securityVault.loadingSecurityVault)
            return (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: securityPoolCopy.loadingVault }) }));
        if (securityVault.securityVaultMissing)
            return _jsx(StateHint, { presentation: { key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: securityPoolCopy.invalidVaultAddressHint } });
        return undefined;
    })();
    let selectedPoolSummaryContent;
    if (selectedPoolSummaryPool === undefined) {
        selectedPoolSummaryContent = undefined;
    }
    else if (view === 'vaults' || view === 'trading') {
        selectedPoolSummaryContent = (_jsx("div", { className: 'selected-pool-context-summary selected-pool-context-summary-hero selected-pool-context-summary-hero-compact', children: _jsxs("div", { className: 'selected-pool-context-overview', children: [_jsxs("div", { className: 'selected-pool-hero-story', children: [_jsx("div", { className: 'selected-pool-hero-story-title-row', children: _jsx("div", { className: 'security-pool-card-title-row', children: _jsx("span", { className: 'security-pool-card-title-copy', children: marketDetails === undefined ? '' : getQuestionTitle(marketDetails) }) }) }), marketDetails === undefined ? null : _jsx(Question, { className: 'selected-pool-hero-question', question: marketDetails, variant: 'preview', showTitle: false })] }), _jsxs(SecurityPoolSummaryMetrics, { className: 'selected-pool-context-grid', currentTimestamp: currentTimestamp, pool: {
                            ...selectedPoolSummaryPool,
                            lastOraclePrice: currentPoolOraclePrice ?? selectedPoolSummaryPool.lastOraclePrice,
                            lastOracleSettlementTimestamp: currentPoolOracleSettlementTimestamp ?? selectedPoolSummaryPool.lastOracleSettlementTimestamp,
                        }, showTotalBacking: true, variant: 'hero', children: [selectedPoolSummaryPool.parent === zeroAddress ? undefined : (_jsx(MetricField, { label: securityPoolCopy.parentPool, children: _jsx(SecurityPoolLink, { securityPoolAddress: selectedPoolSummaryPool.parent, selectedPoolView: selectedPoolView, universeId: selectedPoolParentPool?.universeId }) })), currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (_jsx(MetricField, { label: securityPoolCopy.pendingRequest, children: _jsx("button", { className: 'link', type: 'button', onClick: () => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId), children: securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString()) }) }))] })] }) }));
    }
    else {
        selectedPoolSummaryContent = (_jsxs("div", { className: 'selected-pool-context-summary', children: [_jsx("div", { className: 'selected-pool-context-overview', children: _jsxs(SecurityPoolSummaryMetrics, { metricVariant: 'context', pool: selectedPoolSummaryPool, showTotalBacking: true, children: [selectedPoolSummaryPool.parent === zeroAddress ? undefined : (_jsx(MetricField, { label: securityPoolCopy.parentPool, children: _jsx(SecurityPoolLink, { securityPoolAddress: selectedPoolSummaryPool.parent, selectedPoolView: selectedPoolView, universeId: selectedPoolParentPool?.universeId }) })), _jsx(MetricField, { label: commonCopy.openOraclePrice, valueTagName: 'span', children: _jsx(OpenOraclePriceValue, { currentTimestamp: currentTimestamp, lastPrice: currentPoolOraclePrice, lastSettlementTimestamp: currentPoolOracleSettlementTimestamp ?? 0n, priceValidUntilTimestamp: currentPoolOracleManagerDetails?.priceValidUntilTimestamp }) }), currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (_jsx(MetricField, { label: securityPoolCopy.pendingRequest, children: _jsx("button", { className: 'link', type: 'button', onClick: () => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId), children: securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString()) }) }))] }) }), marketDetails === undefined ? undefined : (_jsx(SectionBlock, { headingLevel: 3, title: commonCopy.question, variant: 'embedded', children: _jsx(Question, { question: marketDetails }) }))] }));
    }
    useEffect(() => {
        if (selectedPoolManagerAddress === undefined)
            return;
        if (sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress))
            return;
        if (loadingPoolOracleManager)
            return;
        if (currentPoolOracleManagerError !== undefined)
            return;
        void onLoadPoolOracleManager(selectedPoolManagerAddress);
    }, [currentPoolOracleManagerError, loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress]);
    useEffect(() => {
        if (selectedPoolManagerAddress === undefined)
            return;
        if (loadingPoolOracleManager)
            return;
        const queuedOperationHash = (() => {
            if (securityVault.securityVaultResult?.action === 'queueWithdrawRep')
                return securityVault.securityVaultResult.hash;
            if (securityPoolOverviewResult?.action === 'queueLiquidation')
                return securityPoolOverviewResult.hash;
            return undefined;
        })();
        if (queuedOperationHash === undefined) {
            lastQueuedOperationRefreshHash.current = undefined;
            return;
        }
        if (lastQueuedOperationRefreshHash.current === queuedOperationHash)
            return;
        lastQueuedOperationRefreshHash.current = queuedOperationHash;
        void onLoadPoolOracleManager(selectedPoolManagerAddress);
    }, [loadingPoolOracleManager, onLoadPoolOracleManager, securityPoolOverviewResult, securityVault.securityVaultResult, selectedPoolManagerAddress]);
    useEffect(() => {
        const shouldAutoloadReportingForFork = view === 'fork-workflow';
        const shouldAutoloadReportingForCurrentView = view === 'reporting' || shouldAutoloadReportingForFork;
        if (!shouldAutoloadReportingForCurrentView || !reportingReady || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
            lastReportingAutoLoadKey.current = undefined;
            return;
        }
        if (normalizedReportingFormPoolAddress === undefined || normalizedReportingFormPoolAddress !== normalizedSelectedPoolAddress)
            return;
        if (reporting.loadingReportingDetails)
            return;
        const shouldReloadReporting = shouldReloadSelectedPoolDetails({
            currentDetailsAvailable: currentReportingDetails !== undefined,
            lastHandledRefreshNonce: lastHandledReportingRefreshNonceRef.current,
            loadedDetailsAddress: loadedReportingDetails?.securityPoolAddress,
            refreshNonce: selectedPoolRefreshNonce,
            selectedPoolAddress: normalizedSelectedPoolAddress,
        });
        if (!shouldReloadReporting && sameAddress(loadedReportingDetails?.securityPoolAddress, normalizedSelectedPoolAddress) && currentReportingDetails !== undefined)
            return;
        const reportingAutoLoadKey = `${normalizedSelectedPoolAddress}:${normalizedReportingFormPoolAddress}:${selectedPoolRefreshNonce}`;
        if (lastReportingAutoLoadKey.current === reportingAutoLoadKey)
            return;
        lastReportingAutoLoadKey.current = reportingAutoLoadKey;
        lastHandledReportingRefreshNonceRef.current = selectedPoolRefreshNonce;
        void reporting.onLoadReporting();
    }, [
        normalizedReportingFormPoolAddress,
        normalizedSelectedPoolAddress,
        currentReportingDetails,
        loadedReportingDetails?.securityPoolAddress,
        reporting.loadingReportingDetails,
        reporting.onLoadReporting,
        reportingReady,
        selectedPoolRefreshNonce,
        selectedPoolHasActualForkActivity,
        selectedPoolQuestionOutcome,
        selectedPoolState,
        showSelectedPoolWorkflowDetails,
        view,
    ]);
    useEffect(() => {
        const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress);
        if (!isSelectedPoolForkWorkflowView(view) || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
            lastForkAuctionAutoLoadKey.current = undefined;
            return;
        }
        if (forkAuction.loadingForkAuctionDetails)
            return;
        const shouldReloadForkAuction = shouldReloadSelectedPoolDetails({
            currentDetailsAvailable: currentForkAuctionDetails !== undefined,
            lastHandledRefreshNonce: lastHandledForkAuctionRefreshNonceRef.current,
            loadedDetailsAddress: loadedForkAuctionDetails?.securityPoolAddress,
            refreshNonce: selectedPoolRefreshNonce,
            selectedPoolAddress: normalizedSelectedPoolAddress,
        });
        if (!shouldReloadForkAuction && sameAddress(loadedForkAuctionDetails?.securityPoolAddress, normalizedSelectedPoolAddress) && currentForkAuctionDetails !== undefined)
            return;
        const forkAuctionAutoLoadKey = `${normalizedSelectedPoolAddress}:${selectedPoolRefreshNonce}`;
        if (lastForkAuctionAutoLoadKey.current === forkAuctionAutoLoadKey)
            return;
        lastForkAuctionAutoLoadKey.current = forkAuctionAutoLoadKey;
        lastHandledForkAuctionRefreshNonceRef.current = selectedPoolRefreshNonce;
        void forkAuction.onLoadForkAuction(getAddress(normalizedSelectedPoolAddress));
    }, [currentForkAuctionDetails, forkAuction.loadingForkAuctionDetails, forkAuction.onLoadForkAuction, loadedForkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress, selectedPoolRefreshNonce, showSelectedPoolWorkflowDetails, view]);
    useEffect(() => {
        const reportingRefreshHash = reporting.reportingResult?.hash;
        if (reportingRefreshHash === undefined) {
            lastReportingOutcomeRefreshHash.current = undefined;
            return;
        }
        if (lastReportingOutcomeRefreshHash.current === reportingRefreshHash)
            return;
        lastReportingOutcomeRefreshHash.current = reportingRefreshHash;
        void onRefreshSelectedPoolData(reporting.reportingResult?.securityPoolAddress);
        if (showSelectedPoolWorkflowDetails && hasLoadedCurrentVault)
            void securityVault.onLoadSecurityVault();
    }, [hasLoadedCurrentVault, onRefreshSelectedPoolData, reporting.reportingResult, securityVault.onLoadSecurityVault, showSelectedPoolWorkflowDetails]);
    useEffect(() => {
        const nextForkAuctionResult = forkAuction.forkAuctionResult;
        const forkAuctionRefreshHash = nextForkAuctionResult?.hash;
        if (forkAuctionRefreshHash === undefined) {
            lastForkAuctionOutcomeRefreshHash.current = undefined;
            return;
        }
        if (nextForkAuctionResult === undefined)
            return;
        if (lastForkAuctionOutcomeRefreshHash.current === forkAuctionRefreshHash)
            return;
        lastForkAuctionOutcomeRefreshHash.current = forkAuctionRefreshHash;
        void onRefreshSelectedPoolData(nextForkAuctionResult.securityPoolAddress);
        if (showSelectedPoolWorkflowDetails && nextForkAuctionResult.action === 'startTruthAuction') {
            void forkAuction.onLoadForkAuction(nextForkAuctionResult.securityPoolAddress);
        }
        if (showSelectedPoolWorkflowDetails &&
            hasLoadedCurrentVault &&
            (nextForkAuctionResult.action === 'claimAuctionProceeds' ||
                nextForkAuctionResult.action === 'claimParentEscalationDeposits' ||
                nextForkAuctionResult.action === 'migrateUnresolvedEscalation' ||
                nextForkAuctionResult.action === 'migrateVault' ||
                nextForkAuctionResult.action === 'settleForkedEscalation' ||
                nextForkAuctionResult.action === 'startTruthAuction')) {
            void securityVault.onLoadSecurityVault();
        }
        if (shouldRefreshSelectedPoolReporting &&
            (nextForkAuctionResult.action === 'claimParentEscalationDeposits' || nextForkAuctionResult.action === 'migrateUnresolvedEscalation' || nextForkAuctionResult.action === 'forkWithOwnEscalation' || nextForkAuctionResult.action === 'settleForkedEscalation' || nextForkAuctionResult.action === 'startTruthAuction')) {
            void reporting.onLoadReporting();
        }
    }, [forkAuction.forkAuctionResult, forkAuction.onLoadForkAuction, hasLoadedCurrentVault, onRefreshSelectedPoolData, reporting.onLoadReporting, securityVault.onLoadSecurityVault, shouldRefreshSelectedPoolReporting, showSelectedPoolWorkflowDetails]);
    useEffect(() => {
        const vaultStatusRefreshHash = securityVault.securityVaultResult?.action === 'depositRepToVault' || securityVault.securityVaultResult?.action === 'redeemRepFromVault' ? securityVault.securityVaultResult.hash : undefined;
        if (vaultStatusRefreshHash === undefined) {
            lastVaultStatusRefreshHash.current = undefined;
            return;
        }
        if (lastVaultStatusRefreshHash.current === vaultStatusRefreshHash)
            return;
        lastVaultStatusRefreshHash.current = vaultStatusRefreshHash;
        void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress);
        if (shouldRefreshSelectedPoolReporting)
            void reporting.onLoadReporting();
    }, [onRefreshSelectedPoolData, reporting.onLoadReporting, securityVault.securityVaultResult, selectedPool?.securityPoolAddress, shouldRefreshSelectedPoolReporting]);
    useEffect(() => {
        const queuedOperationHash = securityVault.securityVaultResult?.action === 'queueWithdrawRep' ? securityVault.securityVaultResult.hash : undefined;
        if (queuedOperationHash === undefined) {
            lastImmediateQueuedOperationRefreshHash.current = undefined;
            return;
        }
        if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined)
            return;
        if (queuedVaultOperation !== undefined || currentPoolOraclePriceUsable !== true)
            return;
        if (lastImmediateQueuedOperationRefreshHash.current === queuedOperationHash)
            return;
        lastImmediateQueuedOperationRefreshHash.current = queuedOperationHash;
        void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress);
        if (securityVault.securityVaultResult?.action === 'queueWithdrawRep' && shouldRefreshSelectedPoolReporting)
            void reporting.onLoadReporting();
        if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault)
            void securityVault.onLoadSecurityVault();
    }, [
        currentPoolOracleManagerDetails,
        currentPoolOraclePriceUsable,
        hasLoadedCurrentVault,
        loadingPoolOracleManager,
        onRefreshSelectedPoolData,
        queuedVaultOperation,
        reporting.onLoadReporting,
        securityVault.onLoadSecurityVault,
        securityVault.securityVaultResult,
        selectedPool?.securityPoolAddress,
        shouldRefreshSelectedPoolReporting,
        showSelectedPoolWorkflowDetails,
        view,
    ]);
    useEffect(() => {
        const liquidationRefreshKey = securityPoolOverviewResult?.action !== 'queueLiquidation' || liquidationNoticeState === undefined || liquidationNoticeState === 'submitted' ? undefined : `${securityPoolOverviewResult.hash}:${liquidationNoticeState}`;
        if (liquidationRefreshKey === undefined) {
            lastLiquidationOutcomeRefreshKey.current = undefined;
            return;
        }
        if (lastLiquidationOutcomeRefreshKey.current === liquidationRefreshKey)
            return;
        lastLiquidationOutcomeRefreshKey.current = liquidationRefreshKey;
        void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress);
        if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault)
            void securityVault.onLoadSecurityVault();
    }, [hasLoadedCurrentVault, liquidationNoticeState, onRefreshSelectedPoolData, securityPoolOverviewResult, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view]);
    useEffect(() => {
        if (poolPriceOracleResult?.action !== 'executeStagedOperation') {
            lastExecutedOperationRefreshHash.current = undefined;
            return;
        }
        if (lastExecutedOperationRefreshHash.current === poolPriceOracleResult.hash)
            return;
        lastExecutedOperationRefreshHash.current = poolPriceOracleResult.hash;
        void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress);
        if (poolPriceOracleResult.stagedExecution?.success === true && poolPriceOracleResult.stagedExecution.operation === 'withdrawRep' && shouldRefreshSelectedPoolReporting)
            void reporting.onLoadReporting();
        if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault)
            void securityVault.onLoadSecurityVault();
    }, [hasLoadedCurrentVault, onRefreshSelectedPoolData, poolPriceOracleResult, reporting.onLoadReporting, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, shouldRefreshSelectedPoolReporting, showSelectedPoolWorkflowDetails, view]);
    const selectedPoolViewOptions = SELECTED_POOL_VIEWS.map(selectedPoolUiView => ({
        disabled: selectedPoolUniverseMismatch || selectedPoolWorkflowGuardMessage !== undefined,
        id: `selected-pool-view-${selectedPoolUiView}`,
        label: getSelectedPoolViewLabel(selectedPoolUiView),
        ...(selectedPoolUniverseMismatch || selectedPoolWorkflowGuardMessage === undefined ? {} : { reason: selectedPoolWorkflowGuardMessage }),
        value: selectedPoolUiView,
    }));
    return (_jsxs(RouteWorkflowPanel, { showHeader: showHeader, title: securityPoolCopy.selectedPool, children: [_jsx(StickyObjectContext, { ...(loadedSelectedPool === undefined || selectedPoolSummaryPool === undefined
                    ? {}
                    : {
                        badge: (_jsx(Badge, { tone: getSecurityPoolStatusBadgeTone(selectedPoolStateModel.lifecycleState), children: getSecurityPoolStatusBadgeLabel({
                                hasForkActivity: selectedPoolSummaryPool.hasForkActivity,
                                questionOutcome: selectedPoolSummaryPool.questionOutcome,
                                lifecycleState: selectedPoolStateModel.lifecycleState,
                            }) })),
                    }), title: getSelectedPoolCardTitle(marketDetails === undefined ? undefined : getQuestionTitle(marketDetails)), items: selectedPoolSummaryPool === undefined
                    ? []
                    : [
                        { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: selectedPoolSummaryPool.universeId }) },
                        { label: commonCopy.securityPoolAddress, value: _jsx(AddressValue, { address: selectedPoolSummaryPool.securityPoolAddress }) },
                    ], variant: 'embedded-context-strip' }), _jsxs("div", { className: 'selected-pool-context-nonsticky', children: [_jsx("div", { className: 'selected-pool-context-controls', children: _jsx("div", { className: 'selected-pool-change-control', children: _jsx("div", { className: 'selected-pool-context-lookup', children: _jsx(LookupFieldRow, { label: commonCopy.securityPoolAddress, value: securityPoolAddress, onInput: onSecurityPoolAddressChange, placeholder: commonCopy.hexValuePlaceholder, action: _jsx("button", { className: 'secondary', onClick: () => onRefreshSelectedPoolData(), disabled: !hasSelectedPoolAddress || loadingSecurityPools, children: loadingSecurityPools ? _jsx(LoadingText, { children: securityPoolCopy.refreshingPool }) : securityPoolCopy.refreshPool }) }) }) }) }), selectedPoolSummaryContent === undefined ? undefined : (_jsxs("details", { className: 'selected-pool-context-details', children: [_jsx("summary", { children: securityPoolCopy.poolContextAndMetrics }), _jsx("div", { className: 'selected-pool-context-details-content', children: selectedPoolSummaryContent })] }))] }), _jsx(ErrorNotice, { message: securityPoolOverviewError }), selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : (_jsxs(SectionBlock, { title: securityPoolCopy.universeMismatch, tone: 'critical', variant: 'embedded', children: [_jsxs("p", { className: 'detail', children: [_jsx("span", { children: securityPoolCopy.poolUniverseLead }), " ", _jsx(UniverseLink, { format: 'hex', universeId: selectedPool.universeId }), " ", _jsx("span", { children: securityPoolCopy.activeUniverseSeparator }), " ", _jsx("span", { children: formatUniverseIdHex(activeUniverseId) }), ". ", _jsx("span", { children: securityPoolCopy.missingPoolDetail })] }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'primary', type: 'button', onClick: () => onSwitchToPoolUniverse?.(selectedPool.universeId, selectedPool.securityPoolAddress), children: securityPoolCopy.switchToPoolUniverse }), _jsx("button", { className: 'secondary', type: 'button', onClick: onReturnToCurrentUniverse, children: securityPoolCopy.returnToCurrentUniverse })] })] })), _jsx("section", { className: 'selected-pool-workspace', children: _jsxs("div", { className: 'selected-pool-workspace-grid', children: [_jsx("div", { className: 'selected-pool-workflow-rail', children: _jsx(ViewTabs, { ariaLabel: securityPoolCopy.selectedPoolViews, className: 'selected-pool-workflow-nav', groups: [
                                    { ariaLabel: securityPoolCopy.primaryPoolActions, className: 'selected-pool-workflow-group', values: SELECTED_POOL_PRIMARY_VIEWS },
                                    { ariaLabel: securityPoolCopy.additionalPoolActions, className: 'selected-pool-workflow-group selected-pool-workflow-group-secondary', values: SELECTED_POOL_SECONDARY_VIEWS },
                                ], orientation: 'vertical', semantics: 'switcher', size: 'compact', value: view, onChange: nextView => onSelectedPoolViewChange(hasSelectedPoolAddress ? nextView : undefined), options: selectedPoolViewOptions }) }), _jsx("div", { className: 'selected-pool-workflow-content', children: !showSelectedPoolWorkflowDetails ? (_jsxs(SectionBlock, { title: selectedPoolLookupState === 'missing' ? securityPoolCopy.poolNotFound : commonCopy.managePool, variant: 'plain', children: [selectedPoolUniverseMismatch || selectedPoolWorkflowLockedPresentation === undefined ? undefined : _jsx(StateHint, { presentation: selectedPoolWorkflowLockedPresentation }), hasSelectedPoolAddress ? undefined : (_jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'primary', type: 'button', onClick: onBrowsePools, children: commonCopy.browsePoolsAction }), _jsx("button", { className: 'secondary', type: 'button', onClick: onCreatePool, children: commonCopy.createPoolAction })] }))] })) : (_jsxs(_Fragment, { children: [view === 'vaults' ? (_jsxs("div", { className: 'workflow-stack vault-workspace', children: [_jsxs(SectionBlock, { density: 'compact', title: securityPoolCopy.vaultOperations, variant: 'plain', actions: _jsx("div", { className: 'actions', children: _jsx(ViewTabs, { ariaLabel: securityPoolCopy.selectedPoolVaultViews, className: 'vault-content-switch', semantics: 'switcher', size: 'compact', value: vaultView, onChange: setVaultView, options: selectedVaultViewOptions }) }), children: [selectedVaultLoadNotice, _jsx(LookupFieldRow, { label: securityPoolCopy.selectedVaultOwner, value: selectedVaultOwnerInput, onInput: selectedVaultOwner => securityVault.onSecurityVaultFormChange({ selectedVaultOwner }), placeholder: commonCopy.hexValuePlaceholder, action: _jsx("button", { className: 'secondary', onClick: () => securityVault.onLoadSecurityVault(), disabled: securityVault.loadingSecurityVault, children: securityVault.loadingSecurityVault ? _jsx(LoadingText, { children: securityPoolCopy.refreshing }) : commonCopy.refresh }) }), vaultView === 'selected-vault' && selectedVaultDetails !== undefined && selectedVaultExistsOnchain ? (_jsx(SelectedVaultSummarySection, { repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl, capacityOwnershipAttoRep: selectedVaultDetails.capacityOwnershipAttoRep, securityVaultDetails: selectedVaultDetails, selectedPoolStatoblastSecurityMultiplierBps: securityVault.selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount: selectedVaultIsOwnedByAccount, variant: 'embedded' })) : undefined] }), vaultView === 'browse-vaults' ? (_jsx(SectionBlock, { title: securityPoolCopy.vaultDirectory, variant: 'embedded', children: _jsx(SecurityPoolVaultDirectory, { emptyState: (() => {
                                                        if (selectedPool === undefined) {
                                                            if (selectedPoolBrowsePresentation === undefined)
                                                                return undefined;
                                                            return _jsx(StateHint, { presentation: selectedPoolBrowsePresentation });
                                                        }
                                                        let emptyVaultDirectoryDetail = securityPoolCopy.formatNoCurrentVaultPositions(selectedPool.vaultCount);
                                                        if (selectedPool.vaultCount === 0n)
                                                            emptyVaultDirectoryDetail = securityPoolCopy.poolVaultsEmpty;
                                                        if (selectedPool.vaultScanCapped === true)
                                                            emptyVaultDirectoryDetail = securityPoolCopy.vaultRegistryScanEmpty;
                                                        return (_jsx(StateHint, { presentation: {
                                                                key: 'empty',
                                                                badgeLabel: commonCopy.none,
                                                                badgeTone: 'muted',
                                                                detail: emptyVaultDirectoryDetail,
                                                            } }));
                                                    })(), pool: selectedPool, renderActions: vault => {
                                                        if (selectedPool === undefined)
                                                            return undefined;
                                                        return (_jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', onClick: () => {
                                                                        securityVault.onSecurityVaultFormChange({ selectedVaultOwner: vault.vaultAddress.toString() });
                                                                        setVaultView('selected-vault');
                                                                        void securityVault.onLoadSecurityVault(vault.vaultAddress.toString());
                                                                    }, children: securityPoolCopy.selectVault }), _jsx("button", { className: 'secondary', onClick: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress, vault.capacityOwnershipAttoRep), disabled: accountState.address === undefined || !isOnActiveAppChain || !liquidationEnabled, title: !isOnActiveAppChain && accountState.address !== undefined ? (getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason) : securityPoolCopy.reviewLiquidation, children: securityPoolCopy.reviewLiquidation })] }));
                                                    }, renderBadge: vault => (selectedVaultOwner !== '' && sameCaseInsensitiveText(selectedVaultOwner, vault.vaultAddress) ? _jsx(Badge, { tone: 'ok', children: commonCopy.selected }) : undefined), repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl }) })) : (_jsx(SecurityVaultSection, { ...securityVault, compactLayout: true, extraReadinessActions: [
                                                    (() => {
                                                        const canUseSelectedVaultActions = accountState.address !== undefined && selectedVaultIsOwnedByAccount && selectedVaultDetails !== undefined && isOnActiveAppChain;
                                                        const loadedVaultMissing = selectedVaultDetails !== undefined && !selectedVaultExistsOnchain;
                                                        const liquidationBlocker = (() => {
                                                            if (loadedVaultMissing)
                                                                return securityPoolCopy.missingVaultDetail;
                                                            return undefined;
                                                        })();
                                                        return {
                                                            actionLabel: securityPoolCopy.reviewLiquidation,
                                                            ...(liquidationBlocker === undefined ? {} : { blocker: liquidationBlocker }),
                                                            description: securityPoolCopy.liquidationWorkflowDescription,
                                                            key: 'liquidate-vault',
                                                            readiness: liquidationBlocker === undefined && liquidationEnabled && canUseSelectedVaultActions ? 'ready' : 'blocked',
                                                            title: securityPoolCopy.reviewLiquidationTitle,
                                                            ...(selectedPool === undefined || selectedVaultDetails === undefined || selectedVaultOwner === '' || !liquidationEnabled || !selectedVaultExistsOnchain || !canUseSelectedVaultActions
                                                                ? {}
                                                                : {
                                                                    onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultDetails.vaultAddress, selectedVaultDetails.capacityOwnershipAttoRep),
                                                                }),
                                                        };
                                                    })(),
                                                ], autoLoadVault: true, modalFirst: true, onViewStagedOperations: () => onSelectedPoolViewChange('staged-operations'), oracleManagerDetails: currentPoolOracleManagerDetails, poolState: selectedPoolStateModel, selectedPoolTotalPoolHeldAttoRep: selectedPool?.totalPoolHeldAttoRep, selectedPoolTotalCapacityOwnershipAttoRep: selectedPool?.totalCapacityOwnershipAttoRep, selectedMarketTitle: selectedPool?.marketDetails.title, showHeader: false, showLookupSection: false, showSecurityPoolAddressInput: false, showSummarySection: false }))] })) : undefined, view === 'trading' ? _jsx(TradingSection, { ...trading, selectedPool: effectiveSelectedPool, poolState: selectedPoolStateModel, embedInCard: true, showHeader: false, showSecurityPoolAddressInput: false }) : undefined, view === 'reporting' ? (_jsx(ReportingSection, { ...reporting, currentTimestamp: currentTimestamp, embedInCard: true, forkAlreadyTriggered: selectedPoolHasActualForkActivity, lockedReason: reportingLockedReason, mode: 'full-reporting', onOpenForkWorkflow: openSelectedPoolForkWorkflow, onOpenPriceOracle: () => onSelectedPoolViewChange('price-oracle'), onTriggerZoltarFork: triggerZoltarForkAvailability.disabled ? undefined : forkAuction.onForkWithOwnEscalation, previewMarketDetails: currentReportingDetails === undefined ? marketDetails : undefined, reportingDetails: currentReportingDetails, reportActionGuardMessage: reportingOracleGuardMessage, showHeader: false, showSecurityPoolAddressInput: false, triggerZoltarForkAvailability: triggerZoltarForkAvailability, triggerZoltarForkPending: forkAuction.forkAuctionActiveAction === 'forkWithOwnEscalation' })) : undefined, isSelectedPoolForkWorkflowView(view) ? (_jsx(ForkAuctionSection, { ...forkAuction, currentStageView: currentForkStage, currentTimestamp: currentTimestamp, disabled: forkWorkflowDisabled, disabledMessage: forkWorkflowDisabled ? securityPoolCopy.operationalForkReadOnlyDetail : undefined, embedInCard: true, forkAuctionDetails: currentForkAuctionDetails, lifecycleStateOverride: selectedPoolLifecycleState, loadingReportingDetails: reporting.loadingReportingDetails, onLoadReporting: reporting.onLoadReporting, onReportingFormChange: reporting.onReportingFormChange, previewPool: selectedPool, reportingDetails: currentReportingDetails, reportingError: reporting.reportingError, reportingForm: reporting.reportingForm, selectedStageView: forkWorkflowSelectionStage, selectedPoolRefreshNonce: selectedPoolRefreshNonce, securityPools: securityPools, universeForkTime: universeForkTime, onSelectedStageViewChange: onForkWorkflowSelectionStageChange, showHeader: false, showSecurityPoolAddressInput: false })) : undefined, view === 'staged-operations' && loadedSelectedPool !== undefined ? (_jsxs(SectionBlock, { density: 'compact', title: securityPoolCopy.stagedOperations, variant: 'plain', children: [_jsx(ErrorNotice, { message: currentPoolOracleManagerError }), _jsxs(SectionBlock, { density: 'compact', variant: 'embedded', children: [stagedOperations.map(operation => (_jsxs(WarningSurface, { as: 'article', className: 'warning-entity-card', surface: 'flat', variant: 'compact', children: [_jsx("div", { className: 'entity-card-header', children: _jsxs("div", { className: 'entity-card-copy', children: [_jsx("h3", { children: getPendingOperationLabel(operation.operation) }), _jsx("p", { className: 'detail', children: getStagedOperationExecutionModeLabel(operation.operationId, pendingSettlementOperationIds) })] }) }), _jsxs(MetricGrid, { className: 'entity-card-body', children: [_jsx(MetricField, { label: securityPoolCopy.operationId, children: operation.operationId.toString() }), _jsx(MetricField, { label: securityPoolCopy.initiator, children: _jsx(AddressValue, { address: operation.operator }) }), _jsx(MetricField, { label: commonCopy.targetVault, children: _jsx(AddressValue, { address: operation.targetVault }) }), _jsx(MetricField, { label: getPendingOperationAmountPresentation(operation.operation).label, children: _jsx(CurrencyValue, { precision: 'exact', value: operation.amount, suffix: getPendingOperationAmountPresentation(operation.operation).suffix }) })] })] }, operation.operationId.toString()))), activeStagedOperationCount > BigInt(stagedOperations.length) ? _jsx("p", { className: 'detail', children: securityPoolCopy.formatShowingActiveStagedOperationsLabel(stagedOperations.length.toString(), activeStagedOperationCount.toString()) }) : null, currentPoolOracleManagerDetails === undefined || stagedOperations.length > 0 ? null : _jsx(StateHint, { presentation: { key: 'empty', badgeLabel: securityPoolCopy.noneQueued, badgeTone: 'muted', detail: securityPoolCopy.stagedOperationsEmpty } })] }), currentPoolOracleManagerDetails === undefined ? undefined : (_jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.stagedOperationId }), _jsx(FormInput, { value: manualPendingOperationId, onInput: event => setManualPendingOperationId(event.currentTarget.value), placeholder: selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : securityPoolCopy.zeroPlaceholder })] })), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', onClick: () => onLoadPoolOracleManager(loadedSelectedPool.managerAddress), disabled: loadingPoolOracleManager || (currentPoolOracleManagerDetails === undefined && currentPoolOracleManagerError === undefined), children: (() => {
                                                            if (currentPoolOracleManagerDetails === undefined && currentPoolOracleManagerError === undefined)
                                                                return _jsx(LoadingText, { children: securityPoolCopy.loadingStagedOperations });
                                                            if (currentPoolOracleManagerDetails === undefined)
                                                                return securityPoolCopy.retryStagedOperations;
                                                            if (loadingPoolOracleManager)
                                                                return _jsx(LoadingText, { children: securityPoolCopy.refreshingOperations });
                                                            return securityPoolCopy.refreshStagedOperations;
                                                        })() }), currentPoolOracleManagerDetails === undefined ? undefined : (_jsx(TransactionActionButton, { idleLabel: securityPoolCopy.executeStagedOperation, pendingLabel: securityPoolCopy.executingStagedOperationLabel, onClick: () => {
                                                            if (resolvedPendingOperationId === undefined)
                                                                return;
                                                            onExecutePendingPoolOperation(loadedSelectedPool.managerAddress, resolvedPendingOperationId, loadedSelectedPool.securityPoolAddress);
                                                        }, pending: poolOracleActiveAction === 'executeStagedOperation', tone: 'secondary', availability: {
                                                            disabled: !selectedPoolStateModel.actions.executeStagedOperation.enabled || !canUseOracleActions || executePendingOperationGuardMessage !== undefined,
                                                            reason: selectedPoolStateModel.actions.executeStagedOperation.enabled ? executePendingOperationGuardMessage : undefined,
                                                        } }))] })] })) : undefined, view === 'price-oracle' && loadedSelectedPool !== undefined ? (_jsxs(SectionBlock, { density: 'compact', title: securityPoolCopy.poolPriceOracle, variant: 'plain', children: [_jsxs(MetricGrid, { children: [_jsx(MetricField, { label: commonCopy.openOraclePrice, valueTagName: 'span', children: _jsx(OpenOraclePriceValue, { currentTimestamp: currentTimestamp, lastPrice: (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice, lastSettlementTimestamp: (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n, priceValidUntilTimestamp: currentPoolOracleManagerDetails?.priceValidUntilTimestamp }) }), currentPoolOracleManagerDetails === undefined ? undefined : (_jsx(MetricField, { label: securityPoolCopy.requestCost, children: _jsx(CurrencyValue, { value: currentPoolOracleManagerDetails.requestPriceCostAttoEth, suffix: commonCopy.eth }) })), currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (_jsx(MetricField, { label: securityPoolCopy.pendingRequest, children: _jsx("button", { className: 'link', type: 'button', onClick: () => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId), children: securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString()) }) }))] }), _jsx(ErrorNotice, { message: currentPoolOracleManagerError }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', onClick: () => onLoadPoolOracleManager(loadedSelectedPool.managerAddress), disabled: loadingPoolOracleManager, children: loadingPoolOracleManager ? _jsx(LoadingText, { children: securityPoolCopy.refreshingOracle }) : securityPoolCopy.refreshOracle }), _jsx(TransactionActionButton, { idleLabel: securityPoolCopy.requestNewPrice, pendingLabel: securityPoolCopy.requestingNewPrice, onClick: () => {
                                                            if (requestPriceTransactionEthValue === undefined)
                                                                return;
                                                            setRequestPriceReview({
                                                                requestValueAttoEth: requestPriceTransactionEthValue,
                                                                managerAddress: loadedSelectedPool.managerAddress,
                                                                questionTitle: marketDetails === undefined ? undefined : getQuestionTitle(marketDetails),
                                                                securityPoolAddress: loadedSelectedPool.securityPoolAddress,
                                                                universeId: loadedSelectedPool.universeId,
                                                            });
                                                        }, pending: poolOracleActiveAction === 'requestPrice', tone: 'secondary', availability: {
                                                            disabled: !selectedPoolStateModel.actions.requestPrice.enabled || !canUseOracleActions || requestPriceTransactionEthValue === undefined || requestPriceGuardMessage !== undefined,
                                                            reason: selectedPoolStateModel.actions.requestPrice.enabled ? requestPriceOpenGuardMessage : undefined,
                                                        } })] })] })) : undefined] })) })] }) }), _jsxs(OperationModal, { closeOnSuccessKey: poolPriceOracleResult?.action === 'requestPrice' ? poolPriceOracleResult.hash : undefined, context: requestPriceReview === undefined
                    ? []
                    : [
                        ...(requestPriceReview.questionTitle === undefined ? [] : [{ label: commonCopy.question, value: requestPriceReview.questionTitle }]),
                        { label: commonCopy.securityPoolAddress, value: _jsx(AddressValue, { address: requestPriceReview.securityPoolAddress }) },
                        { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: requestPriceReview.universeId }) },
                        { label: transactionReviewCopy.network, value: _jsx(TransactionNetworkValue, {}) },
                    ], description: securityPoolCopy.requestPriceReviewDescription, isOpen: requestPriceReview !== undefined, onClose: () => setRequestPriceReview(undefined), title: securityPoolCopy.requestNewPriceTitle, children: [_jsx(TransactionReview, { primary: [
                            {
                                label: transactionReviewCopy.youPay,
                                value: _jsx(CurrencyValue, { precision: 'exact', value: requestPriceReview?.requestValueAttoEth, suffix: commonCopy.eth }),
                            },
                        ], risks: [securityPoolCopy.requestPricePendingReportRisk, securityPoolCopy.requestPriceFundingRisk] }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', type: 'button', onClick: () => setRequestPriceReview(undefined), disabled: poolOracleActiveAction === 'requestPrice', children: commonCopy.cancel }), _jsx(TransactionActionButton, { idleLabel: securityPoolCopy.confirmPriceRequest, pendingLabel: securityPoolCopy.requestingNewPrice, onClick: () => {
                                    if (requestPriceReview === undefined)
                                        return;
                                    onRequestPoolPrice(requestPriceReview.managerAddress, requestPriceReview.securityPoolAddress, requestPriceReview.requestValueAttoEth);
                                }, pending: poolOracleActiveAction === 'requestPrice', availability: {
                                    disabled: requestPriceReview === undefined || !selectedPoolStateModel.actions.requestPrice.enabled || !canUseOracleActions || requestPriceConfirmationGuardMessage !== undefined,
                                    reason: selectedPoolStateModel.actions.requestPrice.enabled ? requestPriceConfirmationGuardMessage : undefined,
                                } })] })] }), _jsx(LiquidationModal, { accountAddress: accountState.address, closeLiquidationModal: closeLiquidationModal, currentPoolOracleManagerDetails: currentPoolOracleManagerDetails, isOnActiveAppChain: isOnActiveAppChain, liquidationDebtEthAmount: liquidationDebtEthAmount, maximumLiquidationDebtAttoEth: maximumLiquidationDebtAttoEth, liquidationManagerAddress: liquidationManagerAddress, liquidationFundingPreview: liquidationFundingPreview, liquidationFundingPreviewError: liquidationFundingPreviewError, liquidationModalOpen: liquidationModalOpen, liquidationSecurityPoolAddress: liquidationSecurityPoolAddress, liquidationTimeoutMinutes: liquidationTimeoutMinutes, loadingPoolOracleManager: loadingPoolOracleManager, loadingLiquidationFundingPreview: loadingLiquidationFundingPreview, liquidationTargetVault: liquidationTargetVault, liquidationReceiverVault: liquidationReceiverVault, liquidationApprovalId: liquidationApprovalId, liquidationApprovalDetails: liquidationApprovalDetails, liquidationApprovalError: liquidationApprovalError, liquidationReceiverVaultSummaryError: liquidationReceiverVaultSummaryError, liquidationReceiverVaultSummaryResolved: liquidationReceiverVaultSummaryResolved, loadingLiquidationApproval: loadingLiquidationApproval, loadingLiquidationReceiverVaultSummary: loadingLiquidationReceiverVaultSummary, onLoadPoolOracleManager: onLoadPoolOracleManager, onLoadLiquidationFundingPreview: onLoadLiquidationFundingPreview, onLoadLiquidationApproval: onLoadLiquidationApproval, onLoadLiquidationReceiverVaultSummary: onLoadLiquidationReceiverVaultSummary, onSelectedPoolViewChange: onSelectedPoolViewChange, poolState: selectedPoolStateModel, poolOracleManagerError: liquidationPoolOracleManagerError, repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl, selectedPool: selectedPool, securityPoolOverviewActiveAction: securityPoolOverviewActiveAction, securityPoolLiquidationError: securityPoolLiquidationError, securityPoolOverviewResult: securityPoolOverviewResult, walletBalanceAttoEth: accountState.ethBalanceAttoEth, receiverVaultSummary: liquidationReceiverVaultSummary ?? selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationReceiverVault)), targetVaultSummary: selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault)), onLiquidationAmountChange: onLiquidationAmountChange, onLiquidationReceiverVaultChange: onLiquidationReceiverVaultChange, onLiquidationApprovalIdChange: onLiquidationApprovalIdChange, onLiquidationTimeoutMinutesChange: onLiquidationTimeoutMinutesChange, onQueueLiquidation: onQueueLiquidation })] }));
}
//# sourceMappingURL=SecurityPoolWorkflowSection.js.map