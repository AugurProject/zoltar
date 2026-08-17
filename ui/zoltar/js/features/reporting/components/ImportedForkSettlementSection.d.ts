import type { ComponentChildren } from 'preact';
import type { ActiveReportingDetails, EscalationSide, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type ImportedForkSettlementActionRenderProps = {
    guardMessage: string | undefined;
    outcome: ReportingOutcomeKey;
    sideLabel: string;
};
type ImportedForkSettlementSectionProps = {
    activeReportingDetails: ActiveReportingDetails | undefined;
    disabled: boolean;
    onDepositSelectionChange: (outcome: ReportingOutcomeKey, depositIndex: bigint, checked: boolean) => void;
    renderSettlementAction: (props: ImportedForkSettlementActionRenderProps) => ComponentChildren;
    resolved: boolean;
    selectedDepositIndexesByOutcome: Record<ReportingOutcomeKey, bigint[]>;
    sides: Pick<EscalationSide, 'importedUserDeposits' | 'key' | 'label'>[];
    winningOutcome: ReportingOutcomeKey | undefined;
};
export declare function ImportedForkSettlementSection({ activeReportingDetails, disabled, onDepositSelectionChange, renderSettlementAction, resolved, selectedDepositIndexesByOutcome, sides, winningOutcome }: ImportedForkSettlementSectionProps): import("preact").JSX.Element | undefined;
export {};
//# sourceMappingURL=ImportedForkSettlementSection.d.ts.map