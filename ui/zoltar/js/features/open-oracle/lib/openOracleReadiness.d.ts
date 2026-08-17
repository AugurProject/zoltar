import type { OpenOracleSelectedReportActionMode } from './openOracle.js';
import type { ReadinessAction } from '../../types.js';
export declare function getOpenOracleReadinessActions({ actionMode, disputeMessage, hasReport, settleMessage }: {
    actionMode: OpenOracleSelectedReportActionMode;
    disputeMessage: string | undefined;
    hasReport: boolean;
    settleMessage: string | undefined;
}): ReadinessAction[];
//# sourceMappingURL=openOracleReadiness.d.ts.map