import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js';
export function formatSecurityPoolPageSummary(matchingPoolCount, loadedPoolCount) {
    const poolLabel = loadedPoolCount === 1 ? securityPoolCopy.poolCountSingular : securityPoolCopy.poolCountPlural;
    const matchVerb = matchingPoolCount === 1 ? securityPoolCopy.poolSummarySingularVerb : securityPoolCopy.poolSummaryPluralVerb;
    return securityPoolCopy.formatPoolPageSummary(matchingPoolCount, loadedPoolCount, poolLabel, matchVerb);
}
export function getVaultLauncherWalletReason(action, repExitMode) {
    if (action === 'claim-fees')
        return securityPoolCopy.connectWalletBeforeClaimingFees;
    if (action === 'deposit-rep')
        return securityPoolCopy.connectWalletBeforeDepositingRep;
    if (action === 'rep-exit')
        return repExitMode === 'redeem' ? securityPoolCopy.connectWalletBeforeRedeemingRep : securityPoolCopy.connectWalletBeforeWithdrawingRep;
    return assertNever(action);
}
export function getVaultLauncherVaultOwnerReason(action, repExitMode) {
    if (action === 'claim-fees')
        return securityPoolCopy.selectOwnVaultToClaimFees;
    if (action === 'deposit-rep')
        return securityPoolCopy.selectOwnVaultToDepositRep;
    if (action === 'rep-exit')
        return repExitMode === 'redeem' ? securityPoolCopy.selectOwnVaultToRedeemRep : securityPoolCopy.selectOwnVaultToWithdrawRep;
    return assertNever(action);
}
export function getSecurityPoolLifecycleLabel(state) {
    if (state === undefined)
        return 'Unknown';
    switch (state) {
        case 'operational':
            return 'Operational';
        case 'ended':
            return 'Ended';
        case 'poolForked':
            return 'Pool Forked';
        case 'forkMigration':
            return 'Fork Migration';
        case 'forkTruthAuction':
            return 'Truth Auction';
        default:
            return assertNever(state);
    }
}
export function getSecurityPoolStatusBadgeLabel({ hasForkActivity, questionOutcome, lifecycleState }) {
    if (lifecycleState === undefined)
        return 'Unknown';
    if (lifecycleState === 'poolForked' || lifecycleState === 'forkMigration')
        return 'Fork Migration';
    if (lifecycleState === 'forkTruthAuction')
        return 'Truth Auction';
    if (lifecycleState === 'ended') {
        if (questionOutcome === undefined || questionOutcome === 'none')
            return 'Finalized';
        return `Finalized as ${getReportingOutcomeLabel(questionOutcome)}`;
    }
    if (lifecycleState === 'operational' && hasForkActivity)
        return 'Fork Finalized';
    return getSecurityPoolLifecycleLabel(lifecycleState);
}
//# sourceMappingURL=securityPoolLabels.js.map