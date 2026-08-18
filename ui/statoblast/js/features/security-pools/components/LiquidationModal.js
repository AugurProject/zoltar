import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as liquidationCopy from '@zoltar/ui-zoltar/copy/liquidation.js';
import { useEffect, useId, useRef } from 'preact/hooks';
import { AddressInfo } from '@zoltar/ui-core-shared/components/AddressInfo.js';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { OpenOraclePriceValue } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOraclePriceValue.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { TransactionUniverseValue } from '@zoltar/ui-zoltar/features/universes/components/TransactionUniverseValue.js';
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js';
import { TransactionStatusCard } from '@zoltar/ui-core-shared/components/TransactionStatusCard.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { tryParseAddressInput } from '@zoltar/ui-core-shared/lib/inputs.js';
import { pickFirstReason } from '@zoltar/ui-core-shared/lib/actionAvailability.js';
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { formatCurrencyInputBalance, formatDuration, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js';
import { getDeterministicLiquidationFailureReason, getLiquidationExecutionFailureDetail, getLiquidationFailureReason, getMaxLiquidationAmount, simulateLiquidation } from '../lib/liquidation.js';
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js';
import { tryParseEthAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js';
import { getOracleRequestEthGuardMessage } from '@zoltar/ui-zoltar/features/open-oracle/lib/oracleRequestEth.js';
import { getRepPriceSourceCopy, renderRepPriceSourceLabel } from '@zoltar/ui-zoltar/features/open-oracle/lib/repPriceSource.js';
import { getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable } from '../lib/securityVault.js';
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js';
import { useModalFocusIsolation } from '@zoltar/ui-core-shared/hooks/useModalFocusIsolation.js';
import { getWrongNetworkMessage } from '@zoltar/ui-core-shared/lib/network.js';
function formatHealthFactorBps(healthFactorBps) {
    const whole = healthFactorBps / 10000n;
    const fractional = (healthFactorBps % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
    return `${whole.toString()}${fractional === '' ? '' : `.${fractional}`}${liquidationCopy.protocolHealthSuffix}`;
}
function getApprovalStatus(revoked, nonceInvalidated, validAfter, validUntil, currentTimestamp) {
    if (revoked)
        return liquidationCopy.approvalRevoked;
    if (nonceInvalidated)
        return liquidationCopy.approvalInvalidated;
    if (currentTimestamp === undefined)
        return commonCopy.unavailable;
    if (currentTimestamp < validAfter)
        return liquidationCopy.approvalPending;
    if (currentTimestamp >= validUntil)
        return liquidationCopy.approvalExpired;
    return liquidationCopy.approvalActive;
}
function getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp) {
    if (currentPoolOracleManagerDetails === undefined)
        return 'refreshing';
    return isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp) ? 'execute' : 'queue';
}
function getLiquidationModalTitle(currentPoolOracleManagerDetails, currentTimestamp) {
    const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp);
    switch (executionMode) {
        case 'execute':
            return liquidationCopy.executeVaultLiquidationTitle;
        case 'queue':
            return liquidationCopy.queueVaultLiquidation;
        case 'refreshing':
            return liquidationCopy.liquidateVaultTitle;
        default:
            return assertNever(executionMode);
    }
}
function getLiquidationButtonLabels(currentPoolOracleManagerDetails, currentTimestamp) {
    const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp);
    switch (executionMode) {
        case 'execute':
            return { idle: liquidationCopy.executeVaultLiquidation, pending: liquidationCopy.executingLiquidation };
        case 'queue':
            return { idle: liquidationCopy.queueLiquidation, pending: liquidationCopy.queueingLiquidation };
        case 'refreshing':
            return { idle: liquidationCopy.liquidateVault, pending: liquidationCopy.liquidateVaultPendingLabel };
        default:
            return assertNever(executionMode);
    }
}
function renderQueuedLiquidationStatusCard({ onViewInStagedOperations, queuedLiquidationOperation, queuedLiquidationStatus, securityPoolOverviewResult, }) {
    if (queuedLiquidationStatus === undefined)
        return null;
    if (queuedLiquidationStatus === 'queued' || queuedLiquidationStatus === 'manual-queued') {
        if (queuedLiquidationOperation === undefined)
            return null;
        return (_jsx(TransactionStatusCard, { surface: 'flat', title: liquidationCopy.liquidationQueued, badge: _jsx(Badge, { tone: 'warning', children: liquidationCopy.queued }), metrics: _jsxs(MetricGrid, { children: [_jsxs(MetricField, { label: commonCopy.stagedOperation, children: ["#", queuedLiquidationOperation.operationId.toString()] }), queuedLiquidationOperation.amount === undefined ? null : (_jsx(MetricField, { label: liquidationCopy.requestedLiquidationDebt, children: _jsx(CurrencyValue, { precision: 'exact', value: queuedLiquidationOperation.amount, suffix: commonCopy.eth }) }))] }), detail: queuedLiquidationStatus === 'manual-queued' ? commonCopy.manualQueuedOperationDetail : undefined, actions: _jsx("button", { className: 'secondary', type: 'button', onClick: onViewInStagedOperations, children: commonCopy.viewInStagedOperations }) }));
    }
    if (queuedLiquidationStatus === 'failed')
        return (_jsx(TransactionStatusCard, { surface: 'flat', title: commonCopy.liquidationFailed, badge: _jsx(Badge, { tone: 'blocked', children: commonCopy.failed }), detail: getLiquidationExecutionFailureDetail(securityPoolOverviewResult?.stagedExecution?.errorMessage) ?? liquidationCopy.immediateLiquidationRejectedDetail, secondaryDetail: commonCopy.stagedOperationRetryDetail }));
    if (queuedLiquidationStatus === 'executed')
        return _jsx(TransactionStatusCard, { surface: 'flat', title: commonCopy.liquidationExecuted, badge: _jsx(Badge, { tone: 'ok', children: commonCopy.executed }), detail: liquidationCopy.immediateLiquidationSuccessDetail });
    if (queuedLiquidationStatus === 'missing')
        return _jsx(TransactionStatusCard, { surface: 'flat', title: commonCopy.liquidationSubmitted, badge: _jsx(Badge, { tone: 'warning', children: liquidationCopy.checkState }), detail: commonCopy.transactionStateUnavailableDetail });
    return _jsx(TransactionStatusCard, { surface: 'flat', title: liquidationCopy.refreshingLiquidationStateTitle, badge: _jsx(Badge, { tone: 'muted', children: commonCopy.refreshingWithoutEllipsis }), detail: liquidationCopy.refreshingLiquidationState });
}
export function LiquidationModal({ accountAddress, closeLiquidationModal, currentPoolOracleManagerDetails, isOnActiveAppChain, liquidationDebtEthAmount, maximumLiquidationDebtAttoEth, liquidationManagerAddress, liquidationFundingPreview, liquidationFundingPreviewError, liquidationModalOpen, liquidationSecurityPoolAddress, liquidationTimeoutMinutes, loadingPoolOracleManager, loadingLiquidationFundingPreview = false, liquidationTargetVault, liquidationReceiverVault = accountAddress ?? '', liquidationApprovalId = `0x${'00'.repeat(32)}`, liquidationApprovalDetails, liquidationApprovalError, liquidationReceiverVaultSummaryError, liquidationReceiverVaultSummaryResolved = false, loadingLiquidationApproval = false, loadingLiquidationReceiverVaultSummary = false, onLoadPoolOracleManager, onLoadLiquidationFundingPreview = () => undefined, onSelectedPoolViewChange, poolState, poolOracleManagerError = undefined, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, selectedPool, securityPoolOverviewActiveAction, securityPoolLiquidationError, securityPoolOverviewResult, receiverVaultSummary: loadedReceiverVaultSummary, callerVaultSummary, targetVaultSummary, onLiquidationAmountChange, onLiquidationReceiverVaultChange = () => undefined, onLiquidationApprovalIdChange = () => undefined, onLoadLiquidationApproval = () => undefined, onLoadLiquidationReceiverVaultSummary = () => undefined, onLiquidationTimeoutMinutesChange, onQueueLiquidation, walletBalanceAttoEth, }) {
    const chainCurrentTimestamp = useChainTimestamp();
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const titleId = useId();
    const showLiquidationModal = liquidationModalOpen || securityPoolOverviewActiveAction === 'queueLiquidation' || securityPoolOverviewResult?.action === 'queueLiquidation' || securityPoolLiquidationError !== undefined;
    useModalFocusIsolation({
        dialogRef,
        initialFocusRef: closeButtonRef,
        isOpen: showLiquidationModal,
        onClose: closeLiquidationModal,
    });
    useEffect(() => {
        if (!showLiquidationModal)
            return;
        if (liquidationManagerAddress === undefined || currentPoolOracleManagerDetails !== undefined || loadingPoolOracleManager || poolOracleManagerError !== undefined)
            return;
        onLoadPoolOracleManager(liquidationManagerAddress);
    }, [currentPoolOracleManagerDetails, liquidationManagerAddress, loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerError, showLiquidationModal]);
    useEffect(() => {
        if (!showLiquidationModal || getLiquidationExecutionMode(currentPoolOracleManagerDetails, chainCurrentTimestamp) !== 'queue')
            return;
        if (liquidationManagerAddress === undefined || liquidationFundingPreview !== undefined || liquidationFundingPreviewError !== undefined || loadingLiquidationFundingPreview)
            return;
        onLoadLiquidationFundingPreview(liquidationManagerAddress);
    }, [chainCurrentTimestamp, currentPoolOracleManagerDetails, liquidationFundingPreview, liquidationFundingPreviewError, liquidationManagerAddress, loadingLiquidationFundingPreview, onLoadLiquidationFundingPreview, showLiquidationModal]);
    const delegatedReceiver = accountAddress !== undefined && liquidationReceiverVault.trim() !== '' && !sameAddress(accountAddress, liquidationReceiverVault.trim());
    const zeroApprovalId = `0x${'00'.repeat(32)}`;
    const hasValidApprovalId = /^0x[0-9a-fA-F]{64}$/.test(liquidationApprovalId) && liquidationApprovalId !== zeroApprovalId;
    useEffect(() => {
        if (!showLiquidationModal || !delegatedReceiver || !hasValidApprovalId || liquidationApprovalDetails !== undefined || liquidationApprovalError !== undefined || loadingLiquidationApproval)
            return;
        onLoadLiquidationApproval();
    }, [delegatedReceiver, hasValidApprovalId, liquidationApprovalDetails, liquidationApprovalError, loadingLiquidationApproval, onLoadLiquidationApproval, showLiquidationModal]);
    const hasValidReceiverVault = tryParseAddressInput(liquidationReceiverVault) !== undefined;
    useEffect(() => {
        if (!showLiquidationModal || !delegatedReceiver || !hasValidReceiverVault || liquidationReceiverVaultSummaryResolved || liquidationReceiverVaultSummaryError !== undefined || loadingLiquidationReceiverVaultSummary)
            return;
        onLoadLiquidationReceiverVaultSummary();
    }, [delegatedReceiver, hasValidReceiverVault, liquidationReceiverVaultSummaryError, liquidationReceiverVaultSummaryResolved, loadingLiquidationReceiverVaultSummary, onLoadLiquidationReceiverVaultSummary, showLiquidationModal]);
    if (!showLiquidationModal)
        return undefined;
    const receiverVaultSummary = delegatedReceiver ? loadedReceiverVaultSummary : (loadedReceiverVaultSummary ?? callerVaultSummary);
    const currentTimestamp = chainCurrentTimestamp;
    const liquidationAmountValue = tryParseEthAmountInput(liquidationDebtEthAmount);
    const poolOraclePrice = currentPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice;
    const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n;
    const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource);
    const liquidationExecutionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp);
    const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails, currentTimestamp);
    const hasUsableOraclePrice = currentPoolOracleManagerDetails !== undefined && isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp);
    const trimmedLiquidationTargetVault = liquidationTargetVault.trim();
    const trimmedLiquidationReceiverVault = liquidationReceiverVault.trim();
    const liquidationTimeoutDisplayValue = liquidationTimeoutMinutes === '' ? '' : liquidationTimeoutMinutes;
    const liquidationTimeoutSeconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(liquidationTimeoutDisplayValue));
    const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? liquidationCopy.stagedOperationTimeoutHelpText : liquidationCopy.formatTimeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds));
    const sameVaultWarning = trimmedLiquidationReceiverVault === '' || trimmedLiquidationTargetVault === '' || !sameAddress(trimmedLiquidationReceiverVault, trimmedLiquidationTargetVault) ? undefined : liquidationCopy.distinctTargetVaultRequired;
    const approvalRouteMismatch = liquidationApprovalDetails === undefined || accountAddress === undefined || liquidationSecurityPoolAddress === undefined
        ? false
        : !sameAddress(liquidationApprovalDetails.params.securityPool, liquidationSecurityPoolAddress) ||
            !sameAddress(liquidationApprovalDetails.params.receiverVault, trimmedLiquidationReceiverVault) ||
            !sameAddress(liquidationApprovalDetails.params.operator, accountAddress) ||
            (liquidationApprovalDetails.params.targetVault !== '0x0000000000000000000000000000000000000000' && !sameAddress(liquidationApprovalDetails.params.targetVault, trimmedLiquidationTargetVault));
    const approvalLatestExecutionTimestamp = currentTimestamp === undefined || liquidationTimeoutSeconds === undefined || currentPoolOracleManagerDetails?.settlementTime === undefined ? undefined : currentTimestamp + currentPoolOracleManagerDetails.settlementTime + liquidationTimeoutSeconds;
    const approvalNonceInvalidated = liquidationApprovalDetails !== undefined && liquidationApprovalDetails.params.nonce < liquidationApprovalDetails.minimumValidNonce;
    const delegatedApprovalReason = (() => {
        if (!delegatedReceiver)
            return undefined;
        if (liquidationApprovalId === zeroApprovalId)
            return liquidationCopy.delegatedApprovalRequired;
        if (!hasValidApprovalId)
            return liquidationCopy.invalidDelegatedApprovalId;
        if (loadingLiquidationApproval)
            return liquidationCopy.loadingBoundedApproval;
        if (liquidationApprovalError !== undefined)
            return liquidationApprovalError;
        if (liquidationApprovalDetails === undefined)
            return liquidationCopy.boundedApprovalRequiredBeforeSubmission;
        if (approvalRouteMismatch)
            return liquidationCopy.approvalRouteMismatch;
        if (approvalNonceInvalidated)
            return liquidationCopy.approvalNonceInvalidated;
        if (liquidationApprovalDetails.revoked || liquidationApprovalDetails.availableDebtAttoEth === 0n)
            return liquidationCopy.approvalUnavailable;
        if (currentTimestamp !== undefined && currentTimestamp < liquidationApprovalDetails.params.validAfter)
            return liquidationCopy.approvalNotActive;
        if (approvalLatestExecutionTimestamp !== undefined && approvalLatestExecutionTimestamp > liquidationApprovalDetails.params.validUntil)
            return liquidationCopy.approvalExpiresBeforeExecution;
        if (liquidationAmountValue !== undefined && (liquidationAmountValue > liquidationApprovalDetails.availableDebtAttoEth || liquidationAmountValue > liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth))
            return liquidationCopy.approvalQuotaTooLow;
        return undefined;
    })();
    const liquidationSimulation = targetVaultSummary === undefined || poolOraclePrice === undefined || selectedPool?.statoblastSecurityMultiplierBps === undefined || liquidationAmountValue === undefined
        ? undefined
        : simulateLiquidation({
            callerVaultSummary: receiverVaultSummary,
            requestedDebtAttoEth: liquidationAmountValue,
            totalCapacityOwnershipAttoRep: selectedPool.totalCapacityOwnershipAttoRep,
            minimumVaultRepDepositAttoRep: selectedPool.minimumVaultRepDepositAttoRep,
            repPerEthPrice: poolOraclePrice,
            settlementCollateralAttoEth: selectedPool.settlementCollateralAttoEth,
            statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
            targetVaultSummary,
        });
    const computedLiquidationMaxAmount = getMaxLiquidationAmount({
        repPerEthPrice: poolOraclePrice,
        statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
        targetVaultSummary,
    });
    const liquidationMaxActionAmount = hasUsableOraclePrice ? (computedLiquidationMaxAmount ?? maximumLiquidationDebtAttoEth) : maximumLiquidationDebtAttoEth;
    const deterministicLiquidationReason = getDeterministicLiquidationFailureReason({
        callerVaultSummary: receiverVaultSummary,
        requestedDebtAttoEth: liquidationAmountValue,
        totalCapacityOwnershipAttoRep: selectedPool?.totalCapacityOwnershipAttoRep,
        maxLiquidationDebtAttoEth: hasUsableOraclePrice ? computedLiquidationMaxAmount : undefined,
        minimumSecurityBondDebtAttoEth: selectedPool?.minimumSecurityBondDebtAttoEth,
        minimumVaultRepDepositAttoRep: selectedPool?.minimumVaultRepDepositAttoRep,
        repPerEthPrice: hasUsableOraclePrice ? poolOraclePrice : undefined,
        settlementCollateralAttoEth: selectedPool?.settlementCollateralAttoEth,
        statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
        targetVaultSummary,
    });
    const directLiquidationReason = (() => {
        if (liquidationExecutionMode !== 'execute')
            return undefined;
        if (selectedPool?.statoblastSecurityMultiplierBps === undefined)
            return liquidationCopy.selectedPoolReloadRequired;
        return getLiquidationFailureReason({
            callerVaultSummary: receiverVaultSummary,
            requestedDebtAttoEth: liquidationAmountValue,
            totalCapacityOwnershipAttoRep: selectedPool.totalCapacityOwnershipAttoRep,
            minimumReceiverHealthFactorBps: delegatedReceiver ? liquidationApprovalDetails?.params.minPostLiquidationHealthFactorBps : undefined,
            minimumSecurityBondDebtAttoEth: selectedPool.minimumSecurityBondDebtAttoEth,
            minimumVaultRepDepositAttoRep: selectedPool.minimumVaultRepDepositAttoRep,
            repPerEthPrice: poolOraclePrice,
            settlementCollateralAttoEth: selectedPool.settlementCollateralAttoEth,
            statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
            targetVaultSummary,
        });
    })();
    const queueLiquidationEthGuardMessage = liquidationExecutionMode !== 'queue'
        ? undefined
        : (() => {
            return getOracleRequestEthGuardMessage({
                actionLabel: liquidationCopy.queueLiquidationActionLabel,
                requiredCostAttoEth: liquidationFundingPreview?.totalWalletEthRequiredAttoEth,
                walletBalanceAttoEth,
            });
        })();
    const liquidationEnabled = poolState?.actions.queueLiquidation.enabled ?? true;
    const canUseLiquidationAction = accountAddress !== undefined && isOnActiveAppChain;
    const liquidationActionReason = pickFirstReason(liquidationExecutionMode === 'refreshing' ? liquidationCopy.refreshingPriceValidity : undefined, liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? liquidationCopy.liquidationPoolReloadRequired : undefined, trimmedLiquidationTargetVault === '' ? liquidationCopy.targetVaultRequired : undefined, trimmedLiquidationReceiverVault === '' ? liquidationCopy.receiverVaultRequired : undefined, delegatedApprovalReason, delegatedReceiver && loadingLiquidationReceiverVaultSummary ? liquidationCopy.loadingReceiverVault : undefined, delegatedReceiver ? liquidationReceiverVaultSummaryError : undefined, delegatedReceiver && !liquidationReceiverVaultSummaryResolved ? liquidationCopy.receiverVaultRequiredBeforeSubmission : undefined, sameVaultWarning, liquidationDebtEthAmount.trim() === '' ? liquidationCopy.liquidationAmountRequired : undefined, liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? liquidationCopy.liquidationTimeoutMinimumReason : undefined, liquidationExecutionMode === 'queue' && loadingLiquidationFundingPreview ? liquidationCopy.loadingQueueFunding : undefined, liquidationExecutionMode === 'queue' && liquidationFundingPreviewError !== undefined ? liquidationFundingPreviewError : undefined, liquidationExecutionMode === 'queue' && liquidationFundingPreview === undefined ? liquidationCopy.loadingQueueFunding : undefined, deterministicLiquidationReason, directLiquidationReason, queueLiquidationEthGuardMessage);
    const liquidationButtonDisabledReason = (() => {
        if (!isOnActiveAppChain)
            return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
        if (accountAddress === undefined)
            return commonCopy.walletConnectionRequired;
        if (!liquidationEnabled)
            return undefined;
        return liquidationActionReason;
    })();
    const queuedLiquidationOperation = (() => {
        if (securityPoolOverviewResult?.action !== 'queueLiquidation')
            return undefined;
        if (currentPoolOracleManagerDetails?.pendingOperation?.operation === 'liquidation' && currentPoolOracleManagerDetails.pendingOperation.targetVault === liquidationTargetVault) {
            return {
                amount: currentPoolOracleManagerDetails.pendingOperation.amount,
                isPendingSlot: true,
                operationId: currentPoolOracleManagerDetails.pendingOperation.operationId,
            };
        }
        if (securityPoolOverviewResult.queuedOperation?.operation !== 'liquidation')
            return undefined;
        return {
            amount: undefined,
            isPendingSlot: securityPoolOverviewResult.queuedOperation.isPendingSlot,
            operationId: securityPoolOverviewResult.queuedOperation.operationId,
        };
    })();
    const queuedLiquidationStatus = securityPoolOverviewResult?.action !== 'queueLiquidation'
        ? undefined
        : (() => {
            if (securityPoolOverviewResult.stagedExecution !== undefined) {
                if (securityPoolOverviewResult.stagedExecution.success)
                    return 'executed';
                return 'failed';
            }
            if (queuedLiquidationOperation !== undefined)
                return queuedLiquidationOperation.isPendingSlot ? 'queued' : 'manual-queued';
            if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined)
                return 'refreshing';
            return (() => {
                if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp))
                    return 'executed';
                return 'missing';
            })();
        })();
    return (_jsx("div", { className: 'modal-backdrop', role: 'presentation', onClick: closeLiquidationModal, children: _jsxs("section", { ref: dialogRef, className: 'modal-panel', role: 'dialog', "aria-modal": 'true', "aria-labelledby": titleId, onClick: event => event.stopPropagation(), children: [_jsxs("div", { className: 'modal-header', children: [_jsx("div", { className: 'modal-header-title', children: _jsx("h3", { id: titleId, children: getLiquidationModalTitle(currentPoolOracleManagerDetails, currentTimestamp) }) }), _jsx("button", { ref: closeButtonRef, className: 'quiet modal-close-button', type: 'button', "aria-label": commonCopy.close, title: commonCopy.close, onClick: closeLiquidationModal, children: "\u00D7" })] }), renderQueuedLiquidationStatusCard({
                    onViewInStagedOperations: () => onSelectedPoolViewChange('staged-operations'),
                    queuedLiquidationOperation,
                    queuedLiquidationStatus,
                    securityPoolOverviewResult,
                }), _jsx(ErrorNotice, { message: poolOracleManagerError }), poolOracleManagerError === undefined || liquidationManagerAddress === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', disabled: loadingPoolOracleManager, onClick: () => onLoadPoolOracleManager(liquidationManagerAddress), type: 'button', children: liquidationCopy.retryPriceStatus }) })), _jsx(ErrorNotice, { message: securityPoolLiquidationError }), _jsxs(DataGrid, { className: 'modal-summary-grid', columns: 2, children: [_jsx(AddressInfo, { address: liquidationSecurityPoolAddress, label: liquidationCopy.securityPool }), _jsx(MetricField, { label: commonCopy.statoblastSecurityMultiplierBps, children: selectedPool?.statoblastSecurityMultiplierBps === undefined ? commonCopy.unavailable : `${formatStatoblastSecurityMultiplier(selectedPool.statoblastSecurityMultiplierBps)}${liquidationCopy.multiplierSuffix}` }), _jsx(MetricField, { label: liquidationCopy.operator, children: accountAddress === undefined ? commonCopy.connectWallet : _jsx(AddressValue, { address: accountAddress }) }), _jsx(MetricField, { label: liquidationCopy.receiverVault, children: trimmedLiquidationReceiverVault === '' ? commonCopy.noneSelected : _jsx(AddressValue, { address: trimmedLiquidationReceiverVault }) }), _jsx(MetricField, { label: commonCopy.targetVault, children: trimmedLiquidationTargetVault === '' ? commonCopy.noneSelected : _jsx(AddressValue, { address: trimmedLiquidationTargetVault }) }), _jsx(MetricField, { label: commonCopy.openOraclePrice, valueTagName: 'span', children: _jsx(OpenOraclePriceValue, { currentTimestamp: currentTimestamp, lastPrice: poolOraclePrice, lastSettlementTimestamp: poolOracleSettlementTimestamp, priceValidUntilTimestamp: currentPoolOracleManagerDetails?.priceValidUntilTimestamp }) }), _jsx(MetricField, { label: liquidationCopy.targetCapacityOwnershipAttoRep, children: _jsx(CurrencyValue, { value: targetVaultSummary?.capacityOwnershipAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: liquidationCopy.targetVaultRepBackingAttoRep, children: _jsx(CurrencyValue, { value: targetVaultSummary?.vaultAttoRepBacking, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: liquidationCopy.targetDisputeStakedAttoRep, children: _jsx(CurrencyValue, { value: targetVaultSummary?.disputeStakedAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: _jsxs("span", { children: [repPriceSourceCopy.quotedRepPerEthLabel, " ", renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)] }), children: repPerEthPrice === undefined ? commonCopy.unavailable : _jsx(CurrencyValue, { value: repPerEthPrice, suffix: commonCopy.repPerEth, copyable: false }) }), _jsx(MetricField, { label: liquidationCopy.callerCapacityOwnershipAttoRep, children: _jsx(CurrencyValue, { value: receiverVaultSummary?.capacityOwnershipAttoRep, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: liquidationCopy.callerVaultRepBackingAttoRep, children: _jsx(CurrencyValue, { value: receiverVaultSummary?.vaultAttoRepBacking, suffix: commonCopy.rep }) }), _jsx(MetricField, { label: liquidationCopy.callerDisputeStakedAttoRep, children: _jsx(CurrencyValue, { value: receiverVaultSummary?.disputeStakedAttoRep, suffix: commonCopy.rep }) })] }), sameVaultWarning === undefined ? null : (_jsxs(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: [_jsx("div", { className: 'entity-card-header', children: _jsx("div", { children: _jsx("h4", { children: liquidationCopy.invalidLiquidationPair }) }) }), _jsx("p", { className: 'detail', children: sameVaultWarning })] })), delegatedReceiver ? (_jsxs(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: [_jsx("div", { className: 'entity-card-header', children: _jsx("div", { children: _jsx("h4", { children: liquidationCopy.receiverLiabilityTitle }) }) }), _jsx("p", { className: 'detail', children: liquidationCopy.receiverLiabilityDetail })] })) : null, _jsxs("div", { className: 'form-grid', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: liquidationCopy.receiverVault }), _jsx(FormInput, { value: liquidationReceiverVault, onInput: event => onLiquidationReceiverVaultChange(event.currentTarget.value) })] }), delegatedReceiver && loadingLiquidationReceiverVaultSummary ? (_jsx("p", { className: 'detail', id: 'liquidation-receiver-loading-status', role: 'status', children: liquidationCopy.loadingReceiverVault })) : null, delegatedReceiver && liquidationReceiverVaultSummaryError !== undefined ? (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: onLoadLiquidationReceiverVaultSummary, disabled: loadingLiquidationReceiverVaultSummary || !hasValidReceiverVault, children: liquidationCopy.retryReceiverVault }) })) : null, delegatedReceiver ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: liquidationCopy.boundedApprovalId }), _jsx(FormInput, { value: liquidationApprovalId, onInput: event => onLiquidationApprovalIdChange(event.currentTarget.value) }), _jsx("small", { className: 'field-help', children: liquidationCopy.receiverOperatorEconomics })] }), loadingLiquidationApproval ? (_jsx("p", { className: 'detail', role: 'status', children: liquidationCopy.loadingBoundedApproval })) : null, liquidationApprovalError === undefined ? null : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: onLoadLiquidationApproval, disabled: !hasValidApprovalId, children: liquidationCopy.retryBoundedApproval }) }))] })) : null, _jsxs("label", { className: 'field', children: [_jsx("span", { children: liquidationCopy.requestedLiquidationDebtEth }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', value: liquidationDebtEthAmount, onInput: event => onLiquidationAmountChange(event.currentTarget.value), placeholder: commonCopy.zeroDecimalPlaceholder }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => onLiquidationAmountChange(liquidationMaxActionAmount === undefined ? '' : formatCurrencyInputBalance(liquidationMaxActionAmount)), disabled: liquidationMaxActionAmount === undefined || liquidationMaxActionAmount <= 0n, children: commonCopy.max })] })] }), liquidationExecutionMode === 'execute' ? null : (_jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.manualExecutionTimeout }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', inputMode: 'numeric', min: '1', pattern: '[0-9]*', step: '1', value: liquidationTimeoutDisplayValue, onInput: event => onLiquidationTimeoutMinutesChange(event.currentTarget.value) }), _jsx("span", { className: 'field-inline-action', children: commonCopy.minutes })] })] }))] }), delegatedReceiver ? _jsx(ErrorNotice, { message: liquidationReceiverVaultSummaryError }) : null, delegatedReceiver ? _jsx(ErrorNotice, { message: liquidationApprovalError }) : null, !delegatedReceiver || liquidationApprovalDetails === undefined ? null : (_jsxs(DataGrid, { className: 'modal-summary-grid', columns: 2, children: [_jsx(MetricField, { label: liquidationCopy.availableApproval, children: _jsx(CurrencyValue, { value: liquidationApprovalDetails.availableDebtAttoEth, suffix: commonCopy.eth }) }), _jsx(MetricField, { label: liquidationCopy.reservedApproval, children: _jsx(CurrencyValue, { value: liquidationApprovalDetails.reservedDebtAttoEth, suffix: commonCopy.eth }) }), _jsx(MetricField, { label: liquidationCopy.consumedApproval, children: _jsx(CurrencyValue, { value: liquidationApprovalDetails.consumedDebtAttoEth, suffix: commonCopy.eth }) }), _jsx(MetricField, { label: liquidationCopy.perLiquidationLimit, children: _jsx(CurrencyValue, { value: liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth, suffix: commonCopy.eth }) }), _jsx(MetricField, { label: liquidationCopy.totalApprovalLimit, children: _jsx(CurrencyValue, { value: liquidationApprovalDetails.params.maxCumulativeDebtAttoEth, suffix: commonCopy.eth }) }), _jsx(MetricField, { label: liquidationCopy.approvalValidAfter, children: formatTimestamp(liquidationApprovalDetails.params.validAfter) }), _jsx(MetricField, { label: liquidationCopy.approvalExpiration, children: formatTimestamp(liquidationApprovalDetails.params.validUntil) }), _jsx(MetricField, { label: liquidationCopy.minimumPostLiquidationHealth, children: formatHealthFactorBps(liquidationApprovalDetails.params.minPostLiquidationHealthFactorBps) }), _jsx(MetricField, { label: liquidationCopy.approvalStatus, children: getApprovalStatus(liquidationApprovalDetails.revoked, approvalNonceInvalidated, liquidationApprovalDetails.params.validAfter, liquidationApprovalDetails.params.validUntil, currentTimestamp) })] })), liquidationExecutionMode === 'execute' ? null : _jsx("p", { className: 'detail', children: liquidationTimeoutHelpText }), liquidationExecutionMode !== 'queue' || liquidationFundingPreviewError === undefined ? null : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: () => (liquidationManagerAddress === undefined ? undefined : onLoadLiquidationFundingPreview(liquidationManagerAddress)), disabled: loadingLiquidationFundingPreview, children: liquidationCopy.retryQueueFunding }) })), _jsx(TransactionReview, { context: [
                        { label: commonCopy.question, value: selectedPool?.marketDetails.title ?? commonCopy.unavailable },
                        { label: commonCopy.universe, value: _jsx(TransactionUniverseValue, { universeId: selectedPool?.universeId }) },
                    ], primary: [
                        { label: liquidationCopy.securityBondDebtMoved, value: _jsx(CurrencyValue, { value: liquidationSimulation?.debtMovedAttoEth, suffix: commonCopy.eth }) },
                        { label: liquidationCopy.capacityOwnershipMoved, value: _jsx(CurrencyValue, { value: liquidationSimulation?.capacityOwnershipMovedAttoRep, suffix: commonCopy.rep }) },
                        { label: liquidationCopy.residualBadDebt, value: _jsx(CurrencyValue, { value: liquidationSimulation?.badDebtAttoEth, suffix: commonCopy.eth }) },
                        { label: liquidationCopy.grossRepAwardAttoRep, value: _jsx(CurrencyValue, { compactWhenOverflow: true, value: liquidationSimulation?.grossRepAwardAttoRep, suffix: commonCopy.rep }) },
                        { label: liquidationCopy.repMoved, value: _jsx(CurrencyValue, { compactWhenOverflow: true, value: liquidationSimulation?.vaultAttoRepBackingToTransfer, suffix: commonCopy.rep }) },
                        { label: liquidationCopy.targetAccruedFeesRetained, value: _jsx(CurrencyValue, { compactWhenOverflow: true, value: liquidationSimulation?.targetAccruedFeesRetained, suffix: commonCopy.eth }) },
                        ...(liquidationExecutionMode === 'queue' ? [{ label: liquidationCopy.totalWalletEthRequiredAttoEth, value: _jsx(CurrencyValue, { value: liquidationFundingPreview?.totalWalletEthRequiredAttoEth, suffix: commonCopy.eth }) }] : []),
                    ], details: [
                        { label: liquidationCopy.resultingCallerRep, value: _jsx(CurrencyValue, { value: liquidationSimulation?.callerAfter.vaultAttoRepBacking, suffix: commonCopy.rep }) },
                        { label: liquidationCopy.resultingReceiverCapacityOwnership, value: _jsx(CurrencyValue, { value: liquidationSimulation?.callerAfter.capacityOwnershipAttoRep, suffix: commonCopy.rep }) },
                    ], disclosures: liquidationExecutionMode === 'queue'
                        ? [
                            {
                                title: liquidationCopy.fundingDetails,
                                rows: [
                                    { label: liquidationCopy.bufferedQueueCost, value: _jsx(CurrencyValue, { value: liquidationFundingPreview?.queueOperationValueAttoEth, suffix: commonCopy.eth }) },
                                    { label: liquidationCopy.ethWrappedToWeth, value: _jsx(CurrencyValue, { value: liquidationFundingPreview?.wethShortfallAttoEth, suffix: commonCopy.eth }) },
                                    { label: liquidationCopy.repLockedForInitialReport, value: _jsx(CurrencyValue, { value: liquidationFundingPreview?.initialReportRepRequiredAttoRep, suffix: commonCopy.rep }) },
                                    { label: liquidationCopy.wethLockedForInitialReport, value: _jsx(CurrencyValue, { value: liquidationFundingPreview?.initialReportWethRequiredAttoEth, suffix: commonCopy.weth }) },
                                    {
                                        label: liquidationCopy.resultingWalletEth,
                                        value: (_jsx(CurrencyValue, { value: liquidationFundingPreview === undefined || walletBalanceAttoEth === undefined || liquidationFundingPreview.totalWalletEthRequiredAttoEth > walletBalanceAttoEth ? undefined : walletBalanceAttoEth - liquidationFundingPreview.totalWalletEthRequiredAttoEth, suffix: commonCopy.eth })),
                                    },
                                    {
                                        label: liquidationCopy.resultingWalletRep,
                                        value: (_jsx(CurrencyValue, { value: liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportRepRequiredAttoRep > liquidationFundingPreview.currentRepBalanceAttoRep ? undefined : liquidationFundingPreview.currentRepBalanceAttoRep - liquidationFundingPreview.initialReportRepRequiredAttoRep, suffix: commonCopy.rep })),
                                    },
                                    {
                                        label: liquidationCopy.resultingWalletWeth,
                                        value: (_jsx(CurrencyValue, { value: liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportWethRequiredAttoEth > liquidationFundingPreview.currentWethBalanceAttoEth + liquidationFundingPreview.wethShortfallAttoEth
                                                ? undefined
                                                : liquidationFundingPreview.currentWethBalanceAttoEth + liquidationFundingPreview.wethShortfallAttoEth - liquidationFundingPreview.initialReportWethRequiredAttoEth, suffix: commonCopy.weth })),
                                    },
                                ],
                            },
                        ]
                        : [], risks: [liquidationCopy.liquidationStateRisk, ...(liquidationExecutionMode === 'queue' ? [liquidationCopy.queuedLiquidationRisk, liquidationCopy.queuedFundingSequenceRisk] : [])] }), _jsxs("div", { className: 'actions liquidation-modal-actions', children: [_jsx("button", { className: 'secondary', onClick: closeLiquidationModal, children: commonCopy.cancel }), _jsx(TransactionActionButton, { disabledReasonElementId: delegatedReceiver && loadingLiquidationReceiverVaultSummary ? 'liquidation-receiver-loading-status' : undefined, idleLabel: buttonLabels.idle, pendingLabel: buttonLabels.pending, onClick: () => {
                                if (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined)
                                    return;
                                onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress);
                            }, pending: securityPoolOverviewActiveAction === 'queueLiquidation', availability: {
                                disabled: !liquidationEnabled || !canUseLiquidationAction || liquidationActionReason !== undefined,
                                reason: liquidationButtonDisabledReason,
                            }, showDisabledReason: !(delegatedReceiver && loadingLiquidationReceiverVaultSummary) })] })] }) }));
}
//# sourceMappingURL=LiquidationModal.js.map