import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { isOracleManagerPriceUsable } from './securityVault.js';
export function getLiquidationNoticeState({ currentTimestamp, currentPoolOracleManagerDetails, liquidationTargetVault, loadingPoolOracleManager, securityPoolOverviewResult, }) {
    if (securityPoolOverviewResult?.action !== 'queueLiquidation')
        return undefined;
    if (securityPoolOverviewResult.stagedExecution !== undefined)
        return securityPoolOverviewResult.stagedExecution.success ? 'successful' : 'failed';
    if (securityPoolOverviewResult.queuedOperation?.operation === 'liquidation')
        return 'queued';
    if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined)
        return 'submitted';
    if (currentPoolOracleManagerDetails.pendingOperation?.operation === 'liquidation' && sameAddress(currentPoolOracleManagerDetails.pendingOperation.targetVault, liquidationTargetVault))
        return 'queued';
    if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp))
        return 'successful';
    return 'submitted';
}
//# sourceMappingURL=liquidationStatus.js.map