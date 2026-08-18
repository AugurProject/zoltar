import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js';
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js';
import { TransactionUniverseValue } from '@zoltar/ui-zoltar/features/universes/components/TransactionUniverseValue.js';
import { VaultMetricGrid } from './VaultMetricGrid.js';
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js';
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { formatCurrencyBalance, formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js';
import { balanceShortage } from '@zoltar/ui-core-shared/lib/inputs.js';
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js';
import { tryParseRepAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js';
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { resolveOracleOperationEthFunding } from '@zoltar/ui-zoltar/features/open-oracle/lib/oracleRequestEth.js';
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js';
import { getSecurityPoolVaultReadinessActions } from '../lib/securityPoolReadiness.js';
import { getVaultLauncherVaultOwnerReason, getVaultLauncherWalletReason } from '../lib/securityPoolLabels.js';
import { getTargetHealthFactorGuardMessage, getVaultDepositGuardMessage, getVaultRedeemRepGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js';
import { deriveTokenApprovalRequirement } from '@zoltar/ui-core-shared/lib/tokenApproval.js';
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES, doesSecurityVaultExistOnchain, doesLoadedSecurityVaultMatchSelection, getStagedOperationTimeoutSeconds, getSecurityVaultWithdrawableRepAmount, getSelectedVaultOwner, hasValidSecurityVaultOraclePrice, isOracleManagerPriceUsable, isSecurityVaultDepositBelowMinimum, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper, MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP, } from '../lib/securityVault.js';
export function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, capacityOwnershipAttoRep, securityVaultDetails, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount, variant = 'record' }) {
    const summaryTitle = _jsx("span", { children: securityPoolCopy.vaultSummary });
    const embeddedContent = (_jsx("div", { className: 'security-pool-selected-vault-summary security-pool-browse-vault-list', children: _jsx("div", { className: 'security-pool-browse-vault-row', children: _jsxs("div", { className: `security-pool-browse-vault-row-top security-pool-browse-vault-row-top-compact${securityVaultDetails.badDebtAttoEth > 0n ? ' with-bad-debt' : ''}`, children: [_jsx("div", { className: 'security-pool-browse-vault-row-title', children: _jsx("div", { className: 'security-pool-browse-vault-row-id', children: _jsx("strong", { children: _jsx(AddressValue, { address: securityVaultDetails.vaultAddress }) }) }) }), _jsxs("div", { className: 'security-pool-browse-vault-row-kpi', children: [_jsx("span", { children: securityPoolCopy.currentCapacityOwnershipAttoRep }), _jsx("strong", { children: _jsx(CurrencyValue, { value: capacityOwnershipAttoRep, suffix: commonCopy.rep }) })] }), _jsxs("div", { className: 'security-pool-browse-vault-row-kpi', children: [_jsx("span", { children: commonCopy.poolHeldVaultRepBackingAttoRep }), _jsx("strong", { children: _jsx(CurrencyValue, { value: securityVaultDetails.vaultAttoRepBacking, suffix: commonCopy.rep }) })] }), _jsxs("div", { className: 'security-pool-browse-vault-row-kpi', children: [_jsx("span", { children: commonCopy.disputeStakedAttoRep }), _jsx("strong", { children: _jsx(CurrencyValue, { value: securityVaultDetails.disputeStakedAttoRep, suffix: commonCopy.rep }) })] }), securityVaultDetails.badDebtAttoEth > 0n ? (_jsxs("div", { className: 'security-pool-browse-vault-row-kpi', children: [_jsx("span", { children: securityPoolCopy.badDebt }), _jsx("strong", { children: _jsx(CurrencyValue, { value: securityVaultDetails.badDebtAttoEth, suffix: commonCopy.eth }) })] })) : null] }) }) }));
    const gridContent = (_jsx(VaultMetricGrid, { badDebtAttoEth: securityVaultDetails.badDebtAttoEth, layout: 'grid', disputeStakedAttoRep: securityVaultDetails.disputeStakedAttoRep, vaultAttoRepBacking: securityVaultDetails.vaultAttoRepBacking, repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl, selectedPoolStatoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps, capacityOwnershipAttoRep: capacityOwnershipAttoRep, claimableFeesAttoEth: securityVaultDetails.claimableFeesAttoEth }));
    if (variant === 'embedded')
        return (_jsx(SectionBlock, { density: 'compact', headingLevel: 4, title: summaryTitle, variant: 'embedded', children: embeddedContent }));
    return (_jsx(EntityCard, { badge: _jsx(Badge, { tone: selectedVaultIsOwnedByAccount ? 'ok' : 'muted', children: selectedVaultIsOwnedByAccount ? securityPoolCopy.owned : securityPoolCopy.readOnlyBadgeLabel }), surface: 'flat', title: securityPoolCopy.selectedVault, variant: 'record', children: gridContent }));
}
export function getQueuedVaultOperation({ pendingOperation, selectedVaultOwner, securityVaultResult }) {
    if (pendingOperation !== undefined && sameAddress(pendingOperation.targetVault, selectedVaultOwner)) {
        if (securityVaultResult?.action === 'queueWithdrawRep' && pendingOperation.operation === 'withdrawRep')
            return { amount: pendingOperation.amount, isPendingSlot: true, operationId: pendingOperation.operationId };
    }
    if (securityVaultResult?.queuedOperation === undefined)
        return undefined;
    if (securityVaultResult.action === 'queueWithdrawRep' && securityVaultResult.queuedOperation.operation === 'withdrawRep')
        return { amount: undefined, isPendingSlot: securityVaultResult.queuedOperation.isPendingSlot, operationId: securityVaultResult.queuedOperation.operationId };
    return undefined;
}
function getQueuedVaultOperationStatus({ currentTimestamp, currentPoolOracleManagerDetails, loadingSecurityVault, queuedVaultOperation, securityVaultResult, }) {
    if (securityVaultResult?.action !== 'queueWithdrawRep')
        return undefined;
    if (securityVaultResult.stagedExecution !== undefined)
        return securityVaultResult.stagedExecution.success ? 'executed' : 'failed';
    if (queuedVaultOperation !== undefined)
        return queuedVaultOperation.isPendingSlot ? 'queued' : 'manual-queued';
    if (loadingSecurityVault || currentPoolOracleManagerDetails === undefined)
        return 'refreshing';
    if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp))
        return 'executed';
    return 'missing';
}
function VaultQueuedOperationStatusCard({ amountLabel, amountSuffix, executedTitle, failedTitle, missingTitle, missingDescription, queuedTitle, queuedVaultOperation, manualQueuedDescription, refreshingTitle, refreshingDescription, status, successDescription, errorMessage, onViewStagedOperations, }) {
    if (status === undefined)
        return undefined;
    if (status === 'queued' || status === 'manual-queued')
        return (_jsxs(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: [_jsx("div", { className: 'entity-card-header', children: _jsx("div", { children: _jsx("h4", { children: queuedTitle }) }) }), _jsxs(MetricGrid, { children: [_jsx(MetricField, { label: commonCopy.stagedOperation, children: queuedVaultOperation === undefined ? securityPoolCopy.refreshing : `#${queuedVaultOperation.operationId.toString()}` }), queuedVaultOperation?.amount === undefined ? null : (_jsx(MetricField, { label: amountLabel, children: _jsx(CurrencyValue, { precision: 'exact', value: queuedVaultOperation.amount, suffix: amountSuffix }) }))] }), status === 'manual-queued' ? _jsx("p", { className: 'detail', children: manualQueuedDescription }) : null, onViewStagedOperations === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: onViewStagedOperations, children: commonCopy.viewInStagedOperations }) }))] }));
    if (status === 'failed')
        return (_jsxs("section", { className: 'entity-card compact flat', children: [_jsxs("div", { className: 'entity-card-header', children: [_jsx("div", { children: _jsx("h4", { children: failedTitle }) }), _jsx(Badge, { tone: 'blocked', children: commonCopy.failed })] }), _jsx("p", { className: 'detail', children: errorMessage ?? securityPoolCopy.actionRejectedDetail }), _jsx("p", { className: 'detail', children: commonCopy.stagedOperationRetryDetail })] }));
    if (status === 'executed')
        return (_jsxs("section", { className: 'entity-card compact flat', children: [_jsxs("div", { className: 'entity-card-header', children: [_jsx("div", { children: _jsx("h4", { children: executedTitle }) }), _jsx(Badge, { tone: 'ok', children: commonCopy.executed })] }), _jsx("p", { className: 'detail', children: successDescription })] }));
    if (status === 'missing')
        return (_jsxs(WarningSurface, { as: 'section', surface: 'flat', variant: 'compact', children: [_jsx("div", { className: 'entity-card-header', children: _jsx("div", { children: _jsx("h4", { children: missingTitle }) }) }), _jsx("p", { className: 'detail', children: missingDescription })] }));
    return (_jsxs("section", { className: 'entity-card compact flat', children: [_jsxs("div", { className: 'entity-card-header', children: [_jsx("div", { children: _jsx("h4", { children: refreshingTitle }) }), _jsx(Badge, { tone: 'muted', children: commonCopy.refreshingWithoutEllipsis })] }), _jsx("p", { className: 'detail', children: refreshingDescription })] }));
}
export function SecurityVaultSection({ accountState, compactLayout = false, autoLoadVault = false, extraReadinessActions = [], loadingSecurityVault, modalFirst = false, onApproveRep, onDepositRepToVault, onLoadSecurityVault, onRedeemFees, onRedeemRepFromVault, onSecurityVaultFormChange, oracleManagerDetails, onViewStagedOperations, onWithdrawRep, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultMissing, securityVaultActiveAction, securityVaultRepApproval, walletRepBalanceAttoRep, walletRepBalanceError, walletRepBalanceLoading = false, securityVaultResult, selectedPoolStatoblastSecurityMultiplierBps, selectedMarketTitle, selectedPoolTotalPoolHeldAttoRep, selectedPoolTotalCapacityOwnershipAttoRep, showHeader = true, showLookupSection = true, showSecurityPoolAddressInput = true, showSummarySection = true, poolState, }) {
    const currentTimestamp = useChainTimestamp();
    const [vaultActionModal, setVaultActionModal] = useState(undefined);
    const refreshVaultActionsDescriptionId = useId();
    const vaultLifecycleBlockerId = useId();
    const embeddedTargetHealthFactorDescriptionId = useId();
    const modalTargetHealthFactorDescriptionId = useId();
    const isOnActiveAppChain = isActiveAppChain(accountState?.chainId);
    const normalizedSecurityVaultForm = {
        depositAmount: securityVaultForm.depositAmount ?? '0',
        repWithdrawAmount: securityVaultForm.repWithdrawAmount ?? '0',
        targetHealthFactor: securityVaultForm.targetHealthFactor ?? '0',
        securityPoolAddress: securityVaultForm.securityPoolAddress ?? '',
        selectedVaultOwner: securityVaultForm.selectedVaultOwner ?? '',
        stagedOperationTimeoutMinutes: securityVaultForm.stagedOperationTimeoutMinutes ?? DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES.toString(),
    };
    const selectedVaultOwner = getSelectedVaultOwner(normalizedSecurityVaultForm.selectedVaultOwner, accountState.address);
    const currentSelectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
        accountAddress: accountState.address,
        securityPoolAddress: normalizedSecurityVaultForm.securityPoolAddress,
        securityVaultDetails,
        selectedVaultOwner: normalizedSecurityVaultForm.selectedVaultOwner,
    })
        ? securityVaultDetails
        : undefined;
    const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultOwner, accountState.address);
    const vaultTransactionContext = [
        ...(selectedMarketTitle === undefined ? [] : [{ label: commonCopy.question, value: selectedMarketTitle }]),
        { label: commonCopy.securityPoolAddress, value: _jsx(AddressValue, { address: currentSelectedVaultDetails?.securityPoolAddress ?? normalizedSecurityVaultForm.securityPoolAddress }) },
        ...(currentSelectedVaultDetails?.universeId === undefined ? [] : [{ label: commonCopy.universe, value: _jsx(TransactionUniverseValue, { universeId: currentSelectedVaultDetails.universeId }) }]),
        { label: securityPoolCopy.vault, value: _jsx(AddressValue, { address: selectedVaultOwner === '' ? undefined : selectedVaultOwner }) },
        { label: transactionReviewCopy.network, value: _jsx(TransactionNetworkValue, {}) },
    ];
    const depositAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.depositAmount);
    const withdrawAmount = tryParseRepAmountInput(normalizedSecurityVaultForm.repWithdrawAmount);
    const stagedOperationTimeoutMinutes = tryParseBigIntInput(normalizedSecurityVaultForm.stagedOperationTimeoutMinutes);
    const stagedOperationTimeoutSeconds = getStagedOperationTimeoutSeconds(stagedOperationTimeoutMinutes);
    const capacityOwnershipAttoRep = currentSelectedVaultDetails?.capacityOwnershipAttoRep ?? 0n;
    const vaultExistsOnchain = doesSecurityVaultExistOnchain(currentSelectedVaultDetails);
    const hasValidOraclePrice = hasValidSecurityVaultOraclePrice(currentSelectedVaultDetails?.managerAddress, oracleManagerDetails, currentTimestamp);
    const oraclePriceValidUntilTimestamp = hasValidOraclePrice ? oracleManagerDetails?.priceValidUntilTimestamp : undefined;
    const approvalRequirement = deriveTokenApprovalRequirement(depositAmount, securityVaultRepApproval.value);
    const walletRepShortfallAttoRep = balanceShortage(depositAmount, walletRepBalanceAttoRep);
    const withdrawableRepAmountAttoRep = getSecurityVaultWithdrawableRepAmount({
        disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
        vaultAttoRepBacking: currentSelectedVaultDetails?.vaultAttoRepBacking,
        repPerEthPrice: hasValidOraclePrice ? oracleManagerDetails?.lastPrice : undefined,
        capacityOwnershipAttoRep: currentSelectedVaultDetails?.capacityOwnershipAttoRep,
        statoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps,
        totalPoolHeldAttoRep: selectedPoolTotalPoolHeldAttoRep,
        totalCapacityOwnershipAttoRep: selectedPoolTotalCapacityOwnershipAttoRep,
    });
    const maximumWithdrawableAttoRep = (() => {
        if (currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.disputeStakedAttoRep > 0n)
            return 0n;
        if (hasValidOraclePrice)
            return withdrawableRepAmountAttoRep;
        return currentSelectedVaultDetails?.vaultAttoRepBacking;
    })();
    const minimumVaultRepDepositAttoRep = currentSelectedVaultDetails?.minimumVaultRepDepositAttoRep ?? MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP;
    const isDepositBelowMinimum = isSecurityVaultDepositBelowMinimum(currentSelectedVaultDetails?.vaultAttoRepBacking, depositAmount, minimumVaultRepDepositAttoRep);
    const hasClaimableFees = currentSelectedVaultDetails !== undefined && currentSelectedVaultDetails.claimableFeesAttoEth > 0n;
    const hasSufficientDepositAllowance = selectedVaultIsOwnedByAccount && depositAmount !== undefined && depositAmount > 0n && approvalRequirement.hasSufficientApproval;
    const hasInsufficientRepBalance = walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n;
    const hasPositiveDepositAmount = depositAmount !== undefined && depositAmount > 0n;
    const hasPositiveWithdrawAmount = withdrawAmount !== undefined && withdrawAmount > 0n;
    const redeemableRepAmountAttoRep = currentSelectedVaultDetails?.vaultAttoRepBacking;
    const hasWithdrawableRep = maximumWithdrawableAttoRep !== undefined && maximumWithdrawableAttoRep > 0n;
    const depositRepToVaultEnabled = poolState?.actions.depositRepToVault.enabled ?? true;
    const queueWithdrawRepEnabled = poolState?.actions.queueWithdrawRep.enabled ?? true;
    const redeemRepFromVaultEnabled = poolState?.actions.redeemRepFromVault.enabled === true;
    const approveRepEnabled = poolState?.actions.approveRep.enabled ?? true;
    const claimFeesEnabled = poolState?.actions.redeemFees.enabled ?? true;
    const vaultLifecycleBlocker = (() => {
        if (poolState?.lifecycleState === 'ended')
            return securityPoolCopy.vaultActionsEndedDetail;
        if (poolState?.lifecycleState === 'poolForked' || poolState?.lifecycleState === 'forkMigration')
            return securityPoolCopy.vaultActionsForkMigrationDetail;
        if (poolState?.lifecycleState === 'forkTruthAuction')
            return securityPoolCopy.vaultActionsTruthAuctionDetail;
        return undefined;
    })();
    const poolCollateralActionsEnabled = depositRepToVaultEnabled;
    const effectiveRepExitMode = redeemRepFromVaultEnabled ? 'redeem' : 'withdraw';
    const repExitEnabled = effectiveRepExitMode === 'redeem' ? redeemRepFromVaultEnabled : queueWithdrawRepEnabled;
    const repExitActionLabel = effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemRepFromVault : securityPoolCopy.withdrawRep;
    const repExitAmountLabel = (() => {
        if (effectiveRepExitMode === 'redeem')
            return securityPoolCopy.redeemableAttoRep;
        if (hasValidOraclePrice)
            return securityPoolCopy.withdrawableAttoRep;
        return securityPoolCopy.repAvailableToQueue;
    })();
    const depositGuardMessage = getVaultDepositGuardMessage({
        approvalSatisfied: hasSufficientDepositAllowance,
        depositAmount,
        isDepositBelowMinimum,
        minimumVaultRepDepositAttoRep,
        targetHealthFactor: normalizedSecurityVaultForm.targetHealthFactor,
        walletRepShortfallAttoRep: hasInsufficientRepBalance ? walletRepShortfallAttoRep : undefined,
    });
    const targetHealthFactorGuardMessage = hasPositiveDepositAmount ? getTargetHealthFactorGuardMessage(normalizedSecurityVaultForm.targetHealthFactor) : undefined;
    const depositActionGuardMessage = targetHealthFactorGuardMessage === undefined ? depositGuardMessage : undefined;
    const withdrawRepFunding = resolveOracleOperationEthFunding({
        managerDetails: oracleManagerDetails,
        priceUsable: hasValidOraclePrice,
    });
    const withdrawRepGuardMessage = getVaultWithdrawGuardMessage({
        bufferRequiredEthCost: withdrawRepFunding?.includeBuffer === true,
        disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
        requiredCostAttoEth: withdrawRepFunding?.costAttoEth,
        stagedOperationTimeoutMinutes,
        withdrawAmount,
        withdrawableRepAmountAttoRep: maximumWithdrawableAttoRep,
        walletBalanceAttoEth: accountState.ethBalanceAttoEth,
    });
    const redeemRepFromVaultGuardMessage = getVaultRedeemRepGuardMessage({
        disputeStakedAttoRep: currentSelectedVaultDetails?.disputeStakedAttoRep,
        redeemableRepAmountAttoRep,
    });
    const repExitGuardMessage = effectiveRepExitMode === 'redeem' ? redeemRepFromVaultGuardMessage : withdrawRepGuardMessage;
    const hasConnectedWallet = accountState.address !== undefined;
    const canUseOwnedVaultActions = selectedVaultIsOwnedByAccount && hasConnectedWallet;
    const hasLoadedSelectedVaultDetails = currentSelectedVaultDetails !== undefined;
    const canUseLoadedVaultActions = canUseOwnedVaultActions && hasLoadedSelectedVaultDetails && isOnActiveAppChain;
    const showMissingVaultNotice = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain;
    const autoLoadKey = `${normalizeAddress(selectedVaultOwner) ?? ''}:${normalizeAddress(normalizedSecurityVaultForm.securityPoolAddress) ?? ''}`;
    const hasLoadedCurrentVault = currentSelectedVaultDetails !== undefined && sameAddress(currentSelectedVaultDetails.vaultAddress, selectedVaultOwner) && sameAddress(currentSelectedVaultDetails.securityPoolAddress, normalizedSecurityVaultForm.securityPoolAddress);
    const lastAutoLoadKey = useRef(undefined);
    const queuedVaultOperation = getQueuedVaultOperation({
        pendingOperation: oracleManagerDetails?.pendingOperation,
        selectedVaultOwner: selectedVaultOwner ?? '',
        securityVaultResult,
    });
    const queuedVaultOperationStatus = getQueuedVaultOperationStatus({
        currentTimestamp,
        currentPoolOracleManagerDetails: oracleManagerDetails,
        loadingSecurityVault,
        queuedVaultOperation,
        securityVaultResult,
    });
    const stagedOperationTimeoutHelpText = stagedOperationTimeoutSeconds === undefined ? securityPoolCopy.selfServiceExecutionTimeoutHelpText : securityPoolCopy.formatManualExecutionTimeoutResolvedDetail(formatDuration(stagedOperationTimeoutSeconds));
    const renderStagedOperationTimeoutField = () => (_jsxs(_Fragment, { children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.manualExecutionTimeout }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', inputMode: 'numeric', min: '1', pattern: '[0-9]*', step: '1', value: normalizedSecurityVaultForm.stagedOperationTimeoutMinutes, onInput: event => onSecurityVaultFormChange({ stagedOperationTimeoutMinutes: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled }), _jsx("span", { className: 'field-inline-action', children: commonCopy.minutes })] })] }), _jsx("p", { className: 'detail', children: stagedOperationTimeoutHelpText })] }));
    const vaultLoadNotice = (() => {
        if (loadingSecurityVault)
            return (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: securityPoolCopy.loadingVault }) }));
        if (securityVaultMissing)
            return _jsx(StateHint, { presentation: { key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: securityPoolCopy.invalidVaultAddressHint } });
        return undefined;
    })();
    const loadedVaultMissingBlocker = currentSelectedVaultDetails !== undefined && !vaultExistsOnchain ? securityPoolCopy.missingVaultDetail : undefined;
    const getVaultLauncherBlocker = (action) => {
        const walletGuardState = getWalletActiveAppChainGuardState({
            accountAddress: accountState.address,
            isOnActiveAppChain,
            walletRequiredReason: getVaultLauncherWalletReason(action, effectiveRepExitMode),
        });
        if (walletGuardState.blocked)
            return walletGuardState.reason;
        if (!selectedVaultIsOwnedByAccount)
            return getVaultLauncherVaultOwnerReason(action, effectiveRepExitMode);
        if (!hasLoadedSelectedVaultDetails)
            return securityPoolCopy.refreshVaultActionsDetail;
        if (action === 'deposit-rep') {
            if (!vaultExistsOnchain && walletRepBalanceAttoRep !== undefined && walletRepBalanceAttoRep <= 0n)
                return securityPoolCopy.missingVaultRepBalanceReason;
            return undefined;
        }
        return loadedVaultMissingBlocker;
    };
    const depositLauncherBlocker = getVaultLauncherBlocker('deposit-rep');
    const repExitLauncherBlocker = getVaultLauncherBlocker('rep-exit');
    const claimFeesLauncherBlocker = getVaultLauncherBlocker('claim-fees');
    const showSharedRefreshVaultBlocker = vaultLifecycleBlocker === undefined && hasConnectedWallet && selectedVaultIsOwnedByAccount && !hasLoadedSelectedVaultDetails && isOnActiveAppChain;
    const getVaultActionDisabledReasonId = (lifecycleActionEnabled) => {
        if (vaultLifecycleBlocker !== undefined && !lifecycleActionEnabled)
            return vaultLifecycleBlockerId;
        if (showSharedRefreshVaultBlocker)
            return refreshVaultActionsDescriptionId;
        return undefined;
    };
    const depositDisabledReasonId = getVaultActionDisabledReasonId(depositRepToVaultEnabled);
    const repExitDisabledReasonId = getVaultActionDisabledReasonId(repExitEnabled);
    const claimFeesDisabledReasonId = getVaultActionDisabledReasonId(claimFeesEnabled);
    const visibleDepositLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : depositLauncherBlocker;
    const visibleRepExitLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : repExitLauncherBlocker;
    const visibleClaimFeesLauncherBlocker = showSharedRefreshVaultBlocker ? undefined : claimFeesLauncherBlocker;
    const claimFeesAvailabilityBlocker = visibleClaimFeesLauncherBlocker ?? (hasLoadedSelectedVaultDetails && claimFeesEnabled && !hasClaimableFees ? securityPoolCopy.noClaimableFeesReason : undefined);
    useEffect(() => {
        if (!autoLoadVault)
            return;
        if (normalizedSecurityVaultForm.securityPoolAddress.trim() === '')
            return;
        if (selectedVaultOwner === undefined || selectedVaultOwner === '')
            return;
        if (hasLoadedCurrentVault || loadingSecurityVault)
            return;
        if (lastAutoLoadKey.current === autoLoadKey)
            return;
        lastAutoLoadKey.current = autoLoadKey;
        void onLoadSecurityVault();
    }, [autoLoadKey, autoLoadVault, hasLoadedCurrentVault, loadingSecurityVault, normalizedSecurityVaultForm.securityPoolAddress, onLoadSecurityVault, selectedVaultOwner]);
    const vaultReadinessActions = getSecurityPoolVaultReadinessActions([
        {
            actionLabel: securityPoolCopy.depositRepToVault,
            description: securityPoolCopy.depositRepToVaultDescription,
            key: 'deposit-rep',
            ...(depositRepToVaultEnabled && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('deposit-rep') } : {}),
            readiness: depositRepToVaultEnabled && canUseLoadedVaultActions ? 'ready' : 'blocked',
            ...(depositDisabledReasonId === undefined ? {} : { disabledReasonId: depositDisabledReasonId }),
            ...(visibleDepositLauncherBlocker === undefined || !depositRepToVaultEnabled ? {} : { blocker: visibleDepositLauncherBlocker }),
            title: securityPoolCopy.depositRepToVault,
        },
        {
            actionLabel: repExitActionLabel,
            description: effectiveRepExitMode === 'redeem' ? securityPoolCopy.repRedemptionDescription : securityPoolCopy.repWithdrawalDescription,
            key: 'rep-exit',
            ...(repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('withdraw-rep') } : {}),
            readiness: repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
            ...(repExitDisabledReasonId === undefined ? {} : { disabledReasonId: repExitDisabledReasonId }),
            ...(visibleRepExitLauncherBlocker === undefined || !repExitEnabled ? {} : { blocker: visibleRepExitLauncherBlocker }),
            title: repExitActionLabel,
        },
        {
            actionLabel: securityPoolCopy.claimFees,
            description: securityPoolCopy.claimFeesDescription,
            key: 'claim-fees',
            ...(claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? { onAction: () => setVaultActionModal('claim-fees') } : {}),
            readiness: claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions ? 'ready' : 'blocked',
            ...(claimFeesDisabledReasonId === undefined ? {} : { disabledReasonId: claimFeesDisabledReasonId }),
            ...(claimFeesAvailabilityBlocker === undefined ? {} : { blocker: claimFeesAvailabilityBlocker }),
            title: securityPoolCopy.claimFeesTitle,
        },
        ...extraReadinessActions,
    ]);
    const actionSections = modalFirst ? (_jsxs(_Fragment, { children: [_jsxs(SectionBlock, { title: securityPoolCopy.vaultActions, variant: 'plain', children: [showMissingVaultNotice ? _jsx(StateHint, { presentation: { key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail } }) : undefined, vaultLifecycleBlocker === undefined ? undefined : (_jsx("p", { className: 'notice warning', id: vaultLifecycleBlockerId, children: vaultLifecycleBlocker })), showSharedRefreshVaultBlocker ? (_jsx("p", { className: 'detail', id: refreshVaultActionsDescriptionId, children: securityPoolCopy.refreshVaultActionsDetail })) : undefined, _jsx("div", { className: 'vault-action-launcher-grid', children: vaultReadinessActions.map(action => (_jsx(ActionLauncherCard, { action: action }, action.key))) })] }), _jsx(ErrorNotice, { message: securityVaultError }), _jsx(ErrorNotice, { message: vaultActionModal === 'deposit-rep' ? undefined : walletRepBalanceError }), _jsxs(OperationModal, { closeOnSuccessKey: securityVaultResult?.action === 'depositRepToVault' ? securityVaultResult.hash : undefined, context: vaultTransactionContext, isOpen: vaultActionModal === 'deposit-rep', onClose: () => setVaultActionModal(undefined), title: securityPoolCopy.depositRepToVault, children: [currentSelectedVaultDetails === undefined ? _jsx("p", { className: 'detail', children: securityPoolCopy.selectedVaultDetailsUnavailable }) : null, currentSelectedVaultDetails === undefined ? null : (_jsxs(_Fragment, { children: [vaultExistsOnchain ? (_jsx(SelectedVaultSummarySection, { repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl, capacityOwnershipAttoRep: currentSelectedVaultDetails.capacityOwnershipAttoRep, securityVaultDetails: currentSelectedVaultDetails, selectedPoolStatoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount: selectedVaultIsOwnedByAccount, variant: 'embedded' })) : (_jsx(StateHint, { presentation: { key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail } })), _jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.repBackingLabel }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', value: normalizedSecurityVaultForm.depositAmount, onInput: event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => {
                                                    if (walletRepBalanceAttoRep === undefined)
                                                        return;
                                                    onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(walletRepBalanceAttoRep) });
                                                }, disabled: walletRepBalanceAttoRep === undefined || !poolCollateralActionsEnabled, children: commonCopy.max })] })] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.targetHealthFactor }), _jsx(FormInput, { "aria-describedby": embeddedTargetHealthFactorDescriptionId, value: normalizedSecurityVaultForm.targetHealthFactor, onInput: event => onSecurityVaultFormChange({ targetHealthFactor: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled, invalid: targetHealthFactorGuardMessage !== undefined }), _jsx("small", { className: 'field-help', id: embeddedTargetHealthFactorDescriptionId, children: targetHealthFactorGuardMessage ?? securityPoolCopy.targetHealthFactorHelp })] }), _jsx(MetricGrid, { children: _jsx(MetricField, { label: securityPoolCopy.walletRep, children: walletRepBalanceLoading ? _jsx(LoadingText, { children: commonCopy.loading }) : _jsx(CurrencyValue, { value: walletRepBalanceAttoRep, suffix: commonCopy.rep }) }) }), _jsx(ErrorNotice, { message: walletRepBalanceError }), _jsx(TokenApprovalControl, { actionLabel: securityPoolCopy.depositingRep, allowanceError: securityVaultRepApproval.error, allowanceLoading: securityVaultRepApproval.loading, approvedAmount: securityVaultRepApproval.value, guardMessage: undefined, onApprove: amount => onApproveRep(amount), pending: securityVaultActiveAction === 'approveRep', pendingLabel: commonCopy.approvingRep, requiredAmount: depositAmount, resetKey: `${currentSelectedVaultDetails.repToken}:${currentSelectedVaultDetails.securityPoolAddress}:${depositAmount?.toString() ?? ''}`, tokenSymbol: 'REP', tokenUnits: 18, disabled: !approveRepEnabled || !canUseLoadedVaultActions }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', type: 'button', onClick: () => setVaultActionModal(undefined), children: commonCopy.cancel }), _jsx(TransactionActionButton, { idleLabel: securityPoolCopy.depositRepToVault, pendingLabel: securityPoolCopy.depositRepToVaultPendingLabel, onClick: onDepositRepToVault, pending: securityVaultActiveAction === 'depositRepToVault', availability: { disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositActionGuardMessage : undefined } })] })] }))] }), _jsxs(OperationModal, { context: vaultTransactionContext, isOpen: vaultActionModal === 'withdraw-rep', onClose: () => setVaultActionModal(undefined), title: repExitActionLabel, children: [currentSelectedVaultDetails === undefined ? _jsx("p", { className: 'detail', children: securityPoolCopy.selectedVaultDetailsUnavailable }) : null, currentSelectedVaultDetails === undefined ? null : (_jsxs(_Fragment, { children: [effectiveRepExitMode === 'redeem' ? null : (_jsx(VaultQueuedOperationStatusCard, { amountLabel: securityPoolCopy.repWithdrawal, amountSuffix: commonCopy.rep, errorMessage: securityVaultResult?.stagedExecution?.errorMessage ?? securityPoolCopy.immediateWithdrawalRejectedDetail, executedTitle: securityPoolCopy.repWithdrawalExecuted, failedTitle: securityPoolCopy.repWithdrawalFailed, manualQueuedDescription: commonCopy.manualQueuedOperationDetail, missingDescription: commonCopy.transactionStateUnavailableDetail, missingTitle: securityPoolCopy.repWithdrawalSubmitted, onViewStagedOperations: onViewStagedOperations, queuedTitle: securityPoolCopy.repWithdrawalQueued, queuedVaultOperation: queuedVaultOperation, refreshingDescription: securityPoolCopy.refreshingWithdrawalStatusDetail, refreshingTitle: securityPoolCopy.refreshingWithdrawalState, status: securityVaultResult?.action === 'queueWithdrawRep' ? queuedVaultOperationStatus : undefined, successDescription: securityPoolCopy.immediateWithdrawalSuccessDetail })), _jsx(SelectedVaultSummarySection, { repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl, capacityOwnershipAttoRep: currentSelectedVaultDetails.capacityOwnershipAttoRep, securityVaultDetails: currentSelectedVaultDetails, selectedPoolStatoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount: selectedVaultIsOwnedByAccount, variant: 'embedded' }), _jsxs(MetricGrid, { children: [_jsx(MetricField, { label: repExitAmountLabel, children: (() => {
                                            if (effectiveRepExitMode === 'redeem') {
                                                if (redeemableRepAmountAttoRep === undefined)
                                                    return '—';
                                                return _jsx(CurrencyValue, { value: redeemableRepAmountAttoRep, suffix: commonCopy.rep });
                                            }
                                            if (maximumWithdrawableAttoRep === undefined)
                                                return '—';
                                            return _jsx(CurrencyValue, { value: maximumWithdrawableAttoRep, suffix: commonCopy.rep });
                                        })() }), effectiveRepExitMode === 'redeem' ? (_jsx(MetricField, { label: commonCopy.disputeStakedAttoRep, children: _jsx(CurrencyValue, { value: currentSelectedVaultDetails.disputeStakedAttoRep, suffix: commonCopy.rep }) })) : (_jsx(MetricField, { label: securityPoolCopy.priceValidUntil, children: oraclePriceValidUntilTimestamp === undefined ? commonCopy.unavailable : _jsx(TimestampValue, { timestamp: oraclePriceValidUntilTimestamp }) }))] }), effectiveRepExitMode === 'redeem' ? null : (_jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.repWithdrawAmount }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', value: normalizedSecurityVaultForm.repWithdrawAmount, onInput: event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => {
                                                    if (maximumWithdrawableAttoRep === undefined)
                                                        return;
                                                    onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(maximumWithdrawableAttoRep) });
                                                }, disabled: maximumWithdrawableAttoRep === undefined || !poolCollateralActionsEnabled, children: commonCopy.max })] })] })), effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField(), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', type: 'button', onClick: () => setVaultActionModal(undefined), children: commonCopy.cancel }), _jsx(TransactionActionButton, { idleLabel: repExitActionLabel, pendingLabel: effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.withdrawingRep, onClick: effectiveRepExitMode === 'redeem' ? onRedeemRepFromVault : onWithdrawRep, pending: effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRepFromVault' : securityVaultActiveAction === 'queueWithdrawRep', tone: 'secondary', availability: {
                                            disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
                                            reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
                                        } })] })] }))] }), _jsxs(OperationModal, { context: vaultTransactionContext, isOpen: vaultActionModal === 'claim-fees', onClose: () => setVaultActionModal(undefined), title: securityPoolCopy.claimFeesTitle, children: [_jsxs(MetricGrid, { children: [_jsx(MetricField, { label: securityPoolCopy.claimableFees, children: currentSelectedVaultDetails === undefined ? commonCopy.metricUnavailablePlaceholder : _jsx(CurrencyValue, { value: currentSelectedVaultDetails.claimableFeesAttoEth, suffix: commonCopy.eth }) }), _jsx(MetricField, { label: securityPoolCopy.vault, children: selectedVaultOwner === undefined ? commonCopy.noneSelected : _jsx(AddressValue, { address: selectedVaultOwner }) })] }), _jsxs("div", { className: 'actions', children: [_jsx("button", { className: 'secondary', type: 'button', onClick: () => setVaultActionModal(undefined), children: commonCopy.cancel }), _jsx(TransactionActionButton, { idleLabel: securityPoolCopy.claimFees, pendingLabel: securityPoolCopy.claimingFees, onClick: onRedeemFees, pending: securityVaultActiveAction === 'redeemFees', availability: { disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: canUseLoadedVaultActions && !hasClaimableFees ? securityPoolCopy.noClaimableFeesReason : claimFeesLauncherBlocker } })] })] })] })) : (_jsxs(_Fragment, { children: [_jsxs(SectionBlock, { title: securityPoolCopy.claimFeesTitle, variant: 'embedded', children: [currentSelectedVaultDetails === undefined ? (_jsx("p", { className: 'detail', children: securityPoolCopy.selectedVaultDetailsUnavailable })) : (_jsx("div", { className: 'entity-metric-grid', children: _jsx(MetricField, { className: 'entity-metric', label: securityPoolCopy.claimableFees, children: _jsx(CurrencyValue, { value: currentSelectedVaultDetails.claimableFeesAttoEth, suffix: commonCopy.eth }) }) })), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: securityPoolCopy.claimFees, pendingLabel: securityPoolCopy.claimingFees, onClick: onRedeemFees, pending: securityVaultActiveAction === 'redeemFees', availability: { disabled: !claimFeesEnabled || !canUseLoadedVaultActions || !hasClaimableFees, reason: undefined } }) })] }), _jsxs(SectionBlock, { title: securityPoolCopy.depositRepToVault, variant: 'embedded', children: [_jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.repBackingLabel }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', value: normalizedSecurityVaultForm.depositAmount, onInput: event => onSecurityVaultFormChange({ depositAmount: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => {
                                            if (walletRepBalanceAttoRep === undefined)
                                                return;
                                            onSecurityVaultFormChange({ depositAmount: formatCurrencyInputBalance(walletRepBalanceAttoRep) });
                                        }, disabled: walletRepBalanceAttoRep === undefined || !poolCollateralActionsEnabled, children: commonCopy.max })] })] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.targetHealthFactor }), _jsx(FormInput, { "aria-describedby": modalTargetHealthFactorDescriptionId, value: normalizedSecurityVaultForm.targetHealthFactor, onInput: event => onSecurityVaultFormChange({ targetHealthFactor: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled, invalid: targetHealthFactorGuardMessage !== undefined }), _jsx("small", { className: 'field-help', id: modalTargetHealthFactorDescriptionId, children: targetHealthFactorGuardMessage ?? securityPoolCopy.targetHealthFactorHelp })] }), _jsx(TokenApprovalControl, { actionLabel: securityPoolCopy.depositingRep, allowanceError: securityVaultRepApproval.error, allowanceLoading: securityVaultRepApproval.loading, approvedAmount: securityVaultRepApproval.value, guardMessage: undefined, onApprove: amount => onApproveRep(amount), pending: securityVaultActiveAction === 'approveRep', pendingLabel: commonCopy.approvingRep, requiredAmount: depositAmount, resetKey: `${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`, tokenSymbol: 'REP', tokenUnits: 18, disabled: !approveRepEnabled || !canUseLoadedVaultActions }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: securityPoolCopy.depositRepToVault, pendingLabel: securityPoolCopy.depositRepToVaultPendingLabel, onClick: onDepositRepToVault, pending: securityVaultActiveAction === 'depositRepToVault', availability: { disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositActionGuardMessage : undefined } }) }), (() => {
                        if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n)
                            return _jsx(ErrorNotice, { message: securityPoolCopy.formatInsufficientRepBalanceDetail(formatCurrencyBalance(walletRepShortfallAttoRep)) });
                        if (isDepositBelowMinimum)
                            return (_jsxs("p", { className: 'detail', children: [securityPoolCopy.newVaultsRequireAtLeast, " ", _jsx(CurrencyValue, { value: minimumVaultRepDepositAttoRep, suffix: commonCopy.rep, copyable: false }), " ", securityPoolCopy.firstDepositTail] }));
                        return undefined;
                    })()] }), _jsxs(SectionBlock, { title: repExitActionLabel, variant: 'embedded', children: [(effectiveRepExitMode === 'redeem' ? redeemableRepAmountAttoRep : maximumWithdrawableAttoRep) === undefined ? (_jsx("p", { className: 'detail', children: securityPoolCopy.selectedVaultDetailsUnavailable })) : (_jsxs("div", { className: 'entity-metric-grid', children: [_jsx(MetricField, { className: 'entity-metric', label: repExitAmountLabel, children: _jsx(CurrencyValue, { value: effectiveRepExitMode === 'redeem' ? redeemableRepAmountAttoRep : maximumWithdrawableAttoRep, suffix: commonCopy.rep }) }), (() => {
                                if (effectiveRepExitMode === 'redeem')
                                    return (_jsx(MetricField, { className: 'entity-metric', label: commonCopy.disputeStakedAttoRep, children: _jsx(CurrencyValue, { value: currentSelectedVaultDetails?.disputeStakedAttoRep, suffix: commonCopy.rep }) }));
                                if (oraclePriceValidUntilTimestamp === undefined)
                                    return undefined;
                                return (_jsx(MetricField, { className: 'entity-metric', label: securityPoolCopy.priceValidUntil, children: _jsx(TimestampValue, { timestamp: oraclePriceValidUntilTimestamp }) }));
                            })()] })), effectiveRepExitMode === 'redeem' ? null : (_jsxs("label", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.repWithdrawAmount }), _jsxs("div", { className: 'field-inline', children: [_jsx(FormInput, { className: 'field-inline-input', value: normalizedSecurityVaultForm.repWithdrawAmount, onInput: event => onSecurityVaultFormChange({ repWithdrawAmount: event.currentTarget.value }), disabled: !poolCollateralActionsEnabled }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => {
                                            if (maximumWithdrawableAttoRep === undefined)
                                                return;
                                            onSecurityVaultFormChange({ repWithdrawAmount: formatCurrencyInputBalance(maximumWithdrawableAttoRep) });
                                        }, disabled: maximumWithdrawableAttoRep === undefined || !poolCollateralActionsEnabled, children: commonCopy.max })] })] })), effectiveRepExitMode === 'redeem' ? null : renderStagedOperationTimeoutField(), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: repExitActionLabel, pendingLabel: effectiveRepExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.withdrawingRep, onClick: effectiveRepExitMode === 'redeem' ? onRedeemRepFromVault : onWithdrawRep, pending: effectiveRepExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRepFromVault' : securityVaultActiveAction === 'queueWithdrawRep', tone: 'secondary', availability: {
                                disabled: !repExitEnabled || !canUseLoadedVaultActions || (effectiveRepExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
                                reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
                            } }) }), effectiveRepExitMode === 'redeem' && currentSelectedVaultDetails?.disputeStakedAttoRep !== undefined && currentSelectedVaultDetails.disputeStakedAttoRep > 0n ? _jsx("p", { className: 'detail', children: securityPoolCopy.escalationWithdrawalRequiredDetail }) : undefined] }), _jsx(ErrorNotice, { message: securityVaultError }), _jsx(ErrorNotice, { message: walletRepBalanceError })] }));
    const sections = (_jsxs(_Fragment, { children: [showLookupSection ? (_jsxs(SectionBlock, { title: securityPoolCopy.vaultLookup, variant: 'embedded', children: [vaultLoadNotice, _jsx(LookupFieldRow, { label: securityPoolCopy.selectedVaultOwner, value: normalizedSecurityVaultForm.selectedVaultOwner, onInput: selectedVaultOwnerInput => onSecurityVaultFormChange({ selectedVaultOwner: selectedVaultOwnerInput }), placeholder: commonCopy.hexValuePlaceholder, action: _jsx("button", { className: 'secondary', onClick: () => onLoadSecurityVault(), disabled: loadingSecurityVault, children: loadingSecurityVault ? _jsx(LoadingText, { children: securityPoolCopy.refreshing }) : commonCopy.refresh }) }), showSecurityPoolAddressInput ? (_jsxs("label", { className: 'field', children: [_jsx("span", { children: commonCopy.securityPoolAddress }), _jsx(FormInput, { value: normalizedSecurityVaultForm.securityPoolAddress, onInput: event => onSecurityVaultFormChange({ securityPoolAddress: event.currentTarget.value }), placeholder: commonCopy.hexValuePlaceholder })] })) : undefined] })) : undefined, showSummarySection && currentSelectedVaultDetails !== undefined && vaultExistsOnchain ? (_jsx(SelectedVaultSummarySection, { repPerEthPrice: repPerEthPrice, repPerEthSource: repPerEthSource, repPerEthSourceUrl: repPerEthSourceUrl, capacityOwnershipAttoRep: capacityOwnershipAttoRep, securityVaultDetails: currentSelectedVaultDetails, selectedPoolStatoblastSecurityMultiplierBps: selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount: selectedVaultIsOwnedByAccount })) : undefined, actionSections] }));
    if (compactLayout)
        return sections;
    return (_jsx(RouteWorkflowPanel, { showHeader: showHeader, title: securityPoolCopy.securityVault, children: sections }));
}
//# sourceMappingURL=SecurityVaultSection.js.map