import type { OpenOracleSelectedReportActionMode } from './openOracle.js';
import type { LifecycleStagePresentation } from '../../types.js';
import type { OpenOracleReportDetails } from '@zoltar/ui-core-shared/types/contracts.js';
type OpenOracleStageReport = Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentTime' | 'disputeDelay' | 'reportTimestamp' | 'timeType'>;
export declare function getOpenOracleStagePresentation(actionMode: OpenOracleSelectedReportActionMode, report?: OpenOracleStageReport | undefined): LifecycleStagePresentation;
export {};
//# sourceMappingURL=openOracleStage.d.ts.map