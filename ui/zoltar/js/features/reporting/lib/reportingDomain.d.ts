import { computeEscalationTimeSinceStartFromAttritionCostAttoRep, getEscalationBindingCapitalAttoRep, type EscalationBalanceTuple } from '@zoltar/shared/escalationMath';
import type { ActiveReportingDetails, EscalationDeposit, EscalationSide, ImportedEscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type ReportingAmountSuggestion = {
    amountAttoRep: bigint | undefined;
    reason: string | undefined;
};
export declare const ESCALATION_GAME_ACTIVATION_DELAY: bigint;
export { computeEscalationTimeSinceStartFromAttritionCostAttoRep, getEscalationBindingCapitalAttoRep };
type ProjectedEscalationEndTime = {
    acceptedAmountAttoRep: bigint;
    endsImmediately: boolean;
    projectedEndTime: bigint;
};
type ReportingTimerPreview = {
    hypotheticalDuration: bigint;
    kind: 'not-started';
    timeUntilEnd: bigint;
    timeUntilStart: bigint;
} | {
    acceptedAmountAttoRep: bigint;
    actualState: 'ends-immediately' | 'extends' | 'unchanged';
    hypotheticalDuration: bigint;
    kind: 'active-or-pending';
    timerIncrease?: bigint;
};
type EscalationPhase = 'Resolved' | 'Fork Triggered' | 'Pending Start' | 'Timed Out' | 'Active';
export declare function getEscalationTimeRemaining(details: ActiveReportingDetails): any;
export declare function isPoolQuestionFinalized(details: Pick<ReportingDetails, 'questionOutcome' | 'systemState'> | undefined): boolean;
export declare function isReportingClosed(details: ActiveReportingDetails): any;
export declare function getEscalationPhase(details: ActiveReportingDetails): EscalationPhase;
export declare function getEscalationBalanceTuple(sides: EscalationSide[]): EscalationBalanceTuple;
export declare function projectEscalationEndTime(details: ActiveReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ProjectedEscalationEndTime | undefined;
export declare function getEscalationDepositClaimAmount(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey, deposit: EscalationDeposit): bigint | undefined;
export declare function getImportedEscalationDepositClaimAmount(details: ReportingDetails | undefined, outcome: ReportingOutcomeKey, deposit: ImportedEscalationDeposit): bigint | undefined;
export declare function getRemainingSelectedOutcomeContributionCapacity(details: ReportingDetails, outcome: ReportingOutcomeKey): any;
export declare function getReportingTimerPreview(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingTimerPreview | undefined;
export declare function getLeadingEscalationOutcome(sides: EscalationSide[]): any;
export declare function getMinimumOutcomeChangeContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion;
export declare function getReportingMinimumOutcomeChangeContribution(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion;
export declare function getMaxProfitContribution(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion;
export declare function getReportingMaxProfitContribution(details: ReportingDetails | undefined, selectedOutcome: ReportingOutcomeKey): ReportingAmountSuggestion;
export declare function getSelectedOutcomeRewardWindowFillTimestamp(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey, acceptedAmountAttoRep: bigint): any;
export declare function calculateEstimatedEscalationReturn(details: ActiveReportingDetails, selectedOutcome: ReportingOutcomeKey, amount: bigint): {
    payout: bigint;
    profit: bigint;
} | {
    payout: any;
    profit: number;
};
type EscalationContributionPreview = {
    actualDepositAmount: bigint;
    reason: undefined;
} | {
    actualDepositAmount: undefined;
    reason: string;
};
type ReportingContributionPreview = EscalationContributionPreview;
export declare function previewReportingContribution(details: ReportingDetails, outcome: ReportingOutcomeKey, amount: bigint): ReportingContributionPreview;
//# sourceMappingURL=reportingDomain.d.ts.map