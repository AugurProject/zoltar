import { jsx as _jsx } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transaction.js';
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { IdentifierValue } from '@zoltar/ui-core-shared/components/IdentifierValue.js';
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js';
import { getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js';
import { buildIntent, buildPresentation, withWarning } from '@zoltar/ui-core-shared/lib/transactionPresentations.js';
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL } from './truth-auctions/lib/forkAuction.js';
import { formatStatoblastSecurityMultiplier } from './markets/lib/trading.js';
function humanizeAction(action) {
    return action
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, value => value.toUpperCase())
        .replaceAll(/\bRep\b/g, commonCopy.rep)
        .replaceAll(/\bEth\b/g, commonCopy.eth)
        .replaceAll(/\bWeth\b/g, commonCopy.weth);
}
function getPoolUniverseTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ identityKey: 'security-pool', label: transactionCopy.pool, value: _jsx(AddressValue, { address: context.securityPoolAddress }) }]),
        ...(context.universeId === undefined ? [] : [{ identityKey: 'universe', label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: context.universeId }) }]),
    ];
}
function getSecurityPoolCreationTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.initialReportPriorityFeeGwei === undefined || context.initialReportPriorityFeeGwei.trim() === '' ? [] : [{ label: commonCopy.initialReportPriorityFee, value: `${context.initialReportPriorityFeeGwei.trim()} gwei` }]),
        ...(context.questionId === undefined || context.questionId.trim() === '' ? [] : [{ label: commonCopy.questionId, value: _jsx(IdentifierValue, { value: context.questionId.trim() }) }]),
        ...(context.statoblastSecurityMultiplierBps === undefined ? [] : [{ label: commonCopy.statoblastSecurityMultiplierBps, value: `${formatStatoblastSecurityMultiplier(context.statoblastSecurityMultiplierBps)}x` }]),
    ];
}
export function createSecurityPoolCreationTransactionIntent(context) {
    return buildIntent({
        action: 'createSecurityPool',
        rows: getSecurityPoolCreationTransactionRows(context),
        source: 'security-pools',
        submittedTitle: transactionCopy.creatingSecurityPool,
    });
}
export function createSecurityPoolCreationSuccessPresentation(result) {
    return buildPresentation({
        detail: transactionCopy.securityPoolCreatedDetail,
        hash: result.deployPoolHash,
        rows: [
            { label: transactionCopy.pool, value: _jsx(AddressValue, { address: result.securityPoolAddress }) },
            { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
            { label: commonCopy.questionId, value: _jsx(IdentifierValue, { value: result.questionId }) },
            { label: commonCopy.statoblastSecurityMultiplierBps, value: `${formatStatoblastSecurityMultiplier(result.statoblastSecurityMultiplierBps)}x` },
            { label: commonCopy.initialReportPriorityFee, value: `${formatCurrencyBalance(result.initialReportPriorityFeeAttoEthPerGas, 9)} gwei` },
        ],
        title: transactionCopy.securityPoolCreated,
        tone: 'success',
    });
}
export function createSecurityPoolCreationWarningPresentation(result, message) {
    return withWarning(createSecurityPoolCreationSuccessPresentation(result), message);
}
function getSecurityVaultTransactionRows(context) {
    if (context === undefined)
        return undefined;
    return [
        ...(context.securityPoolAddress === undefined || context.securityPoolAddress.trim() === '' ? [] : [{ label: commonCopy.securityPoolAddress, value: _jsx(AddressValue, { address: context.securityPoolAddress }) }]),
        ...(context.vaultAddress === undefined || context.vaultAddress.trim() === '' ? [] : [{ label: securityPoolCopy.vault, value: _jsx(AddressValue, { address: context.vaultAddress }) }]),
    ];
}
function getSecurityVaultActionTitle(actionName) {
    if (actionName === 'depositRepToVault')
        return securityPoolCopy.depositRepToVault;
    if (actionName === 'queueWithdrawRep')
        return securityPoolCopy.withdrawRep;
    return humanizeAction(actionName);
}
export function createSecurityVaultTransactionIntent(actionName, context) {
    return buildIntent({
        action: actionName,
        rows: getSecurityVaultTransactionRows(context),
        source: 'security-vault',
        submittedTitle: getSecurityVaultActionTitle(actionName),
    });
}
export function createSecurityVaultSuccessPresentation(result, context) {
    let queuedOperationDetail;
    if (result.queuedOperation !== undefined) {
        queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedOperationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedOperationManualExecutionDetail(result.queuedOperation.operationId.toString());
    }
    return buildPresentation({
        ...(queuedOperationDetail === undefined ? {} : { detail: queuedOperationDetail }),
        hash: result.hash,
        rows: [...(getSecurityVaultTransactionRows(context) ?? []), ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
        title: getSecurityVaultActionTitle(result.action),
        tone: 'success',
    });
}
export function createSecurityVaultWarningPresentation(result, message, context) {
    return withWarning(createSecurityVaultSuccessPresentation(result, context), message);
}
function getTradingTransactionRows(context) {
    return [...(getPoolUniverseTransactionRows(context) ?? []), ...(context?.shareOutcome === undefined ? [] : [{ identityKey: 'outcome', label: transactionCopy.shareOutcome, value: getReportingOutcomeLabel(context.shareOutcome) }])];
}
export function createTradingTransactionIntent(actionName, context) {
    return buildIntent({
        action: actionName,
        rows: getTradingTransactionRows(context),
        source: 'trading',
        submittedTitle: humanizeAction(actionName),
    });
}
export function createTradingSuccessPresentation(result) {
    const detail = (() => {
        if (result.action === 'createCompleteSet')
            return undefined;
        if (result.action === 'redeemCompleteSet')
            return transactionCopy.completeSetBurnSuccessDetail;
        if (result.action === 'migrateShares')
            return transactionCopy.parentPoolSharesMigratedDetail;
        return undefined;
    })();
    return buildPresentation({
        ...(detail === undefined ? {} : { detail }),
        hash: result.hash,
        rows: [
            { identityKey: 'security-pool', label: transactionCopy.pool, value: _jsx(AddressValue, { address: result.securityPoolAddress }) },
            { identityKey: 'universe', label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
            ...(result.shareOutcome === undefined ? [] : [{ identityKey: 'outcome', label: transactionCopy.shareOutcome, value: getReportingOutcomeLabel(result.shareOutcome) }]),
            ...(result.targetOutcomeIndexes === undefined ? [] : [{ label: transactionCopy.targetOutcomeIndexes, value: result.targetOutcomeIndexes.join(', ') }]),
        ],
        title: humanizeAction(result.action),
        tone: 'success',
    });
}
export function createTradingWarningPresentation(result, message) {
    return withWarning(createTradingSuccessPresentation(result), message);
}
function getLiquidationTransactionRows(context) {
    return [
        ...(getPoolUniverseTransactionRows(context) ?? []),
        ...(context?.targetVault === undefined || context.targetVault.trim() === '' ? [] : [{ label: commonCopy.targetVault, value: _jsx(AddressValue, { address: context.targetVault }) }]),
        ...(context?.amount === undefined || context.amount.trim() === '' ? [] : [{ label: securityPoolCopy.requestedLiquidationDebt, value: `${context.amount.trim()} ${commonCopy.eth}` }]),
    ];
}
export function createLiquidationTransactionIntent(context) {
    return buildIntent({
        action: 'queueLiquidation',
        rows: getLiquidationTransactionRows(context),
        source: 'security-pools',
        submittedTitle: transactionCopy.submittingLiquidation,
    });
}
export function createLiquidationSuccessPresentation(result, context) {
    let queuedOperationDetail = transactionCopy.liquidationRequestSubmittedDetail;
    if (result.queuedOperation !== undefined) {
        queuedOperationDetail = result.queuedOperation.isPendingSlot ? transactionCopy.formatQueuedLiquidationAutoExecutionDetail(result.queuedOperation.operationId.toString()) : transactionCopy.formatQueuedLiquidationManualExecutionDetail(result.queuedOperation.operationId.toString());
    }
    return buildPresentation({
        detail: result.stagedExecution?.success === true ? transactionCopy.liquidationExecutedImmediatelyDetail : queuedOperationDetail,
        hash: result.hash,
        rows: [...getLiquidationTransactionRows({ ...context, securityPoolAddress: result.securityPoolAddress }), ...(result.queuedOperation === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.queuedOperation.operationId.toString()}` }])],
        title: result.stagedExecution?.success === true ? commonCopy.liquidationExecuted : commonCopy.liquidationSubmitted,
        tone: 'success',
    });
}
export function createLiquidationFailurePresentation(result, detail, context) {
    return buildPresentation({
        detail,
        hash: result.hash,
        rows: [...getLiquidationTransactionRows({ ...context, securityPoolAddress: result.securityPoolAddress }), ...(result.stagedExecution === undefined ? [] : [{ label: commonCopy.stagedOperation, value: `#${result.stagedExecution.operationId.toString()}` }])],
        title: commonCopy.liquidationFailed,
        tone: 'error',
    });
}
export function createLiquidationWarningPresentation(result, message, context) {
    return withWarning(createLiquidationSuccessPresentation(result, context), message);
}
export function createForkAuctionTransactionIntent(actionName, { context, submittedTitle } = {}) {
    let resolvedSubmittedTitle = submittedTitle;
    if (resolvedSubmittedTitle === undefined) {
        if (actionName === 'migrateUnresolvedEscalation') {
            resolvedSubmittedTitle = transactionCopy.clearUnresolvedParentEscalationDepositAccounting;
        }
        else if (actionName === 'claimParentEscalationDeposits') {
            resolvedSubmittedTitle = transactionCopy.claimParentEscalationDeposits;
        }
        else {
            resolvedSubmittedTitle = humanizeAction(actionName);
        }
    }
    return buildIntent({
        action: actionName,
        rows: getPoolUniverseTransactionRows(context),
        source: 'fork-auction',
        submittedTitle: resolvedSubmittedTitle,
    });
}
export function createForkAuctionSuccessPresentation(result) {
    let title = humanizeAction(result.action);
    if (result.action === 'claimAuctionProceeds' && result.settlementMode === 'refund') {
        title = transactionCopy.settleFinalizedRefunds;
    }
    else if (result.action === 'migrateUnresolvedEscalation') {
        title = transactionCopy.clearUnresolvedParentEscalationDepositAccounting;
    }
    else if (result.action === 'claimParentEscalationDeposits') {
        title = transactionCopy.claimParentEscalationDeposits;
    }
    const detail = (() => {
        switch (result.action) {
            case 'claimAuctionProceeds':
                if (result.settlementMode === 'refund') {
                    return transactionCopy.formatFinalizedRefundSettlementResultDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
                }
                if (result.settlementMode === 'claim') {
                    return transactionCopy.formatWinningBidSettlementResultDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
                }
                return transactionCopy.formatMixedBidSettlementResultDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL);
            case 'createChildUniverse':
                return transactionCopy.childUniverseLinkedToForkPathDetail;
            case 'forkWithOwnEscalation':
                return transactionCopy.ownEscalationForkSubmittedDetail;
            case 'forkUniverse':
                return transactionCopy.zoltarUniverseForkSubmittedDetail;
            case 'initiateFork':
                return transactionCopy.poolReadyForForkMigrationDetail;
            case 'claimParentEscalationDeposits':
                return transactionCopy.parentEscalationDepositsClaimedDetail;
            case 'migrateRepToZoltar':
                return transactionCopy.poolRepMigrationSuccessDetail;
            case 'migrateUnresolvedEscalation':
                return transactionCopy.unresolvedEscalationMigratedDetail;
            case 'migrateVault':
                return transactionCopy.vaultMigratedDetail;
            case 'refundLosingBids':
                return transactionCopy.losingBidsRefundedDetail;
            case 'settleForkedEscalation':
                return transactionCopy.forkDepositSettlementSuccessDetail;
            case 'startTruthAuction':
                return transactionCopy.truthAuctionStartedSuccessDetail;
            case 'submitBid':
                return transactionCopy.truthAuctionBidSuccessDetail;
            default:
                return undefined;
        }
    })();
    return buildPresentation({
        ...(detail === undefined ? {} : { detail }),
        hash: result.hash,
        rows: [
            { label: transactionCopy.pool, value: _jsx(AddressValue, { address: result.securityPoolAddress }) },
            { label: commonCopy.universe, value: _jsx(UniverseLink, { universeId: result.universeId }) },
        ],
        title,
        tone: 'success',
    });
}
export function createForkAuctionWarningPresentation(result, message) {
    return withWarning(createForkAuctionSuccessPresentation(result), message);
}
export { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createMarketCreationWarningPresentation, createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createReportingSuccessPresentation, createReportingTransactionIntent, } from '@zoltar/ui-zoltar/features/transactionPresentations.js';
//# sourceMappingURL=transactionPresentations.js.map