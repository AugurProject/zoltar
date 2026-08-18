import type { ForkAuctionStageView } from '../../../truth-auctions/lib/forkAuction.js';
import type { SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage } from './types.js';
import type { ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function isSecurityPoolEnded({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked, }: {
    hasForkActivity?: boolean | undefined;
    isChildPool?: boolean | undefined;
    questionOutcome: ReportingOutcomeKey | 'none' | undefined;
    systemState: SecurityPoolSystemState | undefined;
    universeHasForked?: boolean | undefined;
}): boolean;
export declare function deriveSecurityPoolLifecycleState({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked, }: {
    hasForkActivity?: boolean | undefined;
    isChildPool?: boolean | undefined;
    questionOutcome: ReportingOutcomeKey | 'none' | undefined;
    systemState: SecurityPoolSystemState | undefined;
    universeHasForked?: boolean | undefined;
}): SecurityPoolLifecycleState | undefined;
export declare function deriveSecurityPoolReportingStage({ reportingDetails, reportingReady }: {
    reportingDetails: ReportingDetails | undefined;
    reportingReady: boolean | undefined;
}): SecurityPoolReportingStage | undefined;
export declare function deriveSecurityPoolForkStage({ currentStage, workflowDisabled }: {
    currentStage: ForkAuctionStageView | undefined;
    workflowDisabled: boolean | undefined;
}): SecurityPoolForkStage | undefined;
//# sourceMappingURL=axes.d.ts.map