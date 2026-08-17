import type { ReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
export declare const REPORTING_OUTCOME_DROPDOWN_OPTIONS: {
    value: ReportingOutcomeKey;
    label: string;
}[];
export declare function getReportingOutcomeLabel(outcome: ReportingOutcomeKey | 'none'): any;
export declare function getReportingLockedUntilMessage(endTime: bigint, currentTimestamp: bigint | undefined): string;
export declare function hasReportingOpened(endTime: bigint, currentTimestamp: bigint | undefined): boolean | undefined;
export type ReportingStage = 'preOpen' | 'notStarted' | 'activeLocked' | 'activeWithdrawable' | 'resolved' | 'forkTriggered' | 'timedOut';
export declare function deriveReportingStage({ reportingDetails, reportingReady }: {
    reportingDetails: ReportingDetails | undefined;
    reportingReady: boolean | undefined;
}): ReportingStage | undefined;
export declare function isReportingOutcomeEnabled(stage: ReportingStage | undefined): stage is "notStarted" | "activeLocked" | "activeWithdrawable";
export declare function isWithdrawEscalationEnabled(stage: ReportingStage | undefined): stage is "resolved" | "activeWithdrawable";
//# sourceMappingURL=reporting.d.ts.map