import type { OracleManagerDetails, SecurityPoolOverviewActionResult } from '@zoltar/ui-core-shared/types/contracts.js';
type LiquidationNoticeState = 'failed' | 'queued' | 'submitted' | 'successful';
export declare function getLiquidationNoticeState({ currentTimestamp, currentPoolOracleManagerDetails, liquidationTargetVault, loadingPoolOracleManager, securityPoolOverviewResult, }: {
    currentTimestamp?: bigint | undefined;
    currentPoolOracleManagerDetails: OracleManagerDetails | undefined;
    liquidationTargetVault: string;
    loadingPoolOracleManager: boolean;
    securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined;
}): LiquidationNoticeState | undefined;
export {};
//# sourceMappingURL=liquidationStatus.d.ts.map